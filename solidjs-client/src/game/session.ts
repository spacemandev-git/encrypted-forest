/**
 * Game session store — holds the active game ID, fetched Game account data,
 * and provides scoping context for IndexedDB persistence.
 *
 * The miner reads hashRounds from here instead of accepting it as a parameter.
 */

import { createSignal, createMemo, type Accessor } from "solid-js";
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import type { Game, NoiseThresholds, CreateGameArgs, ScannedCoordinate } from "@encrypted-forest/core";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_HASH_ROUNDS,
  deriveGamePDA,
  PROGRAM_ID,
  idlJson,
  buildCreateGameIx,
  buildInitPlayerIx,
  buildQueueInitSpawnPlanetIx,
  buildQueueProcessMoveIx,
  findSpawnPlanet,
  computePlanetHash,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,
  fetchPendingMovesMetadata,
  computeDistance,
  computeLandingSlot,
  computeCurrentShips,
  computeCurrentMetal,
} from "@encrypted-forest/core";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import { saveRecentGame } from "./history.js";
import {
  setupEncryption,
  getArciumAccountAddresses,
  generateNonce,
  generateComputationOffset,
  encryptAndPack,
  buildInitSpawnPlanetValues,
  buildProcessMoveValues,
  x25519,
  RescueCipher,
} from "./arcium.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnLocation {
  x: bigint;
  y: bigint;
  hash: Uint8Array;
  bodyType: number;
  size: number;
  comets: number[];
}

export interface GameSessionAPI {
  /** Current game ID (null if no game selected) */
  gameId: Accessor<bigint | null>;
  /** Fetched Game account data (null if not loaded) */
  game: Accessor<Game | null>;
  /** Noise thresholds (defaults if no game loaded) */
  thresholds: Accessor<NoiseThresholds>;
  /** Hash rounds from game account (default if not loaded) */
  hashRounds: Accessor<number>;
  /** Map diameter from game account */
  mapDiameter: Accessor<number>;
  /** Whether we're currently loading game data */
  loading: Accessor<boolean>;
  /** Error message if fetch failed */
  error: Accessor<string | null>;
  /** Scope key for IndexedDB (gameId:walletPubkey) */
  scopeKey: Accessor<string | null>;
  /** Spawn location found after create/join (if any) */
  spawnLocation: Accessor<SpawnLocation | null>;

  /** Join an existing game by ID — fetches the Game account, inits player, finds spawn */
  joinGame: (gameId: bigint, rpcUrl: string, walletPubkey: string, keypair?: Keypair) => Promise<void>;
  /** Create a new game on-chain, init player, find spawn, and enter */
  createGame: (args: CreateGameArgs, rpcUrl: string, keypair: Keypair) => Promise<void>;
  /** Leave the current game session */
  leaveGame: () => void;
  /** Update the wallet pubkey (changes scope) */
  setWalletPubkey: (pubkey: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertGameRaw(raw: any): Game {
  let winCondition: Game["winCondition"];
  if (raw.winCondition.pointsBurning) {
    winCondition = {
      pointsBurning: {
        pointsPerMetal: BigInt(raw.winCondition.pointsBurning.pointsPerMetal.toString()),
      },
    };
  } else {
    winCondition = {
      raceToCenter: {
        minSpawnDistance: BigInt(raw.winCondition.raceToCenter.minSpawnDistance.toString()),
      },
    };
  }

  return {
    admin: raw.admin,
    gameId: BigInt(raw.gameId.toString()),
    mapDiameter: BigInt(raw.mapDiameter.toString()),
    gameSpeed: BigInt(raw.gameSpeed.toString()),
    startSlot: BigInt(raw.startSlot.toString()),
    endSlot: BigInt(raw.endSlot.toString()),
    winCondition,
    whitelist: raw.whitelist,
    serverPubkey: raw.serverPubkey ?? null,
    noiseThresholds: raw.noiseThresholds as NoiseThresholds,
    hashRounds: raw.hashRounds ?? DEFAULT_HASH_ROUNDS,
  };
}

// ---------------------------------------------------------------------------
// Arcium spawn planet helper
// ---------------------------------------------------------------------------

/**
 * Queue initSpawnPlanet MPC computation on-chain.
 * Fire-and-forget — logs warning on failure but doesn't throw.
 */
async function queueSpawnPlanet(
  program: Program,
  connection: Connection,
  keypair: Keypair,
  gameId: bigint,
  x: bigint,
  y: bigint,
  hashRounds: number
): Promise<void> {
  try {
    // Derive encryption key from planet hash (fog-of-war: knowing coords = decryption key)
    const planetHash = computePlanetHash(x, y, gameId, hashRounds);
    const planetPubkey = x25519.getPublicKey(planetHash);
    const encCtx = await setupEncryption(connection, program.programId);
    // Use planet-hash-derived key for cipher (shared secret with MXE)
    const sharedSecret = x25519.getSharedSecret(planetHash, encCtx.mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const { nonce, nonceValue } = generateNonce();
    const values = buildInitSpawnPlanetValues(x, y, 0n, 0n);
    const { packed } = encryptAndPack(cipher, values, nonce);

    const computationOffset = generateComputationOffset();
    const arciumAccts = getArciumAccountAddresses(
      program.programId,
      computationOffset,
      "init_spawn_planet"
    );

    const observerKey = x25519.utils.randomSecretKey();
    const observerPubkey = x25519.getPublicKey(observerKey);

    await buildQueueInitSpawnPlanetIx(
      program,
      keypair.publicKey,
      {
        gameId,
        computationOffset: BigInt(computationOffset.toString()),
        planetHash,
        ciphertexts: packed,
        pubkey: planetPubkey,
        nonce: nonceValue,
        observerPubkey,
      },
      arciumAccts
    )
      .signers([keypair])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("initSpawnPlanet queued successfully for", x.toString(), y.toString());
  } catch (e: any) {
    console.warn("initSpawnPlanet queue failed (non-blocking):", e.message);
  }
}

// ---------------------------------------------------------------------------
// Arcium process move helper
// ---------------------------------------------------------------------------

/**
 * Queue processMove MPC computation on-chain.
 * Sends ships from source planet to target planet.
 */
export async function queueProcessMove(
  program: Program,
  connection: Connection,
  keypair: Keypair,
  gameId: bigint,
  hashRounds: number,
  source: PlanetEntry,
  target: PlanetEntry,
  shipsToSend: bigint,
  metalToSend: bigint,
  gameSpeed: bigint
): Promise<void> {
  const sourceX = source.discovery.x;
  const sourceY = source.discovery.y;
  const targetX = target.discovery.x;
  const targetY = target.discovery.y;

  const sourcePlanetHash = computePlanetHash(sourceX, sourceY, gameId, hashRounds);
  const targetPlanetHash = computePlanetHash(targetX, targetY, gameId, hashRounds);

  const [sourceBodyPDA] = deriveCelestialBodyPDA(gameId, sourcePlanetHash, program.programId);
  const [sourcePendingPDA] = derivePendingMovesPDA(gameId, sourcePlanetHash, program.programId);
  const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetPlanetHash, program.programId);

  // Fetch target's pending moves to predict moveId for PDA derivation
  const targetPending = await fetchPendingMovesMetadata(program, gameId, targetPlanetHash);
  const predictedMoveId = targetPending.nextMoveId + BigInt(targetPending.queuedCount);
  const [moveAccountPDA] = derivePendingMoveAccountPDA(gameId, targetPlanetHash, predictedMoveId, program.programId);

  // Get current slot
  const currentSlot = BigInt(await connection.getSlot());

  // Compute distance and landing slot
  const distance = computeDistance(sourceX, sourceY, targetX, targetY);
  const sourceState = source.decrypted;
  const launchVelocity = sourceState ? sourceState.static.launchVelocity : 1n;
  const landingSlot = computeLandingSlot(currentSlot, distance, launchVelocity, gameSpeed);

  // Compute current ships/metal with lazy regen from on-chain snapshot
  let currentShips: bigint;
  let currentMetal: bigint;
  if (sourceState) {
    const lastSlot = 0n; // on-chain lastUpdatedSlot not directly exposed; use 0 as base
    currentShips = computeCurrentShips(
      sourceState.dynamic.shipCount,
      sourceState.static.maxShipCapacity,
      sourceState.static.shipGenSpeed,
      lastSlot,
      currentSlot,
      gameSpeed
    );
    currentMetal = computeCurrentMetal(
      sourceState.dynamic.metalCount,
      sourceState.static.maxMetalCapacity,
      sourceState.static.metalGenSpeed,
      lastSlot,
      currentSlot,
      gameSpeed
    );
  } else {
    currentShips = shipsToSend;
    currentMetal = metalToSend;
  }

  // Get player ID and source planet ID from decrypted state
  const playerId = sourceState ? sourceState.dynamic.ownerId : 0n;
  const sourcePlanetId = 0n; // planet ID is the hash-based identifier

  // Build move values for MPC circuit
  const moveValues = buildProcessMoveValues(
    playerId,
    sourcePlanetId,
    shipsToSend,
    metalToSend,
    sourceX,
    sourceY,
    targetX,
    targetY
  );

  // Encrypt move values with session encryption context (NOT planet-hash-derived key)
  const encCtx = await setupEncryption(connection, program.programId);
  const { nonce, nonceValue } = generateNonce();
  const { packed } = encryptAndPack(encCtx.cipher, moveValues, nonce);

  const computationOffset = generateComputationOffset();
  const arciumAccts = getArciumAccountAddresses(
    program.programId,
    computationOffset,
    "process_move"
  );

  await buildQueueProcessMoveIx(
    program,
    keypair.publicKey,
    {
      gameId,
      computationOffset: BigInt(computationOffset.toString()),
      landingSlot,
      currentShips,
      currentMetal,
      moveCts: packed,
      movePubkey: encCtx.publicKey,
      moveNonce: nonceValue,
      sourceBody: sourceBodyPDA,
      sourcePending: sourcePendingPDA,
      targetPending: targetPendingPDA,
      moveAccount: moveAccountPDA,
    },
    arciumAccts
  )
    .signers([keypair])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  console.log(
    "processMove queued:",
    `(${sourceX},${sourceY}) → (${targetX},${targetY})`,
    `ships=${shipsToSend}`
  );
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createGameSession(): GameSessionAPI {
  const [gameId, setGameId] = createSignal<bigint | null>(null);
  const [game, setGame] = createSignal<Game | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [walletPubkey, setWalletPubkeySignal] = createSignal<string | null>(null);
  const [spawnLocation, setSpawnLocation] = createSignal<SpawnLocation | null>(null);

  const thresholds = createMemo<NoiseThresholds>(() => {
    return game()?.noiseThresholds ?? DEFAULT_THRESHOLDS;
  });

  const hashRounds = createMemo<number>(() => {
    return game()?.hashRounds ?? DEFAULT_HASH_ROUNDS;
  });

  const mapDiameter = createMemo<number>(() => {
    const g = game();
    return g ? Number(g.mapDiameter) : 100;
  });

  const scopeKey = createMemo<string | null>(() => {
    const gid = gameId();
    const wp = walletPubkey();
    if (gid == null || !wp) return null;
    return `${gid.toString()}:${wp}`;
  });

  async function joinGame(gid: bigint, rpcUrl: string, walletPk: string, keypair?: Keypair): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const connection = new Connection(rpcUrl, "confirmed");

      // Create a read-only provider for fetching
      const readProvider = new AnchorProvider(
        connection,
        { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
        { commitment: "confirmed" }
      );

      const readProgram = new Program(idlJson as any, readProvider);
      const [gamePDA] = deriveGamePDA(gid, readProgram.programId);
      const raw = await (readProgram.account as any).game.fetch(gamePDA);
      const gameData = convertGameRaw(raw);

      // Build signing program if keypair is provided
      let signingProgram: Program | null = null;
      if (keypair) {
        const signingProvider = new AnchorProvider(
          connection,
          {
            publicKey: keypair.publicKey,
            signTransaction: async (tx: any) => { tx.sign(keypair); return tx; },
            signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(keypair)); return txs; },
          } as any,
          { commitment: "confirmed" }
        );
        signingProgram = new Program(idlJson as any, signingProvider);

        // Init player
        try {
          await buildInitPlayerIx(signingProgram, keypair.publicKey, gid).rpc();
        } catch (e: any) {
          // Player may already exist — ignore "already in use" errors
          if (!e.message?.includes("already in use")) {
            console.warn("initPlayer failed (may already exist):", e.message);
          }
        }
      }

      // Find a spawn planet
      const spawn = findSpawnPlanet(
        gid,
        gameData.noiseThresholds,
        Number(gameData.mapDiameter),
        100_000,
        gameData.hashRounds
      );
      setSpawnLocation({
        x: spawn.x,
        y: spawn.y,
        hash: spawn.hash,
        bodyType: spawn.properties!.bodyType,
        size: spawn.properties!.size,
        comets: spawn.properties!.comets,
      });

      // Queue initSpawnPlanet if we have a keypair (fire-and-forget)
      if (keypair && signingProgram) {
        queueSpawnPlanet(
          signingProgram, connection, keypair,
          gid, spawn.x, spawn.y, gameData.hashRounds
        ).catch(() => {});
      }

      setGameId(gid);
      setGame(gameData);
      setWalletPubkeySignal(walletPk);

      // Persist to game history
      saveRecentGame(gid, walletPk).catch(() => {});
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch game account");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function createGame(args: CreateGameArgs, rpcUrl: string, keypair: Keypair): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const provider = new AnchorProvider(
        connection,
        {
          publicKey: keypair.publicKey,
          signTransaction: async (tx: any) => { tx.sign(keypair); return tx; },
          signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(keypair)); return txs; },
        } as any,
        { commitment: "confirmed" }
      );

      const program = new Program(idlJson as any, provider);

      // 1. Create game on-chain
      await buildCreateGameIx(program, keypair.publicKey, args).rpc();

      // 2. Init player account for this wallet
      await buildInitPlayerIx(program, keypair.publicKey, args.gameId).rpc();

      // 3. Find a spawn planet near a random location
      const spawn = findSpawnPlanet(
        args.gameId,
        args.noiseThresholds,
        Number(args.mapDiameter),
        100_000,
        args.hashRounds
      );
      setSpawnLocation({
        x: spawn.x,
        y: spawn.y,
        hash: spawn.hash,
        bodyType: spawn.properties!.bodyType,
        size: spawn.properties!.size,
        comets: spawn.properties!.comets,
      });

      // 4. Queue initSpawnPlanet (fire-and-forget, don't block game entry)
      queueSpawnPlanet(
        program, connection, keypair,
        args.gameId, spawn.x, spawn.y, args.hashRounds
      ).catch(() => {});

      // Set session to the newly created game
      setGameId(args.gameId);
      setGame({
        admin: keypair.publicKey,
        gameId: args.gameId,
        mapDiameter: args.mapDiameter,
        gameSpeed: args.gameSpeed,
        startSlot: args.startSlot,
        endSlot: args.endSlot,
        winCondition: args.winCondition,
        whitelist: args.whitelist,
        serverPubkey: args.serverPubkey,
        noiseThresholds: args.noiseThresholds,
        hashRounds: args.hashRounds,
      });
      setWalletPubkeySignal(keypair.publicKey.toBase58());

      // Persist to game history
      saveRecentGame(args.gameId, keypair.publicKey.toBase58()).catch(() => {});
    } catch (err: any) {
      setError(err.message ?? "Failed to create game");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function leaveGame(): void {
    setGameId(null);
    setGame(null);
    setError(null);
    setWalletPubkeySignal(null);
    setSpawnLocation(null);
  }

  function setWalletPubkey(pubkey: string): void {
    setWalletPubkeySignal(pubkey);
  }

  return {
    gameId,
    game,
    thresholds,
    hashRounds,
    mapDiameter,
    loading,
    error,
    scopeKey,
    spawnLocation,
    joinGame,
    createGame,
    leaveGame,
    setWalletPubkey,
  };
}
