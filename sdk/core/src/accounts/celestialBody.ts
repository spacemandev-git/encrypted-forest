/**
 * CelestialBody account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  CelestialBodyType,
  CometBoost,
  type CelestialBody,
} from "../types/celestialBody.js";
import { deriveCelestialBodyPDA } from "../utils/pda.js";

/**
 * Convert Anchor enum to SDK enum for CelestialBodyType.
 */
function convertBodyType(raw: any): CelestialBodyType {
  if (raw.planet !== undefined) return CelestialBodyType.Planet;
  if (raw.quasar !== undefined) return CelestialBodyType.Quasar;
  if (raw.spacetimeRip !== undefined) return CelestialBodyType.SpacetimeRip;
  if (raw.asteroidBelt !== undefined) return CelestialBodyType.AsteroidBelt;
  throw new Error(`Unknown celestial body type: ${JSON.stringify(raw)}`);
}

/**
 * Convert Anchor enum to SDK enum for CometBoost.
 */
function convertCometBoost(raw: any): CometBoost {
  if (raw.shipCapacity !== undefined) return CometBoost.ShipCapacity;
  if (raw.metalCapacity !== undefined) return CometBoost.MetalCapacity;
  if (raw.shipGenSpeed !== undefined) return CometBoost.ShipGenSpeed;
  if (raw.metalGenSpeed !== undefined) return CometBoost.MetalGenSpeed;
  if (raw.range !== undefined) return CometBoost.Range;
  if (raw.launchVelocity !== undefined) return CometBoost.LaunchVelocity;
  throw new Error(`Unknown comet boost: ${JSON.stringify(raw)}`);
}

/**
 * Convert Anchor's deserialized CelestialBody account to our SDK type.
 */
function convertCelestialBody(raw: any): CelestialBody {
  return {
    bodyType: convertBodyType(raw.bodyType),
    size: raw.size,
    owner: raw.owner ?? null,
    shipCount: BigInt(raw.shipCount.toString()),
    maxShipCapacity: BigInt(raw.maxShipCapacity.toString()),
    shipGenSpeed: BigInt(raw.shipGenSpeed.toString()),
    metalCount: BigInt(raw.metalCount.toString()),
    maxMetalCapacity: BigInt(raw.maxMetalCapacity.toString()),
    metalGenSpeed: BigInt(raw.metalGenSpeed.toString()),
    range: BigInt(raw.range.toString()),
    launchVelocity: BigInt(raw.launchVelocity.toString()),
    level: raw.level,
    comets: (raw.comets as any[]).map(convertCometBoost),
    lastUpdatedSlot: BigInt(raw.lastUpdatedSlot.toString()),
    planetHash: new Uint8Array(raw.planetHash),
  };
}

/**
 * Fetch and deserialize a CelestialBody account by PDA.
 */
export async function fetchCelestialBody(
  program: Program,
  gameId: bigint,
  planetHash: Uint8Array,
  programId?: PublicKey
): Promise<CelestialBody> {
  const [pda] = deriveCelestialBodyPDA(
    gameId,
    planetHash,
    programId ?? program.programId
  );
  const raw = await (program.account as any).celestialBody.fetch(pda);
  return convertCelestialBody(raw);
}

/**
 * Fetch a CelestialBody account by a known address.
 */
export async function fetchCelestialBodyByAddress(
  program: Program,
  address: PublicKey
): Promise<CelestialBody> {
  const raw = await (program.account as any).celestialBody.fetch(address);
  return convertCelestialBody(raw);
}
