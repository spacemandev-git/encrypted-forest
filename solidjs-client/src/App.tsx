/**
 * Root app: home page → game setup → game view with canvas + DOM overlay + store wiring.
 *
 * Supports ?gameId=<id> query parameter — if present (and a wallet is ready),
 * the app joins that game automatically and drops into the game view.
 */

import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  Show,
  Switch,
  Match,
} from "solid-js";
import { Connection, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import type { TuiCanvas } from "./renderer/TuiCanvas.js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import type {
  DiscoveredPlanet,
  EncryptedCelestialBodyAccount,
  PlanetState,
  PendingMovesMetadata,
} from "@encrypted-forest/core";
import {
  derivePlanetKeySeed,
  deriveCelestialBodyPDA,
  fetchEncryptedCelestialBody,
  fetchPendingMovesMetadata,
  decryptPlanetState,
  subscribeToCelestialBody,
  subscribeToPendingMoves,
  idlJson,
  PROGRAM_ID,
} from "@encrypted-forest/core";
import { getMXEPublicKey } from "@arcium-hq/client";
import { setPreference, getPreference } from "./persistence/db.js";
import { createWalletStore } from "./wallet/store.js";
import { createMiner, type DiscoveredBody } from "./mining/miner.js";
import { createGameSession, queueProcessMove } from "./game/session.js";
import HomePage from "./components/HomePage.js";
import GameSetup from "./components/GameSetup.js";
import GameCanvas from "./components/GameCanvas.js";
import HUD from "./components/HUD.js";
import MinerControls from "./components/MinerControls.js";
import CommandLine from "./components/CommandLine.js";
import StatusBar from "./components/StatusBar.js";
import PlanetPopup from "./components/PlanetPopup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function getQueryGameId(): bigint | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("gameId");
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function setQueryGameId(gameId: bigint | null) {
  const url = new URL(window.location.href);
  if (gameId != null) {
    url.searchParams.set("gameId", gameId.toString());
  } else {
    url.searchParams.delete("gameId");
  }
  window.history.replaceState({}, "", url.toString());
}

/** Convert a miner DiscoveredBody into a PlanetEntry for the renderer. */
function toPlanetEntry(d: DiscoveredBody, gameId: bigint, hashRounds: number): PlanetEntry {
  const hashHex = bytesToHex(d.hash);
  const discovery: DiscoveredPlanet = {
    x: d.x,
    y: d.y,
    hash: d.hash,
    keySeed: derivePlanetKeySeed(d.x, d.y, gameId, hashRounds),
    properties: {
      bodyType: d.bodyType,
      size: d.size,
      comets: d.comets,
    },
  };
  return { discovery, encrypted: null, decrypted: null, hashHex };
}

/** Create a read-only Anchor program for RPC fetches. */
function createReadProgram(rpcUrl: string): { program: Program; connection: Connection } {
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(
    connection,
    { publicKey: PROGRAM_ID, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
    { commitment: "confirmed" }
  );
  const program = new Program(idlJson as any, provider);
  return { program, connection };
}

// ---------------------------------------------------------------------------
// On-chain state types
// ---------------------------------------------------------------------------

interface OnChainPlanetData {
  encrypted: EncryptedCelestialBodyAccount;
  decrypted: PlanetState | null;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  // App-level state
  const [page, setPage] = createSignal<"home" | "setup" | "game">("home");

  // Wallet store
  const walletStore = createWalletStore();
  onMount(() => walletStore.init());

  // Game session (holds fetched Game account data)
  const session = createGameSession();

  // Miner
  const miner = createMiner();

  // Game view state
  let rendererRef: TuiCanvas | undefined;
  const [hoveredCell, setHoveredCell] = createSignal<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [selectedHash, setSelectedHash] = createSignal<string | null>(null);

  // Targeting mode state
  const [targetingMode, setTargetingMode] = createSignal(false);
  const [shipsToSend, setShipsToSend] = createSignal(0);
  const [sourceHash, setSourceHash] = createSignal<string | null>(null);

  // Persisted panel positions (survive close/reopen within session)
  const [planetPopupPos, setPlanetPopupPos] = createSignal<{ x: number; y: number } | null>(null);

  // MXE public key — fetched once on game enter, needed for decryption
  const [mxePublicKey, setMxePublicKey] = createSignal<Uint8Array | null>(null);

  // ---------------------------------------------------------------------------
  // On-chain state: fetched + subscribed planet data and pending moves
  // ---------------------------------------------------------------------------

  const [onChainData, setOnChainData] = createSignal<ReadonlyMap<string, OnChainPlanetData>>(new Map());
  const [pendingMovesData, setPendingMovesData] = createSignal<ReadonlyMap<string, PendingMovesMetadata>>(new Map());

  // Track active subscriptions for cleanup
  let activeSubscriptions: Array<{ remove: () => void }> = [];

  function cleanupSubscriptions() {
    for (const sub of activeSubscriptions) {
      sub.remove();
    }
    activeSubscriptions = [];
  }

  onCleanup(cleanupSubscriptions);

  /**
   * Fetch on-chain state for a single planet and update reactive maps.
   * Also subscribes to live updates if not already subscribed.
   */
  function tryDecrypt(planetHash: Uint8Array, encrypted: EncryptedCelestialBodyAccount): PlanetState | null {
    // The queue instruction creates the account with lastUpdatedSlot > 0 but
    // zeroed ciphertexts. The MPC callback writes state_enc_pubkey + ciphertexts.
    // Check that state_enc_pubkey is non-zero to know the callback has run.
    if (encrypted.stateEncPubkey.every((b) => b === 0)) return null;
    const mxePk = mxePublicKey();
    if (!mxePk) return null;
    try {
      return decryptPlanetState(planetHash, mxePk, encrypted);
    } catch (e) {
      console.warn(`Decrypt failed:`, (e as Error).message);
      return null;
    }
  }

  async function fetchAndSubscribePlanet(
    program: Program,
    connection: Connection,
    gameId: bigint,
    planetHash: Uint8Array,
    hashHex: string
  ): Promise<void> {
    // Fetch encrypted celestial body
    try {
      const [pda] = deriveCelestialBodyPDA(gameId, planetHash);
      console.log(`Looking up planet ${hashHex.slice(0, 8)} PDA=${pda.toBase58().slice(0, 12)}...`);
      const encrypted = await fetchEncryptedCelestialBody(program, gameId, planetHash);
      const pubkeyZero = encrypted.stateEncPubkey.every((b) => b === 0);
      const onChainHash = bytesToHex(encrypted.planetHash);
      const hashMatch = onChainHash === hashHex;
      console.log(`Fetched planet ${hashHex.slice(0, 8)}: lastUpdated=${encrypted.lastUpdatedSlot}, pubkeyZero=${pubkeyZero}, onChainHash=${onChainHash.slice(0, 8)}, hashMatch=${hashMatch}`);
      const decrypted = tryDecrypt(planetHash, encrypted);
      console.log(`Decrypt result for ${hashHex.slice(0, 8)}: ${decrypted ? `bodyType=${decrypted.static.bodyType} size=${decrypted.static.size} ships=${decrypted.dynamic.shipCount} owner=${decrypted.dynamic.ownerId} ownerExists=${decrypted.dynamic.ownerExists}` : "null"}`);

      setOnChainData((prev) => {
        const next = new Map(prev);
        next.set(hashHex, { encrypted, decrypted });
        return next;
      });
    } catch (e: any) {
      console.warn(`Failed to fetch planet ${hashHex.slice(0, 8)}:`, e.message);
    }

    // Fetch pending moves
    try {
      const pending = await fetchPendingMovesMetadata(program, gameId, planetHash);
      setPendingMovesData((prev) => {
        const next = new Map(prev);
        next.set(hashHex, pending);
        return next;
      });
    } catch {
      // No pending moves account — normal for undiscovered planets
    }

    // Subscribe to celestial body changes
    const bodySub = subscribeToCelestialBody(
      connection, gameId, planetHash,
      async () => {
        try {
          const enc = await fetchEncryptedCelestialBody(program, gameId, planetHash);
          const dec = tryDecrypt(planetHash, enc);
          setOnChainData((prev) => {
            const next = new Map(prev);
            next.set(hashHex, { encrypted: enc, decrypted: dec });
            return next;
          });
        } catch {}
      }
    );
    activeSubscriptions.push(bodySub);

    // Subscribe to pending moves changes
    const movesSub = subscribeToPendingMoves(
      connection, gameId, planetHash,
      async () => {
        try {
          const pending = await fetchPendingMovesMetadata(program, gameId, planetHash);
          setPendingMovesData((prev) => {
            const next = new Map(prev);
            next.set(hashHex, pending);
            return next;
          });
        } catch {}
      }
    );
    activeSubscriptions.push(movesSub);
  }

  /**
   * Fetch on-chain state for all known planets in parallel.
   */
  async function fetchAllPlanetStates(): Promise<void> {
    const gid = session.gameId();
    if (gid == null) return;

    const rpcUrl = walletStore.rpcUrl();
    const { program, connection } = createReadProgram(rpcUrl);

    const discoveries = miner.discoveries();
    const spawn = session.spawnLocation();

    // Collect all unique planet hashes
    const planets: Array<{ hash: Uint8Array; hashHex: string }> = [];
    const seen = new Set<string>();

    if (spawn) {
      const hex = bytesToHex(spawn.hash);
      if (!seen.has(hex)) {
        seen.add(hex);
        planets.push({ hash: spawn.hash, hashHex: hex });
      }
    }

    for (const d of discoveries) {
      const hex = bytesToHex(d.hash);
      if (!seen.has(hex)) {
        seen.add(hex);
        planets.push({ hash: d.hash, hashHex: hex });
      }
    }

    if (planets.length === 0) return;

    // Log spawn planet hash for debugging
    if (spawn) {
      const spawnHex = bytesToHex(spawn.hash);
      console.log(`Spawn planet hash: ${spawnHex} at (${spawn.x}, ${spawn.y})`);
    }

    console.log(`Fetching on-chain state for ${planets.length} known planets...`);

    // Fetch all in parallel (batched to avoid overwhelming RPC)
    const BATCH_SIZE = 10;
    for (let i = 0; i < planets.length; i += BATCH_SIZE) {
      const batch = planets.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((p) => fetchAndSubscribePlanet(program, connection, gid, p.hash, p.hashHex))
      );
    }

    console.log(`On-chain fetch complete. ${onChainData().size} planets fetched.`);
  }

  // Track already-subscribed hashes to avoid duplicate subscriptions for new discoveries
  const subscribedHashes = new Set<string>();

  // Watch for new miner discoveries and fetch their on-chain state
  createEffect(() => {
    const gid = session.gameId();
    if (gid == null || page() !== "game") return;

    const discoveries = miner.discoveries();
    const newPlanets: DiscoveredBody[] = [];

    for (const d of discoveries) {
      const hex = bytesToHex(d.hash);
      if (!subscribedHashes.has(hex)) {
        subscribedHashes.add(hex);
        newPlanets.push(d);
      }
    }

    if (newPlanets.length === 0) return;

    const rpcUrl = walletStore.rpcUrl();
    const { program, connection } = createReadProgram(rpcUrl);

    for (const d of newPlanets) {
      const hex = bytesToHex(d.hash);
      fetchAndSubscribePlanet(program, connection, gid, d.hash, hex).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // Derive planet map from miner discoveries + on-chain state (reactive)
  // ---------------------------------------------------------------------------

  // Stable player ID derived from wallet pubkey (used for owned-planet coloring)
  const playerId = createMemo<bigint | null>(() => {
    const pk = walletStore.activeWallet()?.publicKey;
    if (!pk) return null;
    let h = 0n;
    for (let i = 0; i < Math.min(pk.length, 16); i++) {
      h = h * 31n + BigInt(pk.charCodeAt(i));
    }
    return h;
  });

  const planetMap = createMemo<ReadonlyMap<string, PlanetEntry>>(() => {
    const discs = miner.discoveries();
    const gid = session.gameId();
    const rounds = session.hashRounds();
    if (gid == null) return new Map();

    const spawn = session.spawnLocation();
    const chainData = onChainData();

    const map = new Map<string, PlanetEntry>();

    // Inject spawn planet as a discovery so it renders even before the miner finds it.
    // No synthetic state — on-chain data is merged below like any other planet.
    if (spawn) {
      const spawnEntry = toPlanetEntry(
        {
          x: spawn.x,
          y: spawn.y,
          hash: spawn.hash,
          bodyType: spawn.bodyType,
          size: spawn.size,
          comets: spawn.comets,
        },
        gid,
        rounds
      );
      const spawnChain = chainData.get(spawnEntry.hashHex);
      if (spawnChain) {
        spawnEntry.encrypted = spawnChain.encrypted;
        spawnEntry.decrypted = spawnChain.decrypted;
      }
      map.set(spawnEntry.hashHex, spawnEntry);
    }

    for (const d of discs) {
      const entry = toPlanetEntry(d, gid, rounds);
      // Don't overwrite spawn entry (already inserted above)
      if (!map.has(entry.hashHex)) {
        // Merge on-chain data if available
        const chain = chainData.get(entry.hashHex);
        if (chain) {
          entry.encrypted = chain.encrypted;
          entry.decrypted = chain.decrypted;
        }
        map.set(entry.hashHex, entry);
      }
    }
    return map;
  });

  // exploredCoords is the miner's internal set of all scanned coordinates.
  // It's a plain Set (not reactive), but the renderer reads it every frame
  // in its animation loop, so it always sees the latest state.
  const exploredCoords = () => miner.exploredCoords;

  // ---------------------------------------------------------------------------
  // Sync game ID ↔ query parameter
  // ---------------------------------------------------------------------------

  // When the session's gameId changes, update the URL
  createEffect(() => {
    const gid = session.gameId();
    setQueryGameId(gid);
  });

  // On mount: if ?gameId=X is present and wallet is ready, auto-join
  const [autoJoinAttempted, setAutoJoinAttempted] = createSignal(false);

  createEffect(() => {
    if (autoJoinAttempted()) return;
    const wallet = walletStore.activeWallet();
    if (!wallet) return; // wallet not ready yet

    const queryGid = getQueryGameId();
    if (queryGid == null) return;

    setAutoJoinAttempted(true);
    session
      .joinGame(queryGid, walletStore.rpcUrl(), wallet.publicKey)
      .then(() => handleEnterGame())
      .catch((err) => {
        console.warn("Auto-join from URL failed:", err.message);
        // Fall through to normal flow — user will see home page
      });
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleCellClick(gridX: number, gridY: number) {
    console.log(`Clicked cell: ${gridX}, ${gridY}`);

    // Targeting mode: click selects target planet
    if (targetingMode()) {
      const planets = planetMap();
      for (const [hash, entry] of planets) {
        if (Number(entry.discovery.x) === gridX && Number(entry.discovery.y) === gridY) {
          // Found a target planet — execute the move
          executeProcessMove(hash);
          return;
        }
      }
      // No planet at clicked cell — stay in targeting mode
      return;
    }

    // Normal mode: check if a planet exists at this cell
    const planets = planetMap();
    for (const [hash, entry] of planets) {
      if (Number(entry.discovery.x) === gridX && Number(entry.discovery.y) === gridY) {
        setSelectedHash(hash);
        return;
      }
    }
    // No planet here — deselect and update miner center
    setSelectedHash(null);
    miner.updateConfig({ centerX: gridX, centerY: gridY });
  }

  function enterTargetingMode() {
    const planet = selectedPlanet();
    if (!planet) return;

    // Check if owned
    const state = planet.decrypted;
    const pid = playerId();
    if (!state || state.dynamic.ownerExists === 0 || pid == null) return;
    if (state.dynamic.ownerId !== pid) return;

    // Default ship count = half of current ships
    const maxShips = Number(state.static.maxShipCapacity);
    const baseShips = Number(state.dynamic.shipCount);
    const currentShips = Math.min(maxShips, baseShips); // simplified; popup shows regen
    const defaultCount = Math.max(1, Math.floor(currentShips / 2));

    setSourceHash(selectedHash());
    if (shipsToSend() === 0) setShipsToSend(defaultCount);
    setTargetingMode(true);
  }

  function exitTargetingMode() {
    setTargetingMode(false);
    setSourceHash(null);
  }

  async function executeProcessMove(targetHash: string) {
    const srcHash = sourceHash();
    if (!srcHash) return;

    const planets = planetMap();
    const source = planets.get(srcHash);
    const target = planets.get(targetHash);
    if (!source || !target) return;

    const wallet = walletStore.activeWallet();
    if (!wallet?.keypair) {
      console.warn("No wallet keypair available for process_move");
      exitTargetingMode();
      return;
    }

    const gid = session.gameId();
    const game = session.game();
    if (gid == null || !game) {
      exitTargetingMode();
      return;
    }

    exitTargetingMode();

    const rpcUrl = walletStore.rpcUrl();
    const connection = new Connection(rpcUrl, "confirmed");
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: wallet.keypair.publicKey,
        signTransaction: async (tx: any) => { tx.sign(wallet.keypair!); return tx; },
        signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(wallet.keypair!)); return txs; },
      } as any,
      { commitment: "confirmed" }
    );
    const program = new Program(idlJson as any, provider);

    try {
      await queueProcessMove(
        program,
        connection,
        wallet.keypair,
        gid,
        session.hashRounds(),
        source,
        target,
        BigInt(shipsToSend()),
        0n,
        game.gameSpeed
      );
      console.log("Process move transaction sent successfully");
    } catch (e: any) {
      console.warn("Process move failed:", e.message);
    }
  }

  // Targeting info for range circle rendering
  const targetingInfo = createMemo(() => {
    if (!targetingMode()) return null;
    const srcHash = sourceHash();
    if (!srcHash) return null;
    const planet = planetMap().get(srcHash);
    if (!planet?.decrypted) return null;

    const range = Number(planet.decrypted.static.range);
    const ships = shipsToSend();
    // Max distance where >= 1 ship arrives: (ships - 1) * range
    const maxDistance = Math.max(0, (ships - 1) * range);

    return {
      gridX: Number(planet.discovery.x),
      gridY: Number(planet.discovery.y),
      maxDistance,
    };
  });

  const selectedPlanet = createMemo<PlanetEntry | null>(() => {
    const hash = selectedHash();
    if (!hash) return null;
    return planetMap().get(hash) ?? null;
  });

  function handleCommand(cmd: string) {
    console.log(`Command: ${cmd}`);
    const parts = cmd.split(/\s+/);
    const action = parts[0]?.toLowerCase();

    if (action === "home") {
      miner.stop();
      session.leaveGame();
      cleanupSubscriptions();
      setPage("home");
    } else if (action === "setup") {
      miner.stop();
      setPage("setup");
    } else if (action === "mine") {
      handleMinerStart();
    } else if (action === "stop") {
      miner.stop();
    } else if (action === "goto" && parts.length >= 3) {
      const x = parseInt(parts[1]);
      const y = parseInt(parts[2]);
      if (!isNaN(x) && !isNaN(y)) {
        miner.updateConfig({ centerX: x, centerY: y });
      }
    }
  }

  function handleMinerStart() {
    const gid = session.gameId();
    if (gid == null) {
      console.warn("No game session — cannot start miner");
      return;
    }
    miner.start(gid, session.thresholds(), session.hashRounds());
  }

  function handleMinerStop() {
    miner.stop();
  }

  function handleEnterSetup() {
    setPage("setup");
  }

  async function handleEnterGame() {
    // Load persisted miner data for this game+wallet scope
    const scope = session.scopeKey();
    if (scope) {
      await miner.loadScope(scope);
    }

    // Center miner on the spawn location and mark it as explored
    const spawn = session.spawnLocation();
    if (spawn) {
      const sx = Number(spawn.x);
      const sy = Number(spawn.y);
      miner.updateConfig({ centerX: sx, centerY: sy });
      miner.addExploredCoord(sx, sy);
    }

    // Fetch MXE public key for decryption — must complete before planet state fetch
    const rpcUrl = walletStore.rpcUrl();
    const { connection: readConn } = createReadProgram(rpcUrl);
    const provider = new AnchorProvider(
      readConn,
      { publicKey: PROGRAM_ID, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
      { commitment: "confirmed" }
    );
    try {
      const pk = await getMXEPublicKey(provider, PROGRAM_ID);
      if (pk) {
        setMxePublicKey(pk);
        console.log("MXE public key fetched:", bytesToHex(pk).slice(0, 16) + "...");
      } else {
        console.warn("MXE public key not available");
      }
    } catch (e: any) {
      console.warn("Failed to fetch MXE public key:", e.message);
    }

    // Restore camera state from preferences
    if (scope) {
      const savedCamera = getPreference(`${scope}:camera`);
      if (savedCamera) {
        try {
          const cam = JSON.parse(savedCamera);
          // Defer until renderer is mounted
          requestAnimationFrame(() => {
            if (rendererRef) {
              const camera = rendererRef.getCamera();
              camera.x = cam.x ?? 0;
              camera.y = cam.y ?? 0;
              camera.zoom = cam.zoom ?? 1;
            }
          });
          // Restore selected planet
          if (cam.selectedHash) {
            setSelectedHash(cam.selectedHash);
          }
        } catch {}
      }
    }

    setPage("game");

    // Fetch on-chain state for all known planets (non-blocking)
    fetchAllPlanetStates().catch((err) => {
      console.warn("Failed to fetch planet states:", err.message);
    });
  }

  function handleBackToHome() {
    // Force-save camera state before leaving
    lastCameraSave = 0;
    saveCameraState();
    session.leaveGame();
    cleanupSubscriptions();
    subscribedHashes.clear();
    setOnChainData(new Map());
    setPendingMovesData(new Map());
    setMxePublicKey(null);
    setPage("home");
  }

  // Save camera state to preferences (debounced)
  let lastCameraSave = 0;
  function saveCameraState() {
    const scope = session.scopeKey();
    if (!scope || !rendererRef) return;
    const now = Date.now();
    if (now - lastCameraSave < 2000) return; // Save at most every 2s
    lastCameraSave = now;
    const cam = rendererRef.getCamera();
    setPreference(`${scope}:camera`, JSON.stringify({
      x: cam.x,
      y: cam.y,
      zoom: cam.zoom,
      selectedHash: selectedHash(),
    }));
  }

  // Poll renderer for hover/zoom state + save camera
  let pollInterval: ReturnType<typeof setInterval>;
  onMount(() => {
    pollInterval = setInterval(() => {
      if (rendererRef) {
        setHoveredCell(rendererRef.getHoveredCell());
        setZoom(rendererRef.getCamera().zoom);
        saveCameraState();
      }
    }, 100);
  });
  onCleanup(() => clearInterval(pollInterval));

  // Keyboard handlers for targeting mode (Q to enter, Esc to cancel)
  function handleKeyDown(e: KeyboardEvent) {
    if (page() !== "game") return;
    // Don't capture if user is typing in an input/textarea
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "q" || e.key === "Q") {
      if (!targetingMode() && selectedPlanet()) {
        enterTargetingMode();
      }
    } else if (e.key === "Escape") {
      if (targetingMode()) {
        exitTargetingMode();
      }
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <Switch>
      <Match when={page() === "home"}>
        <HomePage
          walletStore={walletStore}
          onEnterGame={handleEnterSetup}
        />
      </Match>

      <Match when={page() === "setup"}>
        <GameSetup
          session={session}
          walletStore={walletStore}
          onEnterGame={handleEnterGame}
          onBack={handleBackToHome}
        />
      </Match>

      <Match when={page() === "game"}>
        {/* Game view */}
        <GameCanvas
          getPlanets={() => planetMap()}
          getExploredCoords={() => exploredCoords()}
          getMapDiameter={() => session.mapDiameter()}
          getPlayerId={() => playerId()}
          getSelectedHash={() => selectedHash()}
          getTargetingInfo={() => targetingInfo()}
          onCellClick={handleCellClick}
          ref={(r) => (rendererRef = r)}
        />

        <HUD
          gameId={() => session.gameId()?.toString() ?? null}
          points={() => 0n}
          ownedPlanets={() => 0}
          totalShips={() => 0n}
          totalMetal={() => 0n}
          exploredCount={() => exploredCoords().size}
          hasSpawned={() => false}
          onCenterSpawn={session.spawnLocation() ? () => {
            const spawn = session.spawnLocation();
            if (spawn && rendererRef) {
              rendererRef.centerOn(Number(spawn.x), Number(spawn.y));
            }
          } : undefined}
        />

        <MinerControls
          miner={miner}
          onStart={handleMinerStart}
          onStop={handleMinerStop}
        />

        <Show when={selectedPlanet()}>
          {(entry) => (
            <PlanetPopup
              entry={entry()}
              playerId={playerId()}
              gameSpeed={session.game()?.gameSpeed}
              x={planetPopupPos()?.x}
              y={planetPopupPos()?.y}
              onPositionChange={(px, py) => setPlanetPopupPos({ x: px, y: py })}
              onClose={() => { setSelectedHash(null); exitTargetingMode(); }}
              targeting={targetingMode()}
              shipCount={shipsToSend()}
              onShipCountChange={(count) => setShipsToSend(count)}
              onSendShips={enterTargetingMode}
            />
          )}
        </Show>

        <CommandLine onCommand={handleCommand} />

        <StatusBar
          hoveredCell={hoveredCell}
          zoom={zoom}
          connected={() => walletStore.activeWallet() !== null}
        />
      </Match>
    </Switch>
  );
}
