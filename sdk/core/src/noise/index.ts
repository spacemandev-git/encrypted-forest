/**
 * Hash-based noise module.
 *
 * Uses blake3 hashing to deterministically derive celestial body properties
 * from (x, y, gameId) coordinates. Must produce identical results to the
 * on-chain Rust implementation in lib.rs.
 */

import { blake3 } from "@noble/hashes/blake3.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import type { NoiseThresholds } from "../types/game.js";
import {
  CelestialBodyType,
  CometBoost,
  type CelestialBodyProperties,
  type CelestialBodyStats,
} from "../types/celestialBody.js";

// ---------------------------------------------------------------------------
// Planet hash computation (matching on-chain compute_planet_hash)
// ---------------------------------------------------------------------------

/**
 * Compute the planet hash from coordinates and game_id using blake3.
 * Must match the on-chain `compute_planet_hash(x: i64, y: i64, game_id: u64)`.
 *
 * Layout: x as i64 LE (8 bytes) || y as i64 LE (8 bytes) || game_id as u64 LE (8 bytes)
 * Total: 24 bytes input -> 32 bytes blake3 output
 */
export function computePlanetHash(
  x: bigint,
  y: bigint,
  gameId: bigint,
  rounds: number = 1
): Uint8Array {
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true); // little-endian signed i64
  view.setBigInt64(8, y, true); // little-endian signed i64
  view.setBigUint64(16, gameId, true); // little-endian unsigned u64
  let hash = blake3(new Uint8Array(buf));
  for (let r = 1; r < rounds; r++) {
    hash = blake3(hash);
  }
  return hash;
}

// ---------------------------------------------------------------------------
// MPC-compatible SHA3-256 hash (must match encrypted-ixs/src/lib.rs compute_property_hash)
// ---------------------------------------------------------------------------

/**
 * Compute the MPC-compatible SHA3-256 property hash for a coordinate.
 * Must match the Arcis MPC circuit's `compute_property_hash` exactly.
 *
 * Input: 32 bytes = x LE i64 (8) || y LE i64 (8) || gameId LE u64 (8) || zeros (8)
 * Iterated: hash_0 = sha3_256(input), hash_n = sha3_256(hash_{n-1})
 * Returns 32-byte hash; bytes [0..5] are used for property determination.
 */
export function computePropertyHash(
  x: bigint,
  y: bigint,
  gameId: bigint,
  rounds: number = 1
): Uint8Array {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true);    // x as i64 LE
  view.setBigInt64(8, y, true);    // y as i64 LE
  view.setBigUint64(16, gameId, true); // gameId as u64 LE
  // bytes 24..31 are zero (padding)

  let hash = sha3_256(new Uint8Array(buf));
  for (let r = 1; r < rounds; r++) {
    hash = sha3_256(hash);
  }
  return hash;
}

/** @deprecated Use computePropertyHash instead. */
export const mixHashBytes = computePropertyHash;

// ---------------------------------------------------------------------------
// Comet determination helper
// ---------------------------------------------------------------------------

/**
 * Comet value from byte. Returns 1-6 (CometBoost enum values).
 * 0 means "no comet" and is never returned by this function.
 */
function cometFromByte(b: number): CometBoost {
  return ((b % 6) + 1) as CometBoost;
}

// ---------------------------------------------------------------------------
// Celestial body determination (matching on-chain determine_celestial_body)
// ---------------------------------------------------------------------------

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

  // Byte 3: comets (0-216 = none, >216 = one, >242 = two)
  // Comet values are 1-6 (0 = no comet)
  const comet0Raw = cometFromByte(byte4);
  let comet1Raw = cometFromByte(byte5);
  if (comet1Raw === comet0Raw) {
    comet1Raw = cometFromByte((byte5 + 1) & 0xff);
  }

  const comet0 = byte3 > 216 ? comet0Raw : 0;
  const comet1 = byte3 > 242 ? comet1Raw : 0;

  const comets: CometBoost[] = [];
  if (comet0 !== 0) comets.push(comet0 as CometBoost);
  if (comet1 !== 0) comets.push(comet1 as CometBoost);

  return { bodyType, size, comets };
}

// ---------------------------------------------------------------------------
// Base stats (matching on-chain base_stats)
// ---------------------------------------------------------------------------

/**
 * Compute base stats for a celestial body given its type and size.
 * Capacities scale quadratically with size, gen speeds scale linearly.
 * Matches on-chain `base_stats`.
 */
export function baseStats(
  bodyType: CelestialBodyType,
  size: number
): CelestialBodyStats {
  const s = size;
  const sSq = s * s;
  const pow2Ceil = (value: number): number => {
    if (value <= 1) return 1;
    if (value <= 2) return 2;
    if (value <= 4) return 4;
    if (value <= 8) return 8;
    if (value <= 16) return 16;
    if (value <= 32) return 32;
    if (value <= 64) return 64;
    if (value <= 128) return 128;
    return 256;
  };

  switch (bodyType) {
    case CelestialBodyType.Planet:
      return {
        maxShipCapacity: 100 * sSq,
        shipGenSpeed: 1 * s,
        maxMetalCapacity: 0,
        metalGenSpeed: 0,
        range: pow2Ceil(3 + s),
        launchVelocity: pow2Ceil(1 + s),
        nativeShips: size === 1 ? 0 : 10 * s,
      };
    case CelestialBodyType.Quasar:
      return {
        maxShipCapacity: 500 * sSq,
        shipGenSpeed: 0,
        maxMetalCapacity: 500 * sSq,
        metalGenSpeed: 0,
        range: pow2Ceil(2 + s),
        launchVelocity: pow2Ceil(1 + s),
        nativeShips: 20 * s,
      };
    case CelestialBodyType.SpacetimeRip:
      return {
        maxShipCapacity: 50 * sSq,
        shipGenSpeed: 1 * s,
        maxMetalCapacity: 0,
        metalGenSpeed: 0,
        range: pow2Ceil(2 + s),
        launchVelocity: pow2Ceil(1 + s),
        nativeShips: 15 * s,
      };
    case CelestialBodyType.AsteroidBelt:
      return {
        maxShipCapacity: 80 * sSq,
        shipGenSpeed: 0,
        maxMetalCapacity: 200 * sSq,
        metalGenSpeed: 2 * s,
        range: pow2Ceil(2 + s),
        launchVelocity: pow2Ceil(1 + s),
        nativeShips: 10 * s,
      };
  }
}

// ---------------------------------------------------------------------------
// Comet boosts (matching on-chain apply_comet_boosts)
// ---------------------------------------------------------------------------

/**
 * Apply comet boosts to stats. Each comet doubles one stat.
 * Returns a new stats object (does not mutate the input).
 */
export function applyCometBoosts(
  stats: CelestialBodyStats,
  comets: CometBoost[]
): CelestialBodyStats {
  const result = { ...stats };
  for (const comet of comets) {
    if ((comet as number) === 0) continue; // 0 = no comet
    switch (comet) {
      case CometBoost.ShipCapacity:   // 1
        result.maxShipCapacity *= 2;
        break;
      case CometBoost.MetalCapacity:  // 2
        result.maxMetalCapacity *= 2;
        break;
      case CometBoost.ShipGenSpeed:   // 3
        result.shipGenSpeed *= 2;
        break;
      case CometBoost.MetalGenSpeed:  // 4
        result.metalGenSpeed *= 2;
        break;
      case CometBoost.Range:          // 5
        result.range *= 2;
        break;
      case CometBoost.LaunchVelocity: // 6
        result.launchVelocity *= 2;
        break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Game mechanics helpers (matching on-chain logic)
// ---------------------------------------------------------------------------

/**
 * Compute current ship count via lazy generation.
 * Matches on-chain `compute_current_ships`.
 */
export function computeCurrentShips(
  lastShipCount: bigint,
  maxCapacity: bigint,
  genSpeed: bigint,
  lastUpdatedSlot: bigint,
  currentSlot: bigint,
  gameSpeed: bigint
): bigint {
  if (genSpeed === 0n || currentSlot <= lastUpdatedSlot || gameSpeed === 0n) {
    return lastShipCount;
  }
  const elapsed = currentSlot - lastUpdatedSlot;
  const generated = (genSpeed * elapsed * 10000n) / gameSpeed;
  const total = lastShipCount + generated;
  return total < maxCapacity ? total : maxCapacity;
}

/**
 * Compute current metal count via lazy generation.
 * Matches on-chain `compute_current_metal`.
 */
export function computeCurrentMetal(
  lastMetalCount: bigint,
  maxCapacity: bigint,
  genSpeed: bigint,
  lastUpdatedSlot: bigint,
  currentSlot: bigint,
  gameSpeed: bigint
): bigint {
  if (genSpeed === 0n || currentSlot <= lastUpdatedSlot || gameSpeed === 0n) {
    return lastMetalCount;
  }
  const elapsed = currentSlot - lastUpdatedSlot;
  const generated = (genSpeed * elapsed * 10000n) / gameSpeed;
  const total = lastMetalCount + generated;
  return total < maxCapacity ? total : maxCapacity;
}

/**
 * Compute distance between two 2D points using the on-chain formula.
 * max(dx, dy) + min(dx, dy) / 2  (integer division)
 * Matches on-chain `compute_distance`.
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
 * Matches on-chain `apply_distance_decay`.
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
 * Compute landing slot. game_speed=10000 is 1x; lower = faster.
 * Formula: current_slot + distance * game_speed / (launch_velocity * 10000)
 * Matches on-chain `compute_landing_slot`.
 */
export function computeLandingSlot(
  currentSlot: bigint,
  distance: bigint,
  launchVelocity: bigint,
  gameSpeed: bigint
): bigint {
  if (launchVelocity === 0n) return BigInt(Number.MAX_SAFE_INTEGER);
  const travelTime = (distance * gameSpeed) / (launchVelocity * 10000n);
  return currentSlot + travelTime;
}

/**
 * Upgrade cost: 100 * 2^level.
 * Matches on-chain `upgrade_cost`.
 */
export function upgradeCost(currentLevel: number): bigint {
  return 100n * (1n << BigInt(currentLevel));
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

/**
 * Coordinate with its hash and properties (if not dead space).
 */
export interface ScannedCoordinate {
  x: bigint;
  y: bigint;
  hash: Uint8Array;
  properties: CelestialBodyProperties | null;
}

/**
 * Scan a single coordinate and return its properties.
 * Uses SHA3-256 for property determination (matching MPC circuit)
 * and blake3 hash for PDA seed / decryption key.
 */
export function scanCoordinate(
  x: bigint,
  y: bigint,
  gameId: bigint,
  thresholds: NoiseThresholds,
  rounds: number = 1
): ScannedCoordinate {
  const hash = computePlanetHash(x, y, gameId, rounds);
  const propHash = computePropertyHash(x, y, gameId, rounds);
  const properties = determineCelestialBody(propHash, thresholds);
  return { x, y, hash, properties };
}

/**
 * Scan a rectangular range of coordinates.
 * Returns only coordinates that contain celestial bodies (non-dead-space).
 * Property determination uses SHA3-256 (matching MPC circuit).
 */
export function scanRange(
  startX: bigint,
  startY: bigint,
  endX: bigint,
  endY: bigint,
  gameId: bigint,
  thresholds: NoiseThresholds,
  rounds: number = 1
): ScannedCoordinate[] {
  const results: ScannedCoordinate[] = [];
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const scanned = scanCoordinate(x, y, gameId, thresholds, rounds);
      if (scanned.properties !== null) {
        results.push(scanned);
      }
    }
  }
  return results;
}

/**
 * Find a valid spawn planet (Miniscule Planet, size 1).
 * Scans coordinates sequentially until one is found.
 * Uses SHA3-256 for property determination (matching MPC circuit).
 */
export function findSpawnPlanet(
  gameId: bigint,
  thresholds: NoiseThresholds,
  mapDiameter: number = 1000,
  maxAttempts: number = 100_000,
  rounds: number = 1
): ScannedCoordinate {
  const half = Math.floor(mapDiameter / 2);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = BigInt((attempt % mapDiameter) - half);
    const y = BigInt(Math.floor(attempt / mapDiameter) - half);

    if (x < -BigInt(half) || x > BigInt(half)) continue;
    if (y < -BigInt(half) || y > BigInt(half)) continue;

    const propHash = computePropertyHash(x, y, gameId, rounds);
    const properties = determineCelestialBody(propHash, thresholds);

    if (
      properties !== null &&
      properties.bodyType === CelestialBodyType.Planet &&
      properties.size === 1
    ) {
      const hash = computePlanetHash(x, y, gameId, rounds);
      return { x, y, hash, properties };
    }
  }

  throw new Error(
    `Could not find a valid spawn planet after ${maxAttempts} attempts`
  );
}

/**
 * Find a planet of a specific type and minimum size.
 * Uses SHA3-256 for property determination (matching MPC circuit).
 */
export function findPlanetOfType(
  gameId: bigint,
  thresholds: NoiseThresholds,
  bodyType: CelestialBodyType,
  minSize: number = 1,
  mapDiameter: number = 1000,
  maxAttempts: number = 100_000,
  startOffset: number = 0,
  rounds: number = 1
): ScannedCoordinate {
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

    const propHash = computePropertyHash(x, y, gameId, rounds);
    const properties = determineCelestialBody(propHash, thresholds);

    if (
      properties !== null &&
      properties.bodyType === bodyType &&
      properties.size >= minSize
    ) {
      const hash = computePlanetHash(x, y, gameId, rounds);
      return { x, y, hash, properties };
    }
  }

  throw new Error(
    `Could not find a ${CelestialBodyType[bodyType]} (min size ${minSize}) after ${maxAttempts} attempts`
  );
}
