/**
 * Fog of war helpers.
 *
 * Combines hash-based noise scanning with planet key derivation
 * to provide a unified API for exploring the game map.
 */

import type { NoiseThresholds } from "../types/game.js";
import type { CelestialBodyProperties } from "../types/celestialBody.js";
import {
  computePlanetHash,
  computePropertyHash,
  determineCelestialBody,
  scanCoordinate,
  scanRange,
  findSpawnPlanet,
  findPlanetOfType,
  type ScannedCoordinate,
} from "../noise/index.js";
import { derivePlanetKeySeed, verifyPlanetHash } from "./planetKey.js";
import { CelestialBodyType } from "../types/celestialBody.js";

/**
 * A discovered planet with its coordinates, hash, properties, and key seed.
 */
export interface DiscoveredPlanet {
  x: bigint;
  y: bigint;
  hash: Uint8Array;
  keySeed: Uint8Array;
  properties: CelestialBodyProperties;
}

/**
 * Scan a coordinate and if it contains a celestial body, return full discovery info.
 */
export function discoverCoordinate(
  x: bigint,
  y: bigint,
  gameId: bigint,
  thresholds: NoiseThresholds
): DiscoveredPlanet | null {
  const scanned = scanCoordinate(x, y, gameId, thresholds);
  if (scanned.properties === null) {
    return null;
  }
  return {
    x,
    y,
    hash: scanned.hash,
    keySeed: derivePlanetKeySeed(x, y, gameId),
    properties: scanned.properties,
  };
}

/**
 * Scan a rectangular area and return all discovered planets.
 */
export function discoverRange(
  startX: bigint,
  startY: bigint,
  endX: bigint,
  endY: bigint,
  gameId: bigint,
  thresholds: NoiseThresholds
): DiscoveredPlanet[] {
  const scanned = scanRange(startX, startY, endX, endY, gameId, thresholds);
  return scanned
    .filter((s) => s.properties !== null)
    .map((s) => ({
      x: s.x,
      y: s.y,
      hash: s.hash,
      keySeed: derivePlanetKeySeed(s.x, s.y, gameId),
      properties: s.properties!,
    }));
}

/**
 * Reveal a planet given its coordinates -- verify the hash and return discovery info.
 * Useful when receiving a broadcast event with (x, y, gameId).
 */
export function revealPlanet(
  x: bigint,
  y: bigint,
  gameId: bigint,
  thresholds: NoiseThresholds,
  expectedHash?: Uint8Array,
  rounds: number = 1
): DiscoveredPlanet | null {
  const hash = computePlanetHash(x, y, gameId, rounds);

  // If an expected hash is provided, verify it matches
  if (expectedHash && !verifyPlanetHash(x, y, gameId, expectedHash, rounds)) {
    return null;
  }

  const propHash = computePropertyHash(x, y, gameId, rounds);
  const properties = determineCelestialBody(propHash, thresholds);
  if (properties === null) {
    return null;
  }

  return {
    x,
    y,
    hash,
    keySeed: derivePlanetKeySeed(x, y, gameId, rounds),
    properties,
  };
}

// Re-export scan helpers for convenience
export {
  scanCoordinate,
  scanRange,
  findSpawnPlanet,
  findPlanetOfType,
  computePlanetHash,
  computePropertyHash,
  determineCelestialBody,
  derivePlanetKeySeed,
  verifyPlanetHash,
};
export type { ScannedCoordinate };
