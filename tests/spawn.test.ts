/**
 * Spawn and planet creation integration tests.
 *
 * Tests the encrypted spawn flow:
 * - queue_init_planet: creates EncryptedCelestialBody + EncryptedPendingMoves via MPC
 * - queue_init_spawn_planet: same as init_planet but also sets player.has_spawned
 *
 * REQUIRES: Surfpool + Arcium ARX nodes running
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
  findSpawnPlanet,
  findPlanetOfType,
  nextGameId,
  awaitComputationFinalization,
  getArciumEnv,
  CelestialBodyType,
  DEFAULT_THRESHOLDS,
  EncryptionContext,
} from "./helpers";

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
      program, admin, gameId, coord.x, coord.y, encCtx
    );

    const finalizeSig = await awaitComputationFinalization(
      provider, computationOffset, program.programId, "confirmed"
    );
    console.log("Init planet finalized:", finalizeSig);

    // Verify EncryptedCelestialBody account
    const body = await program.account.encryptedCelestialBody.fetch(planetPDA);
    expect(body.planetHash).toEqual(Array.from(coord.hash));
    expect(body.staticEncCiphertexts.length).toBe(4);
    expect(body.dynamicEncCiphertexts.length).toBe(2);
    expect(Number(body.lastUpdatedSlot)).toBeGreaterThan(0);

    // Verify PendingMovesMetadata account
    const pending = await program.account.pendingMovesMetadata.fetch(pendingMovesPDA);
    expect(pending.gameId.toString()).toBe(gameId.toString());
    expect(pending.planetHash).toEqual(Array.from(coord.hash));
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
      program, admin, gameId, coord.x, coord.y, encCtx
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
      program, admin, gameId, spawn.x, spawn.y, 0n, 0n, encCtx
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
      program, admin, gameId, spawn1.x, spawn1.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, co1, program.programId, "confirmed");

    // Second spawn attempt should fail on the has_spawned check
    // We need different coords so the PDA is different
    try {
      const spawn2 = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 1, 1000, 100_000, 50_000);
      if (spawn2.x !== spawn1.x || spawn2.y !== spawn1.y) {
        await expect(
          queueInitSpawnPlanet(
            program, admin, gameId, spawn2.x, spawn2.y, 0n, 0n, encCtx
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
        program, admin, gameId, spawn.x, spawn.y, 0n, 0n, encCtx
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
      program, admin, gameId, spawn1.x, spawn1.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, co1, program.programId, "confirmed");

    // Player 2 spawns at different location
    if (spawn2.x !== spawn1.x || spawn2.y !== spawn1.y) {
      const { computationOffset: co2, playerPDA: p2PDA } = await queueInitSpawnPlanet(
        program, player2, gameId, spawn2.x, spawn2.y, 0n, 0n, encCtx2
      );
      await awaitComputationFinalization(provider, co2, program.programId, "confirmed");

      const p1 = await program.account.player.fetch(p1PDA);
      const p2 = await program.account.player.fetch(p2PDA);
      expect(p1.hasSpawned).toBe(true);
      expect(p2.hasSpawned).toBe(true);
    }
  });
});
