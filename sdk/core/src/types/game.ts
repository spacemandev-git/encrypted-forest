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
}

/**
 * Default noise thresholds for testing/development.
 */
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
