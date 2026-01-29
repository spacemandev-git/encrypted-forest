/**
 * Shared test utilities for Encrypted Forest integration tests.
 *
 * Provides helper functions for:
 * - blake3-based planet hash computation (matching on-chain logic)
 * - Hash-noise body determination (matching on-chain `determine_celestial_body`)
 * - PDA derivation for Game, Player, CelestialBody, PendingMoves
 * - Brute-force spawn planet finder
 * - Game + player setup shortcuts
 * - Arcium computation infrastructure helpers
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getArciumEnv,
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getMXEPublicKey,
  RescueCipher,
  x25519,
  deserializeLE,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import { blake3 } from "@noble/hashes/blake3.js";
import { randomBytes } from "crypto";
import type { EncryptedForest } from "../target/types/encrypted_forest";

// ---------------------------------------------------------------------------
// Program ID (from declare_id! in lib.rs)
// ---------------------------------------------------------------------------
export const PROGRAM_ID = new PublicKey(
  "4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c"
);

// ---------------------------------------------------------------------------
// Enums matching on-chain types
// ---------------------------------------------------------------------------

export enum CelestialBodyType {
  Planet = 0,
  Quasar = 1,
  SpacetimeRip = 2,
  AsteroidBelt = 3,
}

export enum CometBoost {
  ShipCapacity = 0,
  MetalCapacity = 1,
  ShipGenSpeed = 2,
  MetalGenSpeed = 3,
  Range = 4,
  LaunchVelocity = 5,
}

export interface NoiseThresholds {
  deadSpaceThreshold: number;
  planetThreshold: number;
  quasarThreshold: number;
  spacetimeRipThreshold: number;
  asteroidBeltThreshold: number;
  sizeThreshold1: number;
  sizeThreshold2: number;
  sizeThreshold3: number;
  sizeThreshold4: number;
  sizeThreshold5: number;
}

export interface CelestialBodyProperties {
  bodyType: CelestialBodyType;
  size: number;
  comets: CometBoost[];
}

export interface BaseStats {
  maxShipCapacity: number;
  shipGenSpeed: number;
  maxMetalCapacity: number;
  metalGenSpeed: number;
  range: number;
  launchVelocity: number;
  nativeShips: number;
}

// ---------------------------------------------------------------------------
// Default test configuration
// ---------------------------------------------------------------------------

export const DEFAULT_THRESHOLDS: NoiseThresholds = {
  deadSpaceThreshold: 128, // ~50% dead space
  planetThreshold: 128, // ~50% of bodies are planets
  quasarThreshold: 192, // ~25% quasars
  spacetimeRipThreshold: 224, // ~12% spacetime rips
  asteroidBeltThreshold: 255, // remainder are asteroid belts
  sizeThreshold1: 43, // ~17% miniscule
  sizeThreshold2: 86,
  sizeThreshold3: 128,
  sizeThreshold4: 171,
  sizeThreshold5: 214,
};

export const DEFAULT_GAME_SPEED = new BN(10000);
export const DEFAULT_MAP_DIAMETER = new BN(1000);

// ---------------------------------------------------------------------------
// blake3 hash (matching on-chain compute_planet_hash)
// ---------------------------------------------------------------------------

/**
 * Compute the planet hash from coordinates and game_id using blake3.
 * Must match the on-chain `compute_planet_hash(x: i64, y: i64, game_id: u64)`.
 *
 * Layout: x as i64 LE (8 bytes) || y as i64 LE (8 bytes) || game_id as u64 LE (8 bytes)
 */
export function computePlanetHash(
  x: bigint,
  y: bigint,
  gameId: bigint
): Uint8Array {
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true); // little-endian signed
  view.setBigInt64(8, y, true);
  view.setBigUint64(16, gameId, true);
  return blake3(new Uint8Array(buf));
}

// ---------------------------------------------------------------------------
// Hash-based noise (matching on-chain determine_celestial_body)
// ---------------------------------------------------------------------------

function cometFromByte(b: number): CometBoost {
  const m = b % 6;
  switch (m) {
    case 0:
      return CometBoost.ShipCapacity;
    case 1:
      return CometBoost.MetalCapacity;
    case 2:
      return CometBoost.ShipGenSpeed;
    case 3:
      return CometBoost.MetalGenSpeed;
    case 4:
      return CometBoost.Range;
    default:
      return CometBoost.LaunchVelocity;
  }
}

/**
 * Determine celestial body properties from a planet hash and noise thresholds.
 * Returns null if the hash represents dead space.
 * Matches on-chain `determine_celestial_body` exactly.
 */
export function determineCelestialBody(
  hash: Uint8Array,
  thresholds: NoiseThresholds
): CelestialBodyProperties | null {
  const byte0 = hash[0];
  const byte1 = hash[1];
  const byte2 = hash[2];
  const byte3 = hash[3];
  const byte4 = hash[4];
  const byte5 = hash[5];

  // Byte 0: dead space check
  if (byte0 < thresholds.deadSpaceThreshold) {
    return null;
  }

  // Byte 1: body type
  let bodyType: CelestialBodyType;
  if (byte1 < thresholds.planetThreshold) {
    bodyType = CelestialBodyType.Planet;
  } else if (byte1 < thresholds.quasarThreshold) {
    bodyType = CelestialBodyType.Quasar;
  } else if (byte1 < thresholds.spacetimeRipThreshold) {
    bodyType = CelestialBodyType.SpacetimeRip;
  } else {
    bodyType = CelestialBodyType.AsteroidBelt;
  }

  // Byte 2: size (1-6)
  let size: number;
  if (byte2 < thresholds.sizeThreshold1) {
    size = 1;
  } else if (byte2 < thresholds.sizeThreshold2) {
    size = 2;
  } else if (byte2 < thresholds.sizeThreshold3) {
    size = 3;
  } else if (byte2 < thresholds.sizeThreshold4) {
    size = 4;
  } else if (byte2 < thresholds.sizeThreshold5) {
    size = 5;
  } else {
    size = 6;
  }

  // Byte 3: comets
  let numComets: number;
  if (byte3 <= 216) {
    numComets = 0;
  } else if (byte3 <= 242) {
    numComets = 1;
  } else {
    numComets = 2;
  }

  const comets: CometBoost[] = [];
  if (numComets >= 1) {
    comets.push(cometFromByte(byte4));
  }
  if (numComets >= 2) {
    let second = cometFromByte(byte5);
    // Ensure second comet boosts a different stat
    if (second === comets[0]) {
      second = cometFromByte((byte5 + 1) & 0xff);
    }
    comets.push(second);
  }

  return { bodyType, size, comets };
}

/**
 * Compute base stats for a celestial body given its type and size.
 * Matches on-chain `base_stats`.
 */
export function baseStats(
  bodyType: CelestialBodyType,
  size: number
): BaseStats {
  const s = size;
  const sSq = s * s;

  switch (bodyType) {
    case CelestialBodyType.Planet:
      return {
        maxShipCapacity: 100 * sSq,
        shipGenSpeed: 1 * s,
        maxMetalCapacity: 0,
        metalGenSpeed: 0,
        range: 3 + s,
        launchVelocity: 1 + s,
        nativeShips: size === 1 ? 0 : 10 * s,
      };
    case CelestialBodyType.Quasar:
      return {
        maxShipCapacity: 500 * sSq,
        shipGenSpeed: 0,
        maxMetalCapacity: 500 * sSq,
        metalGenSpeed: 0,
        range: 2 + s,
        launchVelocity: 1 + s,
        nativeShips: 20 * s,
      };
    case CelestialBodyType.SpacetimeRip:
      return {
        maxShipCapacity: 50 * sSq,
        shipGenSpeed: 1 * s,
        maxMetalCapacity: 0,
        metalGenSpeed: 0,
        range: 2 + s,
        launchVelocity: 1 + s,
        nativeShips: 15 * s,
      };
    case CelestialBodyType.AsteroidBelt:
      return {
        maxShipCapacity: 80 * sSq,
        shipGenSpeed: 0,
        maxMetalCapacity: 200 * sSq,
        metalGenSpeed: 2 * s,
        range: 2 + s,
        launchVelocity: 1 + s,
        nativeShips: 10 * s,
      };
  }
}

/**
 * Apply comet boosts to stats. Each comet doubles one stat.
 */
export function applyCometBoosts(
  stats: BaseStats,
  comets: CometBoost[]
): BaseStats {
  const result = { ...stats };
  for (const comet of comets) {
    switch (comet) {
      case CometBoost.ShipCapacity:
        result.maxShipCapacity *= 2;
        break;
      case CometBoost.MetalCapacity:
        result.maxMetalCapacity *= 2;
        break;
      case CometBoost.ShipGenSpeed:
        result.shipGenSpeed *= 2;
        break;
      case CometBoost.MetalGenSpeed:
        result.metalGenSpeed *= 2;
        break;
      case CometBoost.Range:
        result.range *= 2;
        break;
      case CometBoost.LaunchVelocity:
        result.launchVelocity *= 2;
        break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Distance / decay / landing helpers (matching on-chain logic)
// ---------------------------------------------------------------------------

/**
 * Compute distance between two 2D points using the on-chain formula.
 * max(dx, dy) + min(dx, dy) / 2  (integer division)
 */
export function computeDistance(
  x1: bigint,
  y1: bigint,
  x2: bigint,
  y2: bigint
): bigint {
  const dx = x1 > x2 ? x1 - x2 : x2 - x1;
  const dy = y1 > y2 ? y1 - y2 : y2 - y1;
  const maxD = dx > dy ? dx : dy;
  const minD = dx > dy ? dy : dx;
  return maxD + minD / 2n;
}

/**
 * Ships remaining after distance decay: ships - (distance / range).
 */
export function applyDistanceDecay(
  ships: bigint,
  distance: bigint,
  range: bigint
): bigint {
  if (range === 0n) return 0n;
  const lost = distance / range;
  const remaining = ships - lost;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Compute landing slot: current_slot + distance * game_speed / launch_velocity.
 */
export function computeLandingSlot(
  currentSlot: bigint,
  distance: bigint,
  launchVelocity: bigint,
  gameSpeed: bigint
): bigint {
  if (launchVelocity === 0n) return BigInt(Number.MAX_SAFE_INTEGER);
  const travelTime = (distance * gameSpeed) / launchVelocity;
  return currentSlot + travelTime;
}

/**
 * Upgrade cost: 100 * 2^level
 */
export function upgradeCost(currentLevel: number): bigint {
  return 100n * (1n << BigInt(currentLevel));
}

// ---------------------------------------------------------------------------
// PDA derivation (matching on-chain seeds)
// ---------------------------------------------------------------------------

export function deriveGamePDA(
  gameId: bigint,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("game"), buf],
    programId
  );
}

export function derivePlayerPDA(
  gameId: bigint,
  playerPubkey: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player"), buf, playerPubkey.toBuffer()],
    programId
  );
}

export function derivePlanetPDA(
  gameId: bigint,
  planetHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("planet"), buf, Buffer.from(planetHash)],
    programId
  );
}

export function derivePendingMovesPDA(
  gameId: bigint,
  planetHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("moves"), buf, Buffer.from(planetHash)],
    programId
  );
}

// ---------------------------------------------------------------------------
// Brute-force spawn planet finder
// ---------------------------------------------------------------------------

export interface SpawnCoordinate {
  x: bigint;
  y: bigint;
  hash: Uint8Array;
  props: CelestialBodyProperties;
}

/**
 * Brute-force search for valid spawn coordinates.
 * A valid spawn planet is a Miniscule (size 1) Planet-type celestial body.
 *
 * Scans coordinates starting from (startX, startY) in a spiral pattern.
 */
export function findSpawnPlanet(
  gameId: bigint,
  thresholds: NoiseThresholds,
  mapDiameter: number = 1000,
  maxAttempts: number = 100_000
): SpawnCoordinate {
  const half = Math.floor(mapDiameter / 2);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Simple sequential scan -- good enough for tests
    const x = BigInt((attempt % mapDiameter) - half);
    const y = BigInt(Math.floor(attempt / mapDiameter) - half);

    if (x < -BigInt(half) || x > BigInt(half)) continue;
    if (y < -BigInt(half) || y > BigInt(half)) continue;

    const hash = computePlanetHash(x, y, gameId);
    const props = determineCelestialBody(hash, thresholds);

    if (
      props !== null &&
      props.bodyType === CelestialBodyType.Planet &&
      props.size === 1
    ) {
      return { x, y, hash, props };
    }
  }

  throw new Error(
    `Could not find a valid spawn planet after ${maxAttempts} attempts`
  );
}

/**
 * Find a planet of a specific type and minimum size.
 */
export function findPlanetOfType(
  gameId: bigint,
  thresholds: NoiseThresholds,
  bodyType: CelestialBodyType,
  minSize: number = 1,
  mapDiameter: number = 1000,
  maxAttempts: number = 100_000,
  startOffset: number = 0
): SpawnCoordinate {
  const half = Math.floor(mapDiameter / 2);

  for (let attempt = startOffset; attempt < startOffset + maxAttempts; attempt++) {
    const x = BigInt((attempt % mapDiameter) - half);
    const y = BigInt(Math.floor(attempt / mapDiameter) - half);

    if (x < -BigInt(half) || x > BigInt(half)) continue;
    if (y < -BigInt(half) || y > BigInt(half)) continue;

    const hash = computePlanetHash(x, y, gameId);
    const props = determineCelestialBody(hash, thresholds);

    if (props !== null && props.bodyType === bodyType && props.size >= minSize) {
      return { x, y, hash, props };
    }
  }

  throw new Error(
    `Could not find a ${CelestialBodyType[bodyType]} (min size ${minSize}) after ${maxAttempts} attempts`
  );
}

/**
 * Find coordinates that are dead space (no celestial body).
 */
export function findDeadSpace(
  gameId: bigint,
  thresholds: NoiseThresholds,
  mapDiameter: number = 1000
): { x: bigint; y: bigint; hash: Uint8Array } {
  const half = Math.floor(mapDiameter / 2);

  for (let attempt = 0; attempt < 100_000; attempt++) {
    const x = BigInt((attempt % mapDiameter) - half);
    const y = BigInt(Math.floor(attempt / mapDiameter) - half);

    const hash = computePlanetHash(x, y, gameId);
    const props = determineCelestialBody(hash, thresholds);

    if (props === null) {
      return { x, y, hash };
    }
  }

  throw new Error("Could not find dead space coordinates");
}

// ---------------------------------------------------------------------------
// Anchor program + provider setup
// ---------------------------------------------------------------------------

export function getProviderAndProgram(): {
  provider: AnchorProvider;
  program: Program<EncryptedForest>;
} {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as AnchorProvider;
  const program = anchor.workspace
    .EncryptedForest as Program<EncryptedForest>;
  return { provider, program };
}

/**
 * Read a keypair from a JSON file (Solana CLI format).
 */
export function readKpJson(path: string): Keypair {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Airdrop SOL to a keypair (local validator only).
 */
export async function airdrop(
  provider: AnchorProvider,
  pubkey: PublicKey,
  amount: number = 10
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    amount * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

// ---------------------------------------------------------------------------
// Game + Player shortcut
// ---------------------------------------------------------------------------

export interface GameConfig {
  gameId: bigint;
  mapDiameter: BN;
  gameSpeed: BN;
  startSlot: BN;
  endSlot: BN;
  winCondition: object;
  whitelist: boolean;
  serverPubkey: PublicKey | null;
  noiseThresholds: NoiseThresholds;
}

export function defaultGameConfig(
  gameId: bigint,
  overrides?: Partial<GameConfig>
): GameConfig {
  return {
    gameId,
    mapDiameter: DEFAULT_MAP_DIAMETER,
    gameSpeed: DEFAULT_GAME_SPEED,
    startSlot: new BN(0),
    endSlot: new BN(1_000_000_000), // very far future
    winCondition: { pointsBurning: { pointsPerMetal: new BN(1) } },
    whitelist: false,
    serverPubkey: null,
    noiseThresholds: DEFAULT_THRESHOLDS,
    ...overrides,
  };
}

/**
 * Create a game, returning the game PDA.
 */
export async function createGame(
  program: Program<EncryptedForest>,
  admin: Keypair,
  config: GameConfig
): Promise<PublicKey> {
  const [gamePDA] = deriveGamePDA(config.gameId, program.programId);

  const anchorThresholds = {
    deadSpaceThreshold: config.noiseThresholds.deadSpaceThreshold,
    planetThreshold: config.noiseThresholds.planetThreshold,
    quasarThreshold: config.noiseThresholds.quasarThreshold,
    spacetimeRipThreshold: config.noiseThresholds.spacetimeRipThreshold,
    asteroidBeltThreshold: config.noiseThresholds.asteroidBeltThreshold,
    sizeThreshold1: config.noiseThresholds.sizeThreshold1,
    sizeThreshold2: config.noiseThresholds.sizeThreshold2,
    sizeThreshold3: config.noiseThresholds.sizeThreshold3,
    sizeThreshold4: config.noiseThresholds.sizeThreshold4,
    sizeThreshold5: config.noiseThresholds.sizeThreshold5,
  };

  await program.methods
    .createGame(
      new BN(config.gameId.toString()),
      config.mapDiameter,
      config.gameSpeed,
      config.startSlot,
      config.endSlot,
      config.winCondition as any,
      config.whitelist,
      config.serverPubkey,
      anchorThresholds
    )
    .accounts({
      admin: admin.publicKey,
      game: gamePDA,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc({ commitment: "confirmed" });

  return gamePDA;
}

/**
 * Initialize a player for a game.
 */
export async function initPlayer(
  program: Program<EncryptedForest>,
  owner: Keypair,
  gameId: bigint,
  server?: Keypair
): Promise<PublicKey> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(
    gameId,
    owner.publicKey,
    program.programId
  );

  const accounts: any = {
    owner: owner.publicKey,
    game: gamePDA,
    player: playerPDA,
    systemProgram: SystemProgram.programId,
  };

  if (server) {
    accounts.server = server.publicKey;
  }

  const signers = server ? [owner, server] : [owner];

  await program.methods
    .initPlayer(new BN(gameId.toString()))
    .accounts(accounts)
    .signers(signers)
    .rpc({ commitment: "confirmed" });

  return playerPDA;
}

/**
 * Create planet on-chain (plaintext coordinates, after hash is known).
 */
export async function createPlanetOnChain(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  x: bigint,
  y: bigint,
  planetHash: Uint8Array
): Promise<{ planetPDA: PublicKey; pendingMovesPDA: PublicKey }> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [planetPDA] = derivePlanetPDA(gameId, planetHash, program.programId);
  const [pendingMovesPDA] = derivePendingMovesPDA(
    gameId,
    planetHash,
    program.programId
  );

  await program.methods
    .createPlanet(
      new BN(gameId.toString()),
      new BN(x.toString()),
      new BN(y.toString()),
      Array.from(planetHash) as any
    )
    .accounts({
      payer: payer.publicKey,
      game: gamePDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc({ commitment: "confirmed" });

  return { planetPDA, pendingMovesPDA };
}

/**
 * Claim a spawn planet for a player.
 */
export async function claimSpawnPlanet(
  program: Program<EncryptedForest>,
  owner: Keypair,
  gameId: bigint,
  planetHash: Uint8Array
): Promise<void> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(
    gameId,
    owner.publicKey,
    program.programId
  );
  const [planetPDA] = derivePlanetPDA(gameId, planetHash, program.programId);

  await program.methods
    .claimSpawnPlanet(
      new BN(gameId.toString()),
      Array.from(planetHash) as any
    )
    .accounts({
      owner: owner.publicKey,
      game: gamePDA,
      player: playerPDA,
      celestialBody: planetPDA,
    })
    .signers([owner])
    .rpc({ commitment: "confirmed" });
}

/**
 * Full setup: create game + init player + find spawn planet + create planet + claim it.
 * Returns all relevant PDAs and coordinates.
 */
export async function fullSpawnSetup(
  program: Program<EncryptedForest>,
  provider: AnchorProvider,
  admin: Keypair,
  player: Keypair,
  gameId: bigint,
  configOverrides?: Partial<GameConfig>
): Promise<{
  gamePDA: PublicKey;
  playerPDA: PublicKey;
  planetPDA: PublicKey;
  pendingMovesPDA: PublicKey;
  spawn: SpawnCoordinate;
  config: GameConfig;
}> {
  const config = defaultGameConfig(gameId, configOverrides);
  const gamePDA = await createGame(program, admin, config);
  const playerPDA = await initPlayer(program, player, gameId);

  const spawn = findSpawnPlanet(gameId, config.noiseThresholds);
  const { planetPDA, pendingMovesPDA } = await createPlanetOnChain(
    program,
    player,
    gameId,
    spawn.x,
    spawn.y,
    spawn.hash
  );

  // For tests that do not use Arcium, we need to manually mark the player as spawned.
  // Since the spawn instruction requires Arcium MPC, we use claimSpawnPlanet after
  // marking has_spawned. In real flow, the Arcium callback does this.
  // For non-Arcium tests we will skip the spawn instruction and just create+claim.
  // NOTE: claim_spawn_planet requires player.has_spawned == true, which is set by
  // the Arcium callback. For pure on-chain tests without Arcium, we need a workaround.
  // We will test claimSpawnPlanet separately where has_spawned can be set.

  return { gamePDA, playerPDA, planetPDA, pendingMovesPDA, spawn, config };
}

/**
 * Helper to create a second planet (non-spawn) for movement tests.
 * Finds any celestial body and creates it on chain.
 */
export async function createSecondPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  thresholds: NoiseThresholds,
  bodyType?: CelestialBodyType,
  startOffset: number = 50_000
): Promise<{
  x: bigint;
  y: bigint;
  hash: Uint8Array;
  props: CelestialBodyProperties;
  planetPDA: PublicKey;
  pendingMovesPDA: PublicKey;
}> {
  const coord = findPlanetOfType(
    gameId,
    thresholds,
    bodyType ?? CelestialBodyType.Planet,
    2, // min size 2 so it has native ships
    1000,
    100_000,
    startOffset
  );

  const { planetPDA, pendingMovesPDA } = await createPlanetOnChain(
    program,
    payer,
    gameId,
    coord.x,
    coord.y,
    coord.hash
  );

  return {
    x: coord.x,
    y: coord.y,
    hash: coord.hash,
    props: coord.props,
    planetPDA,
    pendingMovesPDA,
  };
}

// ---------------------------------------------------------------------------
// Arcium helpers
// ---------------------------------------------------------------------------

/**
 * Get MXE public key with retries (MXE may not be ready immediately).
 */
export async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(
        `Attempt ${attempt} failed to fetch MXE public key:`,
        error
      );
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

/**
 * Initialize all computation definitions for the program.
 */
export async function initAllCompDefs(
  program: Program<EncryptedForest>,
  payer: Keypair
): Promise<void> {
  const mxeAccount = getMXEAccAddress(program.programId);

  // Init create_planet_key comp def
  const cpkOffset = Buffer.from(
    getCompDefAccOffset("create_planet_key")
  ).readUInt32LE();
  const cpkCompDef = getCompDefAccAddress(program.programId, cpkOffset);

  await program.methods
    .initCompDefCreatePlanetKey()
    .accounts({
      payer: payer.publicKey,
      mxeAccount,
      compDefAccount: cpkCompDef,
    })
    .signers([payer])
    .rpc({ commitment: "confirmed" });

  // Init verify_spawn_coordinates comp def
  const vsOffset = Buffer.from(
    getCompDefAccOffset("verify_spawn_coordinates")
  ).readUInt32LE();
  const vsCompDef = getCompDefAccAddress(program.programId, vsOffset);

  await program.methods
    .initCompDefVerifySpawn()
    .accounts({
      payer: payer.publicKey,
      mxeAccount,
      compDefAccount: vsCompDef,
    })
    .signers([payer])
    .rpc({ commitment: "confirmed" });

  // Init resolve_combat comp def
  const rcOffset = Buffer.from(
    getCompDefAccOffset("resolve_combat")
  ).readUInt32LE();
  const rcCompDef = getCompDefAccAddress(program.programId, rcOffset);

  await program.methods
    .initCompDefResolveCombat()
    .accounts({
      payer: payer.publicKey,
      mxeAccount,
      compDefAccount: rcCompDef,
    })
    .signers([payer])
    .rpc({ commitment: "confirmed" });
}

// ---------------------------------------------------------------------------
// Unique game ID generator (prevents PDA collisions between tests)
// ---------------------------------------------------------------------------

let gameIdCounter = BigInt(Date.now());

export function nextGameId(): bigint {
  return gameIdCounter++;
}
