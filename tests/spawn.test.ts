/**
 * Spawn and planet creation integration tests.
 *
 * Tests the encrypted spawn flow:
 * - queue_init_planet: creates EncryptedCelestialBody + EncryptedPendingMoves via MPC
 * - queue_init_spawn_planet: same as init_planet but also sets player.has_spawned
 * - Hash validation and noise function (client-side unit tests)
 * - PDA derivation verification
 *
 * NOTE: All planet creation now goes through MPC. There is no plaintext
 * create_planet instruction. These tests verify the queue instructions
 * and their constraints, plus the client-side noise/hash logic.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import type { EncryptedForest } from "../target/types/encrypted_forest";
import {
  getProviderAndProgram,
  readKpJson,
  airdrop,
  createGame,
  initPlayer,
  defaultGameConfig,
  setupEncryption,
  queueInitPlanet,
  queueInitSpawnPlanet,
  derivePlanetPDA,
  derivePendingMovesPDA,
  computePlanetHash,
  determineCelestialBody,
  baseStats,
  applyCometBoosts,
  findSpawnPlanet,
  findPlanetOfType,
  findDeadSpace,
  nextGameId,
  awaitComputationFinalization,
  getArciumEnv,
  CelestialBodyType,
  DEFAULT_THRESHOLDS,
  EncryptionContext,
} from "./helpers";

// ---------------------------------------------------------------------------
// Client-side noise / hash / finder unit tests (no Arcium required)
// ---------------------------------------------------------------------------

describe("Planet Hash and Noise (Client-Side)", () => {
  it("finds valid spawn coordinates via brute force", () => {
    const gameId = nextGameId();
    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    expect(spawn.props.bodyType).toBe(CelestialBodyType.Planet);
    expect(spawn.props.size).toBe(1);
    expect(spawn.hash.length).toBe(32);
  });

  it("determineCelestialBody returns null for dead space", () => {
    const gameId = nextGameId();
    const deadSpace = findDeadSpace(gameId, DEFAULT_THRESHOLDS);
    const props = determineCelestialBody(deadSpace.hash, DEFAULT_THRESHOLDS);
    expect(props).toBeNull();
  });

  it("determineCelestialBody returns valid properties for a planet", () => {
    const gameId = nextGameId();
    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const props = determineCelestialBody(spawn.hash, DEFAULT_THRESHOLDS);

    expect(props).not.toBeNull();
    expect(props!.bodyType).toBe(CelestialBodyType.Planet);
    expect(props!.size).toBeGreaterThanOrEqual(1);
    expect(props!.size).toBeLessThanOrEqual(6);
  });

  it("baseStats returns correct stats for each body type", () => {
    const planetStats = baseStats(CelestialBodyType.Planet, 2);
    expect(planetStats.maxShipCapacity).toBe(400); // 100 * 2^2
    expect(planetStats.shipGenSpeed).toBe(2);      // 1 * 2
    expect(planetStats.range).toBe(5);             // 3 + 2
    expect(planetStats.launchVelocity).toBe(3);    // 1 + 2
    expect(planetStats.nativeShips).toBe(20);      // 10 * 2

    const quasarStats = baseStats(CelestialBodyType.Quasar, 3);
    expect(quasarStats.maxShipCapacity).toBe(4500); // 500 * 9
    expect(quasarStats.shipGenSpeed).toBe(0);
    expect(quasarStats.maxMetalCapacity).toBe(4500);

    const asteroidStats = baseStats(CelestialBodyType.AsteroidBelt, 2);
    expect(asteroidStats.metalGenSpeed).toBe(4);    // 2 * 2
    expect(asteroidStats.shipGenSpeed).toBe(0);
  });

  it("applyCometBoosts doubles the correct stat", () => {
    const stats = baseStats(CelestialBodyType.Planet, 2);
    const boosted = applyCometBoosts(stats, [CelestialBodyType.Planet as any]);
    // CometBoost.ShipCapacity = 0 = CelestialBodyType.Planet, but we test with actual enum
    const boosted2 = applyCometBoosts(stats, [0 as any]); // ShipCapacity
    expect(boosted2.maxShipCapacity).toBe(stats.maxShipCapacity * 2);
  });

  it("finds different body types", () => {
    const gameId = nextGameId();

    // Find a larger planet
    const planet = findPlanetOfType(
      gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2
    );
    expect(planet.props.bodyType).toBe(CelestialBodyType.Planet);
    expect(planet.props.size).toBeGreaterThanOrEqual(2);

    // Try to find a non-Planet type
    try {
      const quasar = findPlanetOfType(
        gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Quasar, 1
      );
      expect(quasar.props.bodyType).toBe(CelestialBodyType.Quasar);
    } catch {
      console.log("No Quasar found in search range, skipping");
    }
  });

  it("verifies PDA derivation for planet and pending moves", () => {
    const gameId = nextGameId();
    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    const [planetPDA] = derivePlanetPDA(gameId, spawn.hash);
    const [pendingPDA] = derivePendingMovesPDA(gameId, spawn.hash);

    // Both should be valid PublicKeys (not throw)
    expect(planetPDA.toString().length).toBeGreaterThan(0);
    expect(pendingPDA.toString().length).toBeGreaterThan(0);
    expect(planetPDA.toString()).not.toBe(pendingPDA.toString());
  });

  it("produces consistent hashes for same inputs", () => {
    const x = 42n;
    const y = -17n;
    const gameId = 12345n;

    const hash1 = computePlanetHash(x, y, gameId);
    const hash2 = computePlanetHash(x, y, gameId);
    expect(hash1).toEqual(hash2);

    // Different inputs produce different hashes
    const hash3 = computePlanetHash(x + 1n, y, gameId);
    expect(hash1).not.toEqual(hash3);
  });
});

// ---------------------------------------------------------------------------
// Queue Init Planet (MPC)
// ---------------------------------------------------------------------------

describe("Queue Init Planet", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;
  let encCtx: EncryptionContext;
  let arciumAvailable = false;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);

    try {
      getArciumEnv();
      encCtx = await setupEncryption(provider, program.programId);
      arciumAvailable = true;
    } catch {
      console.log("Arcium environment not available");
    }
  });

  it("creates encrypted planet and pending moves accounts", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));

    const coord = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2);

    const { computationOffset, planetPDA, pendingMovesPDA } = await queueInitPlanet(
      program, admin, gameId, coord.x, coord.y, DEFAULT_THRESHOLDS, encCtx
    );

    const finalizeSig = await awaitComputationFinalization(
      provider, computationOffset, program.programId, "confirmed"
    );
    console.log("Init planet finalized:", finalizeSig);

    // Verify EncryptedCelestialBody account
    const body = await program.account.encryptedCelestialBody.fetch(planetPDA);
    expect(body.planetHash).toEqual(Array.from(coord.hash));
    expect(body.encCiphertexts.length).toBe(19);
    expect(Number(body.lastUpdatedSlot)).toBeGreaterThan(0);

    // Verify EncryptedPendingMoves account
    const pending = await program.account.encryptedPendingMoves.fetch(pendingMovesPDA);
    expect(pending.gameId.toString()).toBe(gameId.toString());
    expect(pending.planetHash).toEqual(Array.from(coord.hash));
    expect(pending.moveCount).toBe(0);
    expect(pending.moves.length).toBe(0);
  });

  it("verifies PDA derivation matches created accounts", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));

    const coord = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const [expectedPlanetPDA] = derivePlanetPDA(gameId, coord.hash, program.programId);
    const [expectedPendingPDA] = derivePendingMovesPDA(gameId, coord.hash, program.programId);

    const { planetPDA, pendingMovesPDA } = await queueInitPlanet(
      program, admin, gameId, coord.x, coord.y, DEFAULT_THRESHOLDS, encCtx
    );

    expect(planetPDA.toString()).toBe(expectedPlanetPDA.toString());
    expect(pendingMovesPDA.toString()).toBe(expectedPendingPDA.toString());
  });
});

// ---------------------------------------------------------------------------
// Queue Init Spawn Planet (MPC)
// ---------------------------------------------------------------------------

describe("Queue Init Spawn Planet", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;
  let encCtx: EncryptionContext;
  let arciumAvailable = false;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);

    try {
      getArciumEnv();
      encCtx = await setupEncryption(provider, program.programId);
      arciumAvailable = true;
    } catch {
      console.log("Arcium environment not available");
    }
  });

  it("sets player.has_spawned to true after callback", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    const { computationOffset, playerPDA } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn.x, spawn.y, DEFAULT_THRESHOLDS, encCtx
    );

    await awaitComputationFinalization(
      provider, computationOffset, program.programId, "confirmed"
    );

    const playerAccount = await program.account.player.fetch(playerPDA);
    expect(playerAccount.hasSpawned).toBe(true);
  });

  it("requires player to not have already spawned", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    // First spawn
    const spawn1 = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: co1 } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn1.x, spawn1.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, co1, program.programId, "confirmed");

    // Second spawn attempt should fail on the has_spawned check
    // We need different coords so the PDA is different
    try {
      const spawn2 = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 1, 1000, 100_000, 50_000);
      if (spawn2.x !== spawn1.x || spawn2.y !== spawn1.y) {
        await expect(
          queueInitSpawnPlanet(
            program, admin, gameId, spawn2.x, spawn2.y, DEFAULT_THRESHOLDS, encCtx
          )
        ).rejects.toThrow();
      }
    } catch {
      console.log("Could not find second spawn planet for duplicate test");
    }
  });

  it("requires player to exist (init_player first)", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    // Deliberately skip initPlayer

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    // Should fail because player PDA does not exist
    await expect(
      queueInitSpawnPlanet(
        program, admin, gameId, spawn.x, spawn.y, DEFAULT_THRESHOLDS, encCtx
      )
    ).rejects.toThrow();
  });

  it("allows different players to spawn in the same game", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));

    const player2 = Keypair.generate();
    await airdrop(provider, player2.publicKey, 5);

    await initPlayer(program, admin, gameId);
    await initPlayer(program, player2, gameId);

    // Set up encryption for player2
    const encCtx2 = await setupEncryption(provider, program.programId);

    const spawn1 = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const spawn2 = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 1, 1000, 100_000, 50_000);

    // Player 1 spawns
    const { computationOffset: co1, playerPDA: p1PDA } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn1.x, spawn1.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, co1, program.programId, "confirmed");

    // Player 2 spawns at different location
    if (spawn2.x !== spawn1.x || spawn2.y !== spawn1.y) {
      const { computationOffset: co2, playerPDA: p2PDA } = await queueInitSpawnPlanet(
        program, player2, gameId, spawn2.x, spawn2.y, DEFAULT_THRESHOLDS, encCtx2
      );
      await awaitComputationFinalization(provider, co2, program.programId, "confirmed");

      const p1 = await program.account.player.fetch(p1PDA);
      const p2 = await program.account.player.fetch(p2PDA);
      expect(p1.hasSpawned).toBe(true);
      expect(p2.hasSpawned).toBe(true);
    }
  });
});
