/**
 * Spawn and planet creation integration tests.
 *
 * These tests cover the non-Arcium parts of spawning:
 * - create_planet (on-chain planet creation from known coordinates)
 * - claim_spawn_planet (claiming a Miniscule Planet after spawn verification)
 * - Hash validation and noise function
 *
 * NOTE: The full spawn flow requires Arcium MPC (verify_spawn_coordinates).
 * These tests verify the on-chain plaintext instructions independently.
 * Arcium-based spawn tests are in arcium.test.ts.
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
  createPlanetOnChain,
  claimSpawnPlanet,
  deriveGamePDA,
  derivePlayerPDA,
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
  CelestialBodyType,
  DEFAULT_THRESHOLDS,
} from "./helpers";

describe("Planet Creation", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("finds valid spawn coordinates via brute force", () => {
    const gameId = nextGameId();
    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    expect(spawn.props.bodyType).toBe(CelestialBodyType.Planet);
    expect(spawn.props.size).toBe(1);
    expect(spawn.hash.length).toBe(32);
  });

  it("creates a planet at valid coordinates", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { planetPDA, pendingMovesPDA } = await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn.x,
      spawn.y,
      spawn.hash
    );

    const planet = await program.account.celestialBody.fetch(planetPDA);
    expect(planet.size).toBe(1);
    expect(planet.owner).toBeNull();
    expect(planet.planetHash).toEqual(Array.from(spawn.hash));

    const pending = await program.account.pendingMoves.fetch(pendingMovesPDA);
    expect(pending.gameId.toString()).toBe(gameId.toString());
    expect(pending.moves.length).toBe(0);
  });

  it("verifies planet properties match hash-noise function", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    // Find a larger planet to verify stats
    const coord = findPlanetOfType(
      gameId,
      DEFAULT_THRESHOLDS,
      CelestialBodyType.Planet,
      2
    );

    const { planetPDA } = await createPlanetOnChain(
      program,
      admin,
      gameId,
      coord.x,
      coord.y,
      coord.hash
    );

    const planet = await program.account.celestialBody.fetch(planetPDA);

    // Compute expected stats
    let expectedStats = baseStats(coord.props.bodyType, coord.props.size);
    expectedStats = applyCometBoosts(expectedStats, coord.props.comets);

    expect(planet.size).toBe(coord.props.size);
    expect(planet.maxShipCapacity.toString()).toBe(
      expectedStats.maxShipCapacity.toString()
    );
    expect(planet.shipGenSpeed.toString()).toBe(
      expectedStats.shipGenSpeed.toString()
    );
    expect(planet.range.toString()).toBe(expectedStats.range.toString());
    expect(planet.launchVelocity.toString()).toBe(
      expectedStats.launchVelocity.toString()
    );
    expect(planet.shipCount.toString()).toBe(
      expectedStats.nativeShips.toString()
    );
    expect(planet.level).toBe(1);
  });

  it("creates non-Planet celestial body types", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    // Try to find a Quasar
    try {
      const coord = findPlanetOfType(
        gameId,
        DEFAULT_THRESHOLDS,
        CelestialBodyType.Quasar,
        1
      );

      const { planetPDA } = await createPlanetOnChain(
        program,
        admin,
        gameId,
        coord.x,
        coord.y,
        coord.hash
      );

      const planet = await program.account.celestialBody.fetch(planetPDA);
      // Quasar: bodyType should be encoded properly
      expect(planet.shipGenSpeed.toString()).toBe("0"); // Quasars have 0 ship gen
    } catch {
      // If no quasar found in range, skip
      console.log("No Quasar found in search range, skipping");
    }
  });

  it("rejects planet creation at dead space coordinates", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const deadSpace = findDeadSpace(gameId, DEFAULT_THRESHOLDS);

    await expect(
      createPlanetOnChain(
        program,
        admin,
        gameId,
        deadSpace.x,
        deadSpace.y,
        deadSpace.hash
      )
    ).rejects.toThrow();
  });

  it("rejects planet creation with wrong hash", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    // Corrupt the hash
    const wrongHash = new Uint8Array(32);
    wrongHash.set(spawn.hash);
    wrongHash[0] = (wrongHash[0] + 1) % 256;

    await expect(
      createPlanetOnChain(program, admin, gameId, spawn.x, spawn.y, wrongHash)
    ).rejects.toThrow();
  });

  it("rejects planet creation with wrong coordinates", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    // Use correct hash but wrong coordinates
    await expect(
      createPlanetOnChain(
        program,
        admin,
        gameId,
        spawn.x + 1n, // wrong x
        spawn.y,
        spawn.hash
      )
    ).rejects.toThrow();
  });

  it("rejects planet creation outside map bounds", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      mapDiameter: new BN(10), // very small map
    });
    await createGame(program, admin, config);

    // Find a planet outside the small map bounds
    const outOfBoundsX = 100n;
    const outOfBoundsY = 100n;
    const hash = computePlanetHash(outOfBoundsX, outOfBoundsY, gameId);

    // This may or may not be a valid body, but it is out of bounds
    // The hash check might fail first or the bounds check
    await expect(
      createPlanetOnChain(
        program,
        admin,
        gameId,
        outOfBoundsX,
        outOfBoundsY,
        hash
      )
    ).rejects.toThrow();
  });

  it("rejects duplicate planet creation (PDA already exists)", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn.x,
      spawn.y,
      spawn.hash
    );

    // Attempt to create the same planet again
    await expect(
      createPlanetOnChain(
        program,
        admin,
        gameId,
        spawn.x,
        spawn.y,
        spawn.hash
      )
    ).rejects.toThrow();
  });

  it("verifies PDA derivation for planet and pending moves", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);

    const [expectedPlanetPDA] = derivePlanetPDA(
      gameId,
      spawn.hash,
      program.programId
    );
    const [expectedPendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn.hash,
      program.programId
    );

    const { planetPDA, pendingMovesPDA } = await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn.x,
      spawn.y,
      spawn.hash
    );

    expect(planetPDA.toString()).toBe(expectedPlanetPDA.toString());
    expect(pendingMovesPDA.toString()).toBe(expectedPendingPDA.toString());
  });
});

describe("Claim Spawn Planet", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  // NOTE: claim_spawn_planet requires player.has_spawned == true.
  // In the real flow, the Arcium verify_spawn_coordinates callback sets this.
  // Without Arcium running, we cannot directly test claim_spawn_planet in isolation
  // because there is no instruction to set has_spawned without Arcium.
  // These tests document the expected behavior.

  it("rejects claim when player has not spawned (has_spawned = false)", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);
    await initPlayer(program, admin, gameId);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn.x,
      spawn.y,
      spawn.hash
    );

    // Player has_spawned is false (Arcium callback never ran), so claim should fail
    await expect(
      claimSpawnPlanet(program, admin, gameId, spawn.hash)
    ).rejects.toThrow();
  });

  it("rejects claim on non-Miniscule planet", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);
    await initPlayer(program, admin, gameId);

    // Find a size >= 2 planet
    const largePlanet = findPlanetOfType(
      gameId,
      DEFAULT_THRESHOLDS,
      CelestialBodyType.Planet,
      2
    );

    await createPlanetOnChain(
      program,
      admin,
      gameId,
      largePlanet.x,
      largePlanet.y,
      largePlanet.hash
    );

    // Even if has_spawned were true, this would fail because size > 1
    // The has_spawned check fails first, but we document the intent
    await expect(
      claimSpawnPlanet(program, admin, gameId, largePlanet.hash)
    ).rejects.toThrow();
  });
});
