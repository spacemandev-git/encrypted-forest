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
  ShipCapacity = 0,
  MetalCapacity = 1,
  ShipGenSpeed = 2,
  MetalGenSpeed = 3,
  Range = 4,
  LaunchVelocity = 5,
}

/**
 * Upgrade focus choice. Matches on-chain `UpgradeFocus` enum.
 */
export enum UpgradeFocus {
  Range = 0,
  LaunchVelocity = 1,
}

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/**
 * Celestial body account state.
 * Matches on-chain `CelestialBody` account struct.
 * PDA: ["planet", game_id.to_le_bytes(), planet_hash]
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
