/**
 * Ship movement integration tests.
 *
 * Tests:
 * 1. queue_process_move flow (requires Arcium)
 * 2. Pending moves creation and flush
 *
 * REQUIRES: Surfpool + Arcium ARX nodes running
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
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
  queueProcessMove,
  queueFlushPlanet,
  computePlanetHash,
  computeDistance,
  computeLandingSlot,
  derivePlanetPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,
  buildProcessMoveValues,
  buildFlushPlanetValues,
  findSpawnPlanet,
  findPlanetOfType,
  nextGameId,
  awaitComputationFinalization,
  getArciumEnv,
  CelestialBodyType,
  DEFAULT_THRESHOLDS,
  DEFAULT_GAME_SPEED,
  EncryptionContext,
} from "./helpers";

// ---------------------------------------------------------------------------
// Queue Process Move (MPC)
// ---------------------------------------------------------------------------

describe("Queue Process Move", () => {
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

  it("creates pending move on target planet after process_move", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    // Spawn at source (playerId=0n for first player, sourcePlanetId=0n for spawn)
    const source = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: spawnCO, planetPDA: sourcePDA } = await queueInitSpawnPlanet(
      program, admin, gameId, source.x, source.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    // Init target
    const target = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000);
    const targetHash = computePlanetHash(target.x, target.y, gameId);
    const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetHash, program.programId);

    const { computationOffset: initCO } = await queueInitPlanet(
      program, admin, gameId, target.x, target.y, encCtx
    );
    await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

    // Send move
    const sourceBody = await program.account.encryptedCelestialBody.fetch(sourcePDA);
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    // Derive source pending moves PDA
    const sourceHash = computePlanetHash(source.x, source.y, gameId);
    const [sourcePendingPDA] = derivePendingMovesPDA(gameId, sourceHash, program.programId);

    // Compute landing slot for the move
    const distance = computeDistance(source.x, source.y, target.x, target.y);
    const launchVelocity = BigInt(sourceBody.launchVelocity?.toString() || "2");
    const landingSlot = computeLandingSlot(currentSlot, distance, launchVelocity, 1000n);

    const moveValues = buildProcessMoveValues(
      1n, 0n,    // playerId, sourcePlanetId
      3n, 0n,    // shipsToSend, metalToSend
      source.x, source.y, target.x, target.y,
    );

    const { computationOffset: moveCO } = await queueProcessMove(
      program, admin, gameId, sourcePDA, sourcePendingPDA, targetPendingPDA,
      landingSlot, 10n, 0n, moveValues, encCtx
    );

    await awaitComputationFinalization(provider, moveCO, program.programId, "confirmed");

    // Verify pending move
    const pending = await program.account.pendingMovesMetadata.fetch(targetPendingPDA);
    expect(pending.moves.length).toBe(1);
    expect(pending.moves[0].landingSlot).toBeDefined();
    expect(pending.moves[0].moveId).toBeDefined();
    expect(pending.moves[0].payer).toBeDefined();
  });

  it("updates source planet encrypted state after move", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    const source = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: spawnCO, planetPDA: sourcePDA } = await queueInitSpawnPlanet(
      program, admin, gameId, source.x, source.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    const bodyBefore = await program.account.encryptedCelestialBody.fetch(sourcePDA);

    // Init target
    const target = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000);
    const targetHash = computePlanetHash(target.x, target.y, gameId);
    const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetHash, program.programId);

    const { computationOffset: initCO } = await queueInitPlanet(
      program, admin, gameId, target.x, target.y, encCtx
    );
    await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

    // Send move
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    // Derive source pending moves PDA
    const sourceHash = computePlanetHash(source.x, source.y, gameId);
    const [sourcePendingPDA] = derivePendingMovesPDA(gameId, sourceHash, program.programId);

    // Compute landing slot
    const distance = computeDistance(source.x, source.y, target.x, target.y);
    const launchVelocity = BigInt(bodyBefore.launchVelocity?.toString() || "2");
    const landingSlot = computeLandingSlot(currentSlot, distance, launchVelocity, 1000n);

    const moveValues = buildProcessMoveValues(
      1n, 0n,    // playerId, sourcePlanetId
      3n, 0n,    // shipsToSend, metalToSend
      source.x, source.y, target.x, target.y,
    );

    const { computationOffset: moveCO } = await queueProcessMove(
      program, admin, gameId, sourcePDA, sourcePendingPDA, targetPendingPDA,
      landingSlot, 10n, 0n, moveValues, encCtx
    );
    await awaitComputationFinalization(provider, moveCO, program.programId, "confirmed");

    const bodyAfter = await program.account.encryptedCelestialBody.fetch(sourcePDA);

    // Source state should be updated (ships deducted)
    expect(Number(bodyAfter.lastUpdatedSlot)).toBeGreaterThanOrEqual(
      Number(bodyBefore.lastUpdatedSlot)
    );
    const stateCtsBefore = bodyBefore.stateEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const stateCtsAfter = bodyAfter.stateEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const stateNonceBefore = Buffer.from(bodyBefore.stateEncNonce as any).toString("hex");
    const stateNonceAfter = Buffer.from(bodyAfter.stateEncNonce as any).toString("hex");

    const beforeFingerprint = stateNonceBefore + stateCtsBefore;
    const afterFingerprint = stateNonceAfter + stateCtsAfter;
    expect(beforeFingerprint).not.toBe(afterFingerprint);
  });
});

// ---------------------------------------------------------------------------
// Queue Flush Planet (MPC)
// ---------------------------------------------------------------------------

describe("Queue Flush Planet", () => {
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

  it("removes pending move after flush", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    // Set up: spawn + init target + move
    const source = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: spawnCO, planetPDA: sourcePDA } = await queueInitSpawnPlanet(
      program, admin, gameId, source.x, source.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    const target = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000);
    const targetHash = computePlanetHash(target.x, target.y, gameId);
    const [targetPlanetPDA] = derivePlanetPDA(gameId, targetHash, program.programId);
    const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetHash, program.programId);

    const { computationOffset: initCO } = await queueInitPlanet(
      program, admin, gameId, target.x, target.y, encCtx
    );
    await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

    // Send move
    const sourceBody = await program.account.encryptedCelestialBody.fetch(sourcePDA);
    const slot1 = BigInt(await provider.connection.getSlot("confirmed"));

    // Derive source pending moves PDA
    const sourceHash = computePlanetHash(source.x, source.y, gameId);
    const [sourcePendingPDA] = derivePendingMovesPDA(gameId, sourceHash, program.programId);

    // Compute landing slot
    const distance = computeDistance(source.x, source.y, target.x, target.y);
    const launchVelocity = BigInt(sourceBody.launchVelocity?.toString() || "2");
    const landingSlot = computeLandingSlot(slot1, distance, launchVelocity, 1000n);

    const moveValues = buildProcessMoveValues(
      1n, 0n,    // playerId, sourcePlanetId
      5n, 0n,    // shipsToSend, metalToSend
      source.x, source.y, target.x, target.y,
    );
    const { computationOffset: moveCO } = await queueProcessMove(
      program, admin, gameId, sourcePDA, sourcePendingPDA, targetPendingPDA,
      landingSlot, 10n, 0n, moveValues, encCtx
    );
    await awaitComputationFinalization(provider, moveCO, program.programId, "confirmed");

    // Verify 1 pending move
    const pendingBefore = await program.account.pendingMovesMetadata.fetch(targetPendingPDA);
    expect(pendingBefore.moves.length).toBe(1);

    // Get the move ID and derive the PendingMoveAccount PDA
    const moveId = BigInt(pendingBefore.moves[0].moveId.toString());
    const [moveAccountPDA] = derivePendingMoveAccountPDA(gameId, targetHash, moveId, program.programId);

    // Flush
    const targetBody = await program.account.encryptedCelestialBody.fetch(targetPlanetPDA);
    const slot2 = BigInt(await provider.connection.getSlot("confirmed"));
    const flushValues = buildFlushPlanetValues(
      slot2, 1000n,
      BigInt(targetBody.lastUpdatedSlot.toString()),
      1n
    );
    const { computationOffset: flushCO } = await queueFlushPlanet(
      program, admin, targetPlanetPDA, targetPendingPDA,
      1, flushValues, [moveAccountPDA], encCtx
    );
    await awaitComputationFinalization(provider, flushCO, program.programId, "confirmed");

    // Verify pending move was removed
    const pendingAfter = await program.account.pendingMovesMetadata.fetch(targetPendingPDA);
    expect(pendingAfter.moves.length).toBe(0);

    // Verify last_flushed_slot was updated
    const bodyAfter = await program.account.encryptedCelestialBody.fetch(targetPlanetPDA);
    expect(Number(bodyAfter.lastFlushedSlot)).toBeGreaterThanOrEqual(Number(targetBody.lastFlushedSlot));
  });
});
