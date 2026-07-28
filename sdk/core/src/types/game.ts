import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Win condition for a game.
 * Matches on-chain `WinCondition` enum.
 */
export type WinCondition =
  | { pointsBurning: { pointsPerMetal: bigint } }
  | { raceToCenter: { minSpawnDistance: bigint } };

/**
 * Anchor-compatible win condition (uses number instead of bigint for BN compat).
 */
export type WinConditionAnchor =
  | { pointsBurning: { pointsPerMetal: any } }
  | { raceToCenter: { minSpawnDistance: any } };

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/**
 * Noise thresholds configuration for celestial body determination.
 * Matches on-chain `NoiseThresholds` struct.
 */
export interface NoiseThresholds {
  /**
   * Minimum 32-bit existence scan value for a coordinate to hold a body.
   * Compared against `existenceScan(propertyHash)`. Range 0..2^32-1.
   *
   * Density is `(2^32 - deadSpaceThreshold) / 2^32`, and expected hashes to
   * find one body is the reciprocal. This is the scan-difficulty knob: it is
   * free for the MPC circuit, unlike iterated hash rounds.
   */
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

/**
 * Game account state.
 * Matches on-chain `Game` account struct.
 * PDA: ["game", game_id.to_le_bytes()]
 */
export interface Game {
  admin: PublicKey;
  gameId: bigint;
  mapDiameter: bigint;
  gameSpeed: bigint;
  startSlot: bigint;
  endSlot: bigint;
  winCondition: WinCondition;
  whitelist: boolean;
  serverPubkey: PublicKey | null;
  noiseThresholds: NoiseThresholds;
  /** Iterated BLAKE3 rounds for planet hash difficulty. Default: 100. */
  hashRounds: number;
}

/**
 * Default noise thresholds for testing/development.
 */
export const DEFAULT_THRESHOLDS: NoiseThresholds = {
  // 253 << 24. Equivalent to the old byte rule `hash[0] >= 253`: 3/256 of
  // coords hold a body (~1.17%), i.e. ~85 hashes scanned per body found.
  // Raise this to make scanning harder; 4_294_714_651 would be ~1/17,000,
  // matching what 200 hash rounds used to cost the client -- at no cost to
  // the circuit.
  deadSpaceThreshold: 4_244_635_648,
  planetThreshold: 128,
  quasarThreshold: 192,
  spacetimeRipThreshold: 224,
  asteroidBeltThreshold: 255,
  // Exponential rarity: size 1 ~50%, size 2 ~25%, size 3 ~12%, size 4 ~6%, size 5 ~4%, size 6 ~3%
  sizeThreshold1: 128,
  sizeThreshold2: 192,
  sizeThreshold3: 224,
  sizeThreshold4: 240,
  sizeThreshold5: 250,
};

export const DEFAULT_HASH_ROUNDS = 1;
