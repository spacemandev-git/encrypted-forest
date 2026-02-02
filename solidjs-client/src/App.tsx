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
import type { TuiCanvas } from "./renderer/TuiCanvas.js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import type { DiscoveredPlanet } from "@encrypted-forest/core";
import { derivePlanetKeySeed } from "@encrypted-forest/core";
import { createWalletStore } from "./wallet/store.js";
import { createMiner, type DiscoveredBody } from "./mining/miner.js";
import { createGameSession } from "./game/session.js";
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

  // ---------------------------------------------------------------------------
  // Derive planet map from miner discoveries (reactive)
  // ---------------------------------------------------------------------------

  // Stable player ID derived from wallet pubkey (used for owned-planet coloring)
  const playerId = createMemo<bigint | null>(() => {
    const pk = walletStore.activeWallet()?.publicKey;
    if (!pk) return null;
    // Simple hash: use first 8 chars of base58 pubkey as a numeric ID
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
    const pid = playerId();

    const map = new Map<string, PlanetEntry>();

    // Always inject spawn planet (owned by current player) even if miner hasn't found it
    if (spawn && pid !== null) {
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
      spawnEntry.decrypted = {
        static: {
          bodyType: spawn.bodyType,
          size: spawn.size,
          maxShipCapacity: 0n,
          shipGenSpeed: 0n,
          maxMetalCapacity: 0n,
          metalGenSpeed: 0n,
          range: 0n,
          launchVelocity: 0n,
          level: 0,
          comet0: 0,
          comet1: 0,
        },
        dynamic: {
          shipCount: 0n,
          metalCount: 0n,
          ownerExists: 1,
          ownerId: pid,
        },
      };
      map.set(spawnEntry.hashHex, spawnEntry);
    }

    for (const d of discs) {
      const entry = toPlanetEntry(d, gid, rounds);
      // Don't overwrite spawn entry (which has ownership data)
      if (!map.has(entry.hashHex)) {
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
    // Check if a planet exists at this cell
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
    setPage("game");
  }

  function handleBackToHome() {
    session.leaveGame();
    setPage("home");
  }

  // Poll renderer for hover/zoom state
  let pollInterval: ReturnType<typeof setInterval>;
  onMount(() => {
    pollInterval = setInterval(() => {
      if (rendererRef) {
        setHoveredCell(rendererRef.getHoveredCell());
        setZoom(rendererRef.getCamera().zoom);
      }
    }, 100);
  });
  onCleanup(() => clearInterval(pollInterval));

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
              onClose={() => setSelectedHash(null)}
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
