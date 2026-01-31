/**
 * Hash mining Web Worker.
 *
 * Receives chunks of coordinates to hash, runs blake3-based fog-of-war
 * computation, and posts back results (discovered planets).
 *
 * Inlines minimal hashing logic to avoid import issues in workers.
 * Must match sdk/core/src/noise/index.ts exactly.
 */

import { blake3 } from "@noble/hashes/blake3.js";

// ---------------------------------------------------------------------------
// Inline hashing logic (must match core SDK)
// ---------------------------------------------------------------------------

function computePlanetHash(x: bigint, y: bigint, gameId: bigint, rounds: number = 1): Uint8Array {
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true);
  view.setBigInt64(8, y, true);
  view.setBigUint64(16, gameId, true);
  let hash = blake3(new Uint8Array(buf));
  for (let r = 1; r < rounds; r++) {
    hash = blake3(hash);
  }
  return hash;
}

interface NoiseThresholds {
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

interface CelestialBodyProperties {
  bodyType: number;
  size: number;
  comets: number[];
}

function cometFromByte(b: number): number {
  return (b % 6) + 1;
}

function determineCelestialBody(
  hash: Uint8Array,
  t: NoiseThresholds
): CelestialBodyProperties | null {
  const byte0 = hash[0];
  const byte1 = hash[1];
  const byte2 = hash[2];
  const byte3 = hash[3];
  const byte4 = hash[4];
  const byte5 = hash[5];

  if (byte0 < t.deadSpaceThreshold) return null;

  // Body type (threshold-based)
  let bodyType: number;
  if (byte1 < t.planetThreshold) {
    bodyType = 0; // Planet
  } else if (byte1 < t.quasarThreshold) {
    bodyType = 1; // Quasar
  } else if (byte1 < t.spacetimeRipThreshold) {
    bodyType = 2; // SpacetimeRip
  } else {
    bodyType = 3; // AsteroidBelt
  }

  // Size (threshold-based)
  let size: number;
  if (byte2 < t.sizeThreshold1) {
    size = 1;
  } else if (byte2 < t.sizeThreshold2) {
    size = 2;
  } else if (byte2 < t.sizeThreshold3) {
    size = 3;
  } else if (byte2 < t.sizeThreshold4) {
    size = 4;
  } else if (byte2 < t.sizeThreshold5) {
    size = 5;
  } else {
    size = 6;
  }

  // Comets: byte3 thresholds, values 1-6 (0 = no comet)
  const comet0Raw = cometFromByte(byte4);
  let comet1Raw = cometFromByte(byte5);
  if (comet1Raw === comet0Raw) {
    comet1Raw = cometFromByte((byte5 + 1) & 0xff);
  }

  const comet0 = byte3 > 216 ? comet0Raw : 0;
  const comet1 = byte3 > 242 ? comet1Raw : 0;

  const comets: number[] = [];
  if (comet0 !== 0) comets.push(comet0);
  if (comet1 !== 0) comets.push(comet1);

  return { bodyType, size, comets };
}

// ---------------------------------------------------------------------------
// Worker message types
// ---------------------------------------------------------------------------

export interface MineRequest {
  type: "mine";
  coords: [number, number][];
  gameId: string; // bigint as string
  thresholds: NoiseThresholds;
  hashRounds: number;
}

export interface MineResult {
  type: "result";
  hashed: number;
  discovered: Array<{
    x: string;
    y: string;
    hash: number[];
    bodyType: number;
    size: number;
    comets: number[];
  }>;
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<MineRequest>) => {
  if (e.data.type !== "mine") return;

  const { coords, gameId, thresholds, hashRounds } = e.data;
  const gid = BigInt(gameId);
  const discovered: MineResult["discovered"] = [];

  for (const [x, y] of coords) {
    const bx = BigInt(x);
    const by = BigInt(y);
    const hash = computePlanetHash(bx, by, gid, hashRounds);
    const props = determineCelestialBody(hash, thresholds);
    if (props) {
      discovered.push({
        x: x.toString(),
        y: y.toString(),
        hash: Array.from(hash),
        bodyType: props.bodyType,
        size: props.size,
        comets: props.comets,
      });
    }
  }

  const result: MineResult = {
    type: "result",
    hashed: coords.length,
    discovered,
  };

  self.postMessage(result);
};
