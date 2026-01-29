import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Events matching on-chain #[event] structs
// ---------------------------------------------------------------------------

/**
 * Emitted by init_planet_callback.
 * Contains encrypted planet hash and validity info.
 * Encrypted with observer key (Enc<Shared, InitPlanetRevealed>: 2 fields).
 */
export interface InitPlanetEvent {
  encryptedPlanetHash: Uint8Array; // [u8; 32]
  encryptedValid: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by init_spawn_planet_callback.
 * Contains encrypted planet hash, validity, and spawn validity.
 * Encrypted with observer key (Enc<Shared, SpawnPlanetRevealed>: 3 fields).
 */
export interface InitSpawnPlanetEvent {
  encryptedPlanetHash: Uint8Array; // [u8; 32]
  encryptedValid: Uint8Array; // [u8; 32]
  encryptedSpawnValid: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by process_move_callback.
 * Contains encrypted landing slot, surviving ships, and validity.
 * Encrypted with observer key (Enc<Shared, MoveRevealed>: 3 fields).
 */
export interface ProcessMoveEvent {
  encryptedLandingSlot: Uint8Array; // [u8; 32]
  encryptedSurvivingShips: Uint8Array; // [u8; 32]
  encryptedValid: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by flush_planet_callback.
 * Contains plaintext planet hash and flushed count (NOT encrypted).
 */
export interface FlushPlanetEvent {
  planetHash: Uint8Array; // [u8; 32]
  flushedCount: number; // u8
}

/**
 * Emitted by upgrade_planet_callback.
 * Contains plaintext planet hash + encrypted success flag and new level.
 * Encrypted with upgrade input key (Enc<Shared, UpgradeRevealed>: 2 fields).
 */
export interface UpgradePlanetEvent {
  planetHash: Uint8Array; // [u8; 32]
  encryptedSuccess: Uint8Array; // [u8; 32]
  encryptedNewLevel: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by broadcast.
 * Plaintext event revealing planet coordinates to all players.
 */
export interface BroadcastEvent {
  x: bigint;
  y: bigint;
  gameId: bigint;
  planetHash: Uint8Array; // [u8; 32]
  broadcaster: PublicKey;
}
