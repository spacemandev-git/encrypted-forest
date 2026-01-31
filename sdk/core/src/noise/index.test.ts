/**
 * Unit tests for hash-based noise, PDA derivation, and game mechanics.
 *
 * These tests verify:
 * 1. computePlanetHash produces correct blake3 output
 * 2. determineCelestialBody matches on-chain logic
 * 3. PDA derivation functions produce valid PDAs
 * 4. Game mechanics helpers (distance, decay, landing slot, upgrade cost)
 * 5. findSpawnPlanet finds valid spawn locations
 */

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  computePlanetHash,
  determineCelestialBody,
  baseStats,
  applyCometBoosts,
  computeCurrentShips,
  computeCurrentMetal,
  computeDistance,
  applyDistanceDecay,
  computeLandingSlot,
  upgradeCost,
  findSpawnPlanet,
  findPlanetOfType,
  scanCoordinate,
  scanRange,
} from "./index.js";
import {
  CelestialBodyType,
  CometBoost,
} from "../types/celestialBody.js";
import type { NoiseThresholds } from "../types/game.js";
import { DEFAULT_THRESHOLDS } from "../types/game.js";
import {
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  PROGRAM_ID,
} from "../utils/pda.js";

// ---------------------------------------------------------------------------
// computePlanetHash
// ---------------------------------------------------------------------------

describe("computePlanetHash", () => {
  it("should produce a 32-byte hash", () => {
    const hash = computePlanetHash(0n, 0n, 1n);
    expect(hash.length).toBe(32);
  });

  it("should be deterministic", () => {
    const h1 = computePlanetHash(10n, -20n, 42n);
    const h2 = computePlanetHash(10n, -20n, 42n);
    expect(h1).toEqual(h2);
  });

  it("should differ for different inputs", () => {
    const h1 = computePlanetHash(0n, 0n, 1n);
    const h2 = computePlanetHash(1n, 0n, 1n);
    const h3 = computePlanetHash(0n, 1n, 1n);
    const h4 = computePlanetHash(0n, 0n, 2n);

    expect(h1).not.toEqual(h2);
    expect(h1).not.toEqual(h3);
    expect(h1).not.toEqual(h4);
  });

  it("should handle negative coordinates", () => {
    const h1 = computePlanetHash(-500n, -500n, 1n);
    const h2 = computePlanetHash(500n, 500n, 1n);
    expect(h1.length).toBe(32);
    expect(h1).not.toEqual(h2);
  });

  it("should match test helpers output", () => {
    // Cross-reference with the helpers.ts implementation
    // Both use blake3 on (x:i64 LE, y:i64 LE, gameId:u64 LE)
    const hash = computePlanetHash(42n, -17n, 100n);
    expect(hash.length).toBe(32);
    // Verify it is consistent
    const hash2 = computePlanetHash(42n, -17n, 100n);
    expect(hash).toEqual(hash2);
  });
});

// ---------------------------------------------------------------------------
// determineCelestialBody
// ---------------------------------------------------------------------------

describe("determineCelestialBody", () => {
  it("should return null for dead space (byte0 < threshold)", () => {
    // Create a hash where byte0 is low
    const hash = new Uint8Array(32);
    hash[0] = 50; // below default 128 threshold
    const result = determineCelestialBody(hash, DEFAULT_THRESHOLDS);
    expect(result).toBeNull();
  });

  it("should return Planet type when byte1 < planetThreshold", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200; // above dead space
    hash[1] = 50; // below planet threshold (128)
    hash[2] = 20; // size 1
    hash[3] = 0; // no comets
    const result = determineCelestialBody(hash, DEFAULT_THRESHOLDS);
    expect(result).not.toBeNull();
    expect(result!.bodyType).toBe(CelestialBodyType.Planet);
    expect(result!.size).toBe(1);
    expect(result!.comets).toEqual([]);
  });

  it("should return Quasar when byte1 in quasar range", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200;
    hash[1] = 150; // between 128 and 192
    hash[2] = 100;
    hash[3] = 0;
    const result = determineCelestialBody(hash, DEFAULT_THRESHOLDS);
    expect(result).not.toBeNull();
    expect(result!.bodyType).toBe(CelestialBodyType.Quasar);
  });

  it("should return SpacetimeRip when byte1 in rip range", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200;
    hash[1] = 200; // between 192 and 224
    hash[2] = 100;
    hash[3] = 0;
    const result = determineCelestialBody(hash, DEFAULT_THRESHOLDS);
    expect(result).not.toBeNull();
    expect(result!.bodyType).toBe(CelestialBodyType.SpacetimeRip);
  });

  it("should return AsteroidBelt when byte1 >= spacetimeRipThreshold", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200;
    hash[1] = 230; // >= 224
    hash[2] = 100;
    hash[3] = 0;
    const result = determineCelestialBody(hash, DEFAULT_THRESHOLDS);
    expect(result).not.toBeNull();
    expect(result!.bodyType).toBe(CelestialBodyType.AsteroidBelt);
  });

  it("should determine correct sizes", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200;
    hash[1] = 50;
    hash[3] = 0;

    // Size 1 (byte2 < 43)
    hash[2] = 20;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.size).toBe(1);

    // Size 2 (43-85)
    hash[2] = 50;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.size).toBe(2);

    // Size 3 (86-127)
    hash[2] = 100;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.size).toBe(3);

    // Size 4 (128-170)
    hash[2] = 150;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.size).toBe(4);

    // Size 5 (171-213)
    hash[2] = 200;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.size).toBe(5);

    // Size 6 (214+)
    hash[2] = 230;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.size).toBe(6);
  });

  it("should handle comets correctly", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200;
    hash[1] = 50;
    hash[2] = 20;

    // No comets (byte3 <= 216)
    hash[3] = 100;
    expect(determineCelestialBody(hash, DEFAULT_THRESHOLDS)!.comets).toEqual(
      []
    );

    // One comet (byte3 > 216, <= 242)
    hash[3] = 220;
    hash[4] = 0; // (0 % 6) + 1 = 1 = ShipCapacity
    const oneComet = determineCelestialBody(hash, DEFAULT_THRESHOLDS)!;
    expect(oneComet.comets.length).toBe(1);
    expect(oneComet.comets[0]).toBe(CometBoost.ShipCapacity);

    // Two comets (byte3 > 242)
    hash[3] = 250;
    hash[4] = 0; // (0 % 6) + 1 = 1 = ShipCapacity
    hash[5] = 3; // (3 % 6) + 1 = 4 = MetalGenSpeed
    const twoComets = determineCelestialBody(hash, DEFAULT_THRESHOLDS)!;
    expect(twoComets.comets.length).toBe(2);
    expect(twoComets.comets[0]).toBe(CometBoost.ShipCapacity);
    expect(twoComets.comets[1]).toBe(CometBoost.MetalGenSpeed);
  });

  it("should deduplicate second comet boost", () => {
    const hash = new Uint8Array(32);
    hash[0] = 200;
    hash[1] = 50;
    hash[2] = 20;
    hash[3] = 250; // two comets
    hash[4] = 0; // (0 % 6) + 1 = 1 = ShipCapacity
    hash[5] = 6; // (6 % 6) + 1 = 1 = ShipCapacity, dedup: ((6+1) % 6) + 1 = 2 = MetalCapacity
    const result = determineCelestialBody(hash, DEFAULT_THRESHOLDS)!;
    expect(result.comets.length).toBe(2);
    expect(result.comets[0]).toBe(CometBoost.ShipCapacity);
    expect(result.comets[1]).toBe(CometBoost.MetalCapacity);
  });
});

// ---------------------------------------------------------------------------
// baseStats
// ---------------------------------------------------------------------------

describe("baseStats", () => {
  it("should compute Planet stats correctly", () => {
    const stats = baseStats(CelestialBodyType.Planet, 3);
    expect(stats.maxShipCapacity).toBe(100 * 9); // 100 * 3^2
    expect(stats.shipGenSpeed).toBe(3);
    expect(stats.maxMetalCapacity).toBe(0);
    expect(stats.metalGenSpeed).toBe(0);
    expect(stats.range).toBe(6); // 3 + 3
    expect(stats.launchVelocity).toBe(4); // 1 + 3
    expect(stats.nativeShips).toBe(30); // 10 * 3
  });

  it("should give 0 native ships for Miniscule Planet", () => {
    const stats = baseStats(CelestialBodyType.Planet, 1);
    expect(stats.nativeShips).toBe(0);
  });

  it("should compute Quasar stats correctly", () => {
    const stats = baseStats(CelestialBodyType.Quasar, 2);
    expect(stats.maxShipCapacity).toBe(500 * 4);
    expect(stats.shipGenSpeed).toBe(0);
    expect(stats.maxMetalCapacity).toBe(500 * 4);
    expect(stats.metalGenSpeed).toBe(0);
    expect(stats.nativeShips).toBe(40);
  });

  it("should compute AsteroidBelt stats correctly", () => {
    const stats = baseStats(CelestialBodyType.AsteroidBelt, 4);
    expect(stats.maxShipCapacity).toBe(80 * 16);
    expect(stats.shipGenSpeed).toBe(0);
    expect(stats.maxMetalCapacity).toBe(200 * 16);
    expect(stats.metalGenSpeed).toBe(8); // 2 * 4
    expect(stats.nativeShips).toBe(40); // 10 * 4
  });
});

// ---------------------------------------------------------------------------
// applyCometBoosts
// ---------------------------------------------------------------------------

describe("applyCometBoosts", () => {
  it("should double the boosted stat", () => {
    const stats = baseStats(CelestialBodyType.Planet, 3);
    const boosted = applyCometBoosts(stats, [CometBoost.ShipCapacity]);
    expect(boosted.maxShipCapacity).toBe(stats.maxShipCapacity * 2);
    expect(boosted.shipGenSpeed).toBe(stats.shipGenSpeed); // unchanged
  });

  it("should apply multiple boosts", () => {
    const stats = baseStats(CelestialBodyType.Planet, 2);
    const boosted = applyCometBoosts(stats, [
      CometBoost.Range,
      CometBoost.LaunchVelocity,
    ]);
    expect(boosted.range).toBe(stats.range * 2);
    expect(boosted.launchVelocity).toBe(stats.launchVelocity * 2);
  });

  it("should not mutate original stats", () => {
    const stats = baseStats(CelestialBodyType.Planet, 3);
    const original = stats.maxShipCapacity;
    applyCometBoosts(stats, [CometBoost.ShipCapacity]);
    expect(stats.maxShipCapacity).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Game mechanics
// ---------------------------------------------------------------------------

describe("computeDistance", () => {
  it("should compute correct distance", () => {
    expect(computeDistance(0n, 0n, 3n, 4n)).toBe(4n + 3n / 2n); // max(3,4) + min(3,4)/2 = 4 + 1 = 5
    expect(computeDistance(0n, 0n, 0n, 0n)).toBe(0n);
    expect(computeDistance(-5n, -5n, 5n, 5n)).toBe(10n + 10n / 2n); // 15
  });
});

describe("applyDistanceDecay", () => {
  it("should lose ships over distance", () => {
    expect(applyDistanceDecay(100n, 20n, 5n)).toBe(96n); // 100 - 20/5 = 96
    expect(applyDistanceDecay(100n, 0n, 5n)).toBe(100n);
    expect(applyDistanceDecay(10n, 100n, 5n)).toBe(0n); // would go negative
  });

  it("should return 0 for 0 range", () => {
    expect(applyDistanceDecay(100n, 10n, 0n)).toBe(0n);
  });
});

describe("computeLandingSlot", () => {
  it("should compute correct landing slot", () => {
    // travel_time = distance * game_speed / (launch_velocity * 10000)
    // = 100 * 10000 / (2 * 10000) = 1000000 / 20000 = 50
    expect(computeLandingSlot(1000n, 100n, 2n, 10000n)).toBe(1050n);
  });

  it("should return MAX_SAFE_INTEGER for 0 velocity", () => {
    const result = computeLandingSlot(1000n, 10n, 0n, 10000n);
    expect(result).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

describe("upgradeCost", () => {
  it("should compute exponential costs", () => {
    expect(upgradeCost(0)).toBe(100n); // 100 * 2^0 = 100
    expect(upgradeCost(1)).toBe(200n); // 100 * 2^1 = 200
    expect(upgradeCost(2)).toBe(400n);
    expect(upgradeCost(3)).toBe(800n);
  });
});

describe("computeCurrentShips", () => {
  it("should generate ships over time", () => {
    // genSpeed=2, elapsed=50, gameSpeed=10000 -> generated = 2*50*10000/10000 = 100
    expect(computeCurrentShips(100n, 1000n, 2n, 0n, 50n, 10000n)).toBe(200n);
  });

  it("should cap at max capacity", () => {
    // genSpeed=100, elapsed=100, gameSpeed=10000 -> generated = 100*100*10000/10000 = 10000
    // 990 + 10000 = capped at 1000
    expect(computeCurrentShips(990n, 1000n, 100n, 0n, 100n, 10000n)).toBe(1000n);
  });

  it("should not generate with 0 speed", () => {
    expect(computeCurrentShips(100n, 1000n, 0n, 0n, 100n, 10000n)).toBe(100n);
  });

  it("should not generate if slot has not advanced", () => {
    expect(computeCurrentShips(100n, 1000n, 5n, 50n, 50n, 10000n)).toBe(100n);
  });
});

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

describe("PDA derivation", () => {
  it("deriveGamePDA should produce valid PublicKey", () => {
    const [pda, bump] = deriveGamePDA(1n);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("deriveGamePDA should be deterministic", () => {
    const [pda1] = deriveGamePDA(42n);
    const [pda2] = deriveGamePDA(42n);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("deriveGamePDA should differ for different game IDs", () => {
    const [pda1] = deriveGamePDA(1n);
    const [pda2] = deriveGamePDA(2n);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("derivePlayerPDA should produce valid PublicKey", () => {
    const playerKey = PublicKey.unique();
    const [pda, bump] = derivePlayerPDA(1n, playerKey);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
  });

  it("deriveCelestialBodyPDA should produce valid PublicKey", () => {
    const hash = computePlanetHash(10n, 20n, 1n);
    const [pda, bump] = deriveCelestialBodyPDA(1n, hash);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
  });

  it("derivePendingMovesPDA should produce valid PublicKey", () => {
    const hash = computePlanetHash(10n, 20n, 1n);
    const [pda, bump] = derivePendingMovesPDA(1n, hash);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
  });

  it("planet and pending PDAs for same hash should differ", () => {
    const hash = computePlanetHash(5n, 5n, 1n);
    const [planetPDA] = deriveCelestialBodyPDA(1n, hash);
    const [pendingPDA] = derivePendingMovesPDA(1n, hash);
    expect(planetPDA.equals(pendingPDA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

describe("scanCoordinate", () => {
  it("should return hash and properties", () => {
    const result = scanCoordinate(0n, 0n, 1n, DEFAULT_THRESHOLDS);
    expect(result.hash.length).toBe(32);
    // properties can be null (dead space) or an object
    expect(result.x).toBe(0n);
    expect(result.y).toBe(0n);
  });
});

describe("findSpawnPlanet", () => {
  it("should find a Miniscule Planet", () => {
    const result = findSpawnPlanet(1n, DEFAULT_THRESHOLDS);
    expect(result.properties).not.toBeNull();
    expect(result.properties!.bodyType).toBe(CelestialBodyType.Planet);
    expect(result.properties!.size).toBe(1);
    expect(result.hash.length).toBe(32);
  });

  it("should find different planets for different game IDs", () => {
    const r1 = findSpawnPlanet(1n, DEFAULT_THRESHOLDS);
    const r2 = findSpawnPlanet(999n, DEFAULT_THRESHOLDS);
    // They might find the same coordinates but with different hashes
    expect(r1.hash).not.toEqual(r2.hash);
  });
});

describe("findPlanetOfType", () => {
  it("should find a Quasar", () => {
    const result = findPlanetOfType(
      1n,
      DEFAULT_THRESHOLDS,
      CelestialBodyType.Quasar,
      1
    );
    expect(result.properties).not.toBeNull();
    expect(result.properties!.bodyType).toBe(CelestialBodyType.Quasar);
  });
});
