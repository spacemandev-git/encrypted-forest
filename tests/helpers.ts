/**
 * Shared test utilities for Encrypted Forest integration tests.
 *
 * Updated for the new encrypted architecture where all mutations go through
 * Arcium MPC circuits:
 *   queue_init_planet / init_planet_callback
 *   queue_init_spawn_planet / init_spawn_planet_callback
 *   queue_process_move / process_move_callback
 *   queue_flush_planet / flush_planet_callback
 *   queue_upgrade_planet / upgrade_planet_callback
 *
 * Provides helper functions for:
 * - blake3-based planet hash computation (matching on-chain logic)
 * - Hash-noise body determination (matching on-chain determine_celestial_body)
 * - PDA derivation for Game, Player, EncryptedCelestialBody, PendingMovesMetadata, PendingMoveAccount
 * - Brute-force spawn planet finder
 * - Game + player setup shortcuts
 * - Arcium computation infrastructure helpers
 * - Encryption helpers for building ciphertext payloads
 * - Queue instruction wrappers for all 5 MPC operations
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
  getArciumProgramId,
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

export enum UpgradeFocus {
  Range = 0,
  LaunchVelocity = 1,
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
  deadSpaceThreshold: 128,
  planetThreshold: 128,
  quasarThreshold: 192,
  spacetimeRipThreshold: 224,
  asteroidBeltThreshold: 255,
  sizeThreshold1: 43,
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

export function computePlanetHash(
  x: bigint,
  y: bigint,
  gameId: bigint,
  rounds: number = 1
): Uint8Array {
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true);
  view.setBigInt64(8, y, true);
  view.setBigUint64(16, gameId, true);
  let hash = blake3(new Uint8Array(buf));
  for (let r = 1; r < rounds; r++) {
    hash = blake3(hash);
  }
  return hash;
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

  if (byte0 < thresholds.deadSpaceThreshold) {
    return null;
  }

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
    if (second === comets[0]) {
      second = cometFromByte((byte5 + 1) & 0xff);
    }
    comets.push(second);
  }

  return { bodyType, size, comets };
}

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

export function derivePendingMoveAccountPDA(
  gameId: bigint,
  planetHash: Uint8Array,
  moveId: bigint,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  const moveBuf = Buffer.alloc(8);
  moveBuf.writeBigUInt64LE(moveId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("move"), buf, Buffer.from(planetHash), moveBuf],
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

export function findSpawnPlanet(
  gameId: bigint,
  thresholds: NoiseThresholds,
  mapDiameter: number = 1000,
  maxAttempts: number = 100_000
): SpawnCoordinate {
  const half = Math.floor(mapDiameter / 2);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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

  for (
    let attempt = startOffset;
    attempt < startOffset + maxAttempts;
    attempt++
  ) {
    const x = BigInt((attempt % mapDiameter) - half);
    const y = BigInt(Math.floor(attempt / mapDiameter) - half);

    if (x < -BigInt(half) || x > BigInt(half)) continue;
    if (y < -BigInt(half) || y > BigInt(half)) continue;

    const hash = computePlanetHash(x, y, gameId);
    const props = determineCelestialBody(hash, thresholds);

    if (
      props !== null &&
      props.bodyType === bodyType &&
      props.size >= minSize
    ) {
      return { x, y, hash, props };
    }
  }

  throw new Error(
    `Could not find a ${CelestialBodyType[bodyType]} (min size ${minSize}) after ${maxAttempts} attempts`
  );
}

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

export function readKpJson(path: string): Keypair {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

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
  hashRounds: number;
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
    endSlot: new BN(1_000_000_000),
    winCondition: { pointsBurning: { pointsPerMetal: new BN(1) } },
    whitelist: false,
    serverPubkey: null,
    noiseThresholds: DEFAULT_THRESHOLDS,
    hashRounds: 100,
    ...overrides,
  };
}

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
      anchorThresholds,
      config.hashRounds
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
 * Derive the Arcium sign PDA for this program.
 */
export function getSignPdaAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    programId
  )[0];
}

/**
 * Initialize all 5 computation definitions for the program.
 */
/**
 * Circuit base URL for offchain comp def storage (Cloudflare R2).
 * Must be set via CIRCUIT_BASE_URL env var.
 */
export const DEFAULT_CIRCUIT_BASE_URL = process.env.CIRCUIT_BASE_URL;
if (!DEFAULT_CIRCUIT_BASE_URL) {
  throw new Error("CIRCUIT_BASE_URL env var is required (e.g. https://<account>.r2.cloudflarestorage.com/<bucket>)");
}

export async function initAllCompDefs(
  program: Program<EncryptedForest>,
  payer: Keypair,
  circuitBaseUrl: string = DEFAULT_CIRCUIT_BASE_URL
): Promise<void> {
  const mxeAccount = getMXEAccAddress(program.programId);
  const arciumProgram = getArciumProgramId();

  const compDefNames = [
    "init_planet",
    "init_spawn_planet",
    "process_move",
    "flush_planet",
    "upgrade_planet",
  ];

  const methodNames = [
    "initCompDefInitPlanet",
    "initCompDefInitSpawnPlanet",
    "initCompDefProcessMove",
    "initCompDefFlushPlanet",
    "initCompDefUpgradePlanet",
  ] as const;

  for (let i = 0; i < compDefNames.length; i++) {
    const offsetBytes = getCompDefAccOffset(compDefNames[i]);
    const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();
    const compDefAddress = getCompDefAccAddress(program.programId, offsetU32);

    try {
      await (program.methods as any)
        [methodNames[i]](circuitBaseUrl)
        .accounts({
          payer: payer.publicKey,
          mxeAccount,
          compDefAccount: compDefAddress,
          arciumProgram,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc({ commitment: "confirmed" });
      console.log(`Initialized comp def: ${compDefNames[i]} (offchain: ${circuitBaseUrl}/${compDefNames[i]}.arcis)`);
    } catch (e: any) {
      console.log(
        `Comp def ${compDefNames[i]} may already be initialized:`,
        e.message?.substring(0, 100)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Encryption helpers for building ciphertext payloads
// ---------------------------------------------------------------------------

export interface EncryptionContext {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  cipher: RescueCipher;
}

/**
 * Set up encryption context with the MXE.
 */
export async function setupEncryption(
  provider: AnchorProvider,
  programId: PublicKey
): Promise<EncryptionContext> {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programId);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  return { privateKey, publicKey, mxePublicKey, sharedSecret, cipher };
}

/**
 * Encrypt values and pack into a single buffer.
 * Each encrypted value is a [u8; 32] ciphertext element.
 * Returns the packed buffer and the raw ciphertext array.
 */
export function encryptAndPack(
  cipher: RescueCipher,
  values: bigint[],
  nonce: Uint8Array
): { packed: Uint8Array; ciphertexts: Uint8Array[] } {
  const ciphertexts = cipher.encrypt(values, nonce);
  const packed = new Uint8Array(ciphertexts.length * 32);
  for (let i = 0; i < ciphertexts.length; i++) {
    packed.set(new Uint8Array(ciphertexts[i]), i * 32);
  }
  return { packed, ciphertexts };
}

/**
 * Build init_planet ciphertexts (2 values):
 * x(u64), y(u64)
 * Thresholds are passed as plaintext by the on-chain instruction from the Game account.
 */
export function buildInitPlanetValues(
  x: bigint,
  y: bigint,
): bigint[] {
  return [
    BigInt.asUintN(64, x),
    BigInt.asUintN(64, y),
  ];
}

/**
 * Build init_spawn_planet ciphertexts (4 values):
 * x(u64), y(u64), player_id(u64), source_planet_id(u64)
 */
export function buildInitSpawnPlanetValues(
  x: bigint,
  y: bigint,
  playerId: bigint,
  sourcePlanetId: bigint,
): bigint[] {
  return [
    BigInt.asUintN(64, x),
    BigInt.asUintN(64, y),
    playerId,
    sourcePlanetId,
  ];
}

/**
 * Build process_move ciphertexts (11 values):
 * player_id(u64), source_planet_id(u64), ships_to_send(u64), metal_to_send(u64),
 * source_x(u64), source_y(u64), target_x(u64), target_y(u64),
 * current_slot(u64), game_speed(u64), last_updated_slot(u64)
 */
export function buildProcessMoveValues(
  playerId: bigint,
  sourcePlanetId: bigint,
  shipsToSend: bigint,
  metalToSend: bigint,
  sourceX: bigint,
  sourceY: bigint,
  targetX: bigint,
  targetY: bigint,
  currentSlot: bigint,
  gameSpeed: bigint,
  lastUpdatedSlot: bigint,
): bigint[] {
  return [
    playerId,
    sourcePlanetId,
    shipsToSend,
    metalToSend,
    BigInt.asUintN(64, sourceX),
    BigInt.asUintN(64, sourceY),
    BigInt.asUintN(64, targetX),
    BigInt.asUintN(64, targetY),
    currentSlot,
    gameSpeed,
    lastUpdatedSlot,
  ];
}

/**
 * Build flush_planet ciphertexts (4 values - FlushTimingInput):
 * current_slot(u64), game_speed(u64), last_updated_slot(u64), flush_count(u64)
 * Move data is read from PendingMoveAccount PDAs via remaining_accounts.
 */
export function buildFlushPlanetValues(
  currentSlot: bigint,
  gameSpeed: bigint,
  lastUpdatedSlot: bigint,
  flushCount: bigint,
): bigint[] {
  return [
    currentSlot,
    gameSpeed,
    lastUpdatedSlot,
    flushCount,
  ];
}

/**
 * Build upgrade_planet ciphertexts (6 values):
 * player_id(u64), focus(u8 as u64), current_slot(u64),
 * game_speed(u64), last_updated_slot(u64), metal_upgrade_cost(u64)
 */
export function buildUpgradePlanetValues(
  playerId: bigint,
  focus: UpgradeFocus,
  currentSlot: bigint,
  gameSpeed: bigint,
  lastUpdatedSlot: bigint,
  metalUpgradeCost: bigint,
): bigint[] {
  return [
    playerId,
    BigInt(focus),
    currentSlot,
    gameSpeed,
    lastUpdatedSlot,
    metalUpgradeCost,
  ];
}

// ---------------------------------------------------------------------------
// Queue instruction helpers
// ---------------------------------------------------------------------------

/**
 * Get all Arcium account addresses needed for queue_* instructions.
 */
export function getArciumAccountAddresses(
  program: Program<EncryptedForest>,
  computationOffset: BN,
  compDefName: string
): Record<string, PublicKey> {
  const arciumEnv = getArciumEnv();
  const clusterOffset = arciumEnv.arciumClusterOffset;
  const offsetBytes = getCompDefAccOffset(compDefName);
  const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();

  return {
    signPdaAccount: getSignPdaAddress(program.programId),
    mxeAccount: getMXEAccAddress(program.programId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(
      clusterOffset,
      computationOffset
    ),
    compDefAccount: getCompDefAccAddress(program.programId, offsetU32),
    clusterAccount: getClusterAccAddress(clusterOffset),
    poolAccount: getPoolAccountAddress(),
    clockAccount: getClockAccountAddress(),
    arciumProgram: getArciumProgramId(),
    systemProgram: SystemProgram.programId,
  };
}

function getPoolAccountAddress(): PublicKey {
  try {
    const { getFeePoolAccAddress } = require("@arcium-hq/client");
    return getFeePoolAccAddress();
  } catch {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("FeePool")],
      getArciumProgramId()
    )[0];
  }
}

function getClockAccountAddress(): PublicKey {
  try {
    const { getClockAccAddress } = require("@arcium-hq/client");
    return getClockAccAddress();
  } catch {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ClockAccount")],
      getArciumProgramId()
    )[0];
  }
}

/**
 * Queue init_planet MPC computation.
 * Encrypted input: CoordInput (x, y) = 2 ciphertexts.
 * Thresholds are passed as plaintext by the on-chain instruction from Game account.
 */
export async function queueInitPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  x: bigint,
  y: bigint,
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN; planetPDA: PublicKey; pendingMovesPDA: PublicKey }> {
  const planetHash = computePlanetHash(x, y, gameId);
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [planetPDA] = derivePlanetPDA(gameId, planetHash, program.programId);
  const [pendingMovesPDA] = derivePendingMovesPDA(gameId, planetHash, program.programId);

  const nonce = randomBytes(16);
  const nonceValue = deserializeLE(nonce);
  const values = buildInitPlanetValues(x, y);
  const { packed } = encryptAndPack(encCtx.cipher, values, nonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "init_planet");

  // Observer pubkey -- use a random key for the observer encryption
  const observerKey = x25519.utils.randomSecretKey();
  const observerPubkey = x25519.getPublicKey(observerKey);

  await program.methods
    .queueInitPlanet(
      computationOffset,
      Array.from(planetHash) as any,
      Buffer.from(packed) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(nonceValue.toString()),
      Array.from(observerPubkey) as any
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset, planetPDA, pendingMovesPDA };
}

/**
 * Queue init_spawn_planet MPC computation.
 * Encrypted input: SpawnInput (x, y, player_id, source_planet_id) = 4 ciphertexts.
 * Thresholds are passed as plaintext by the on-chain instruction from Game account.
 */
export async function queueInitSpawnPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  x: bigint,
  y: bigint,
  playerId: bigint,
  sourcePlanetId: bigint,
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN; planetPDA: PublicKey; pendingMovesPDA: PublicKey; playerPDA: PublicKey }> {
  const planetHash = computePlanetHash(x, y, gameId);
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(gameId, payer.publicKey, program.programId);
  const [planetPDA] = derivePlanetPDA(gameId, planetHash, program.programId);
  const [pendingMovesPDA] = derivePendingMovesPDA(gameId, planetHash, program.programId);

  const nonce = randomBytes(16);
  const nonceValue = deserializeLE(nonce);
  const values = buildInitSpawnPlanetValues(x, y, playerId, sourcePlanetId);
  const { packed } = encryptAndPack(encCtx.cipher, values, nonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "init_spawn_planet");

  const observerKey = x25519.utils.randomSecretKey();
  const observerPubkey = x25519.getPublicKey(observerKey);

  await program.methods
    .queueInitSpawnPlanet(
      computationOffset,
      Array.from(planetHash) as any,
      Buffer.from(packed) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(nonceValue.toString()),
      Array.from(observerPubkey) as any
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      player: playerPDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset, planetPDA, pendingMovesPDA, playerPDA };
}

/**
 * Queue process_move MPC computation.
 * Planet state (static + dynamic) is read via .account() from source_body by the MPC.
 * Encrypted input: ProcessMoveInput (11 fields) = 11 ciphertexts.
 */
export async function queueProcessMove(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  sourceBody: PublicKey,
  sourcePending: PublicKey,
  targetPending: PublicKey,
  landingSlot: bigint,
  moveValues: bigint[],
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN }> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);

  const moveNonce = randomBytes(16);
  const moveNonceValue = deserializeLE(moveNonce);
  const { packed: movePacked } = encryptAndPack(encCtx.cipher, moveValues, moveNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "process_move");

  const observerKey = x25519.utils.randomSecretKey();
  const observerPubkey = x25519.getPublicKey(observerKey);

  await program.methods
    .queueProcessMove(
      computationOffset,
      new BN(landingSlot.toString()),
      Buffer.from(movePacked) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(moveNonceValue.toString()),
      Array.from(observerPubkey) as any
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      sourceBody,
      sourcePending,
      targetPending,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset };
}

/**
 * Queue flush_planet MPC computation.
 * Planet state (static + dynamic) is read via .account() from celestial_body by the MPC.
 * Move data is read via .account() from PendingMoveAccount PDAs (remaining_accounts).
 * Encrypted input: FlushTimingInput (4 fields) = 4 ciphertexts.
 */
export async function queueFlushPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  celestialBody: PublicKey,
  pendingMoves: PublicKey,
  flushCount: number,
  flushValues: bigint[],
  moveAccounts: PublicKey[],
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN }> {
  const flushNonce = randomBytes(16);
  const flushNonceValue = deserializeLE(flushNonce);
  const { packed: flushPacked } = encryptAndPack(encCtx.cipher, flushValues, flushNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "flush_planet");

  await program.methods
    .queueFlushPlanet(
      computationOffset,
      flushCount,
      Buffer.from(flushPacked) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(flushNonceValue.toString())
    )
    .accountsPartial({
      payer: payer.publicKey,
      celestialBody,
      pendingMoves,
      ...arciumAccts,
    })
    .remainingAccounts(
      moveAccounts.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset };
}

/**
 * Queue upgrade_planet MPC computation.
 * Planet state (static + dynamic) is read via .account() from celestial_body by the MPC.
 * Encrypted input: UpgradePlanetInput (6 fields) = 6 ciphertexts.
 */
export async function queueUpgradePlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  celestialBody: PublicKey,
  upgradeValues: bigint[],
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN }> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);

  const upgradeNonce = randomBytes(16);
  const upgradeNonceValue = deserializeLE(upgradeNonce);
  const { packed: upgradePacked } = encryptAndPack(encCtx.cipher, upgradeValues, upgradeNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "upgrade_planet");

  await program.methods
    .queueUpgradePlanet(
      computationOffset,
      Buffer.from(upgradePacked) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(upgradeNonceValue.toString())
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      celestialBody,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset };
}

// ---------------------------------------------------------------------------
// Unique game ID generator
// ---------------------------------------------------------------------------

let gameIdCounter = BigInt(Date.now());

export function nextGameId(): bigint {
  return gameIdCounter++;
}

// ---------------------------------------------------------------------------
// Re-exports from @arcium-hq/client for convenience
// ---------------------------------------------------------------------------
export {
  getArciumEnv,
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  RescueCipher,
  x25519,
  deserializeLE,
  awaitComputationFinalization,
};
