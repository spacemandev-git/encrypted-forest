import { PublicKey } from "@solana/web3.js";
import { UpgradeFocus } from "./celestialBody.js";

// ---------------------------------------------------------------------------
// Events matching on-chain #[event] structs
// ---------------------------------------------------------------------------

/**
 * Emitted by verify_spawn_coordinates_callback.
 * Contains encrypted spawn validation result.
 */
export interface SpawnResultEvent {
  encryptedValid: Uint8Array; // [u8; 32]
  encryptedHash0: Uint8Array; // [u8; 32]
  encryptedHash1: Uint8Array; // [u8; 32]
  encryptedHash2: Uint8Array; // [u8; 32]
  encryptedHash3: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by create_planet_key_callback.
 * Contains encrypted planet hash components.
 */
export interface PlanetKeyEvent {
  encryptedHash0: Uint8Array; // [u8; 32]
  encryptedHash1: Uint8Array; // [u8; 32]
  encryptedHash2: Uint8Array; // [u8; 32]
  encryptedHash3: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by resolve_combat_callback.
 * Contains encrypted combat outcome.
 */
export interface CombatResultEvent {
  encryptedAttackerRemaining: Uint8Array; // [u8; 32]
  encryptedDefenderRemaining: Uint8Array; // [u8; 32]
  encryptedAttackerWins: Uint8Array; // [u8; 32]
  encryptionKey: Uint8Array; // [u8; 32]
  nonce: Uint8Array; // [u8; 16]
}

/**
 * Emitted by move_ships.
 * Plaintext event showing ship movement.
 */
export interface MoveEvent {
  sourceHash: Uint8Array; // [u8; 32]
  targetHash: Uint8Array; // [u8; 32]
  shipsSent: bigint;
  shipsArriving: bigint;
  metalSent: bigint;
  landingSlot: bigint;
  player: PublicKey;
}

/**
 * Emitted by upgrade.
 * Plaintext event showing planet upgrade.
 */
export interface UpgradeEvent {
  planetHash: Uint8Array; // [u8; 32]
  newLevel: number;
  focus: UpgradeFocus;
  player: PublicKey;
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
