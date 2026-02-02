import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Type of celestial body. Matches on-chain `CelestialBodyType` enum.
 */
export enum CelestialBodyType {
  Planet = 0,
  Quasar = 1,
  SpacetimeRip = 2,
  AsteroidBelt = 3,
}

/**
 * Comet boost stat. Matches on-chain `CometBoost` enum.
 */
export enum CometBoost {
  ShipCapacity = 1,
  MetalCapacity = 2,
  ShipGenSpeed = 3,
  MetalGenSpeed = 4,
  Range = 5,
  LaunchVelocity = 6,
}

/**
 * Upgrade focus choice. Matches on-chain `UpgradeFocus` enum.
 */
export enum UpgradeFocus {
  Range = 0,
  LaunchVelocity = 1,
}

// ---------------------------------------------------------------------------
// Structs -- plaintext (client-side representation after decryption)
// ---------------------------------------------------------------------------

/**
 * Celestial body account state (plaintext, after decryption).
 * Used by the client for display and local computation.
 */
export interface CelestialBody {
  bodyType: CelestialBodyType;
  size: number;
  owner: PublicKey | null;
  shipCount: bigint;
  maxShipCapacity: bigint;
  shipGenSpeed: bigint;
  metalCount: bigint;
  maxMetalCapacity: bigint;
  metalGenSpeed: bigint;
  range: bigint;
  launchVelocity: bigint;
  level: number;
  comets: CometBoost[];
  lastUpdatedSlot: bigint;
  planetHash: Uint8Array;
}

/**
 * Properties derived from hash-based noise function.
 */
export interface CelestialBodyProperties {
  bodyType: CelestialBodyType;
  size: number;
  comets: CometBoost[];
}

/**
 * Base stats for a celestial body (before comet boosts).
 */
export interface CelestialBodyStats {
  maxShipCapacity: number;
  shipGenSpeed: number;
  maxMetalCapacity: number;
  metalGenSpeed: number;
  range: number;
  launchVelocity: number;
  nativeShips: number;
}

// ---------------------------------------------------------------------------
// Structs -- encrypted (raw on-chain account data)
// ---------------------------------------------------------------------------

/**
 * Raw on-chain EncryptedCelestialBody account.
 * Matches the Rust `EncryptedCelestialBody` struct.
 *
 * Has ONE encryption section:
 *   State (3 packed FEs): Pack<[u32;15]> containing body_type, size,
 *          max_ship_capacity, ship_gen_speed, max_metal_capacity,
 *          metal_gen_speed, range, launch_velocity, level, comet_0,
 *          comet_1, ship_count, metal_count, owner_exists, owner_id
 *
 * PDA: ["planet", game_id.to_le_bytes(), planet_hash]
 */
export interface EncryptedCelestialBodyAccount {
  planetHash: Uint8Array; // [u8; 32]
  lastUpdatedSlot: bigint;
  lastFlushedSlot: bigint;
  // State encryption section (3 packed FE ciphertexts)
  stateEncPubkey: Uint8Array; // [u8; 32] -- x25519 pubkey
  stateEncNonce: Uint8Array; // [u8; 16]
  stateEncCiphertexts: Uint8Array[]; // 3 x [u8; 32]
}

/** Number of encrypted field elements (Pack<[u32;15]> = 3 FEs). */
export const PLANET_STATE_FIELDS = 3;
