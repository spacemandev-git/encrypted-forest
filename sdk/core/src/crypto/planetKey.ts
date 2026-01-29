/**
 * Planet key derivation for fog-of-war encryption.
 *
 * The planet hash (blake3 of x, y, gameId) serves as both:
 * 1. The PDA seed for the celestial body account
 * 2. The seed for deriving the planet's encryption key
 *
 * Only players who know (x, y) can compute the hash and thus
 * derive the decryption key for that planet's encrypted events.
 */

import { computePlanetHash } from "../noise/index.js";

/**
 * Derive the planet encryption key seed from coordinates.
 * This is the core fog-of-war secret: knowing (x, y, gameId)
 * gives you the ability to decrypt events for that planet.
 *
 * Returns the 32-byte blake3 hash which can be used as key material.
 */
export function derivePlanetKeySeed(
  x: bigint,
  y: bigint,
  gameId: bigint
): Uint8Array {
  return computePlanetHash(x, y, gameId);
}

/**
 * Check if a given hash matches the expected planet hash for coordinates.
 * Used to verify claimed planet locations.
 */
export function verifyPlanetHash(
  x: bigint,
  y: bigint,
  gameId: bigint,
  expectedHash: Uint8Array
): boolean {
  const computed = computePlanetHash(x, y, gameId);
  if (computed.length !== expectedHash.length) return false;
  for (let i = 0; i < computed.length; i++) {
    if (computed[i] !== expectedHash[i]) return false;
  }
  return true;
}
