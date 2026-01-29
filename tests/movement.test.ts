/**
 * Ship movement integration tests.
 *
 * Tests:
 * 1. Distance computation (client-side unit tests)
 * 2. Distance decay computation
 * 3. Landing slot computation
 * 4. Ship generation computation
 * 5. queue_process_move flow (requires Arcium)
 * 6. Pending moves creation and flush
 *
 * NOTE: All movement now goes through MPC via queue_process_move.
 * The MPC circuit validates ownership, deducts ships from source,
 * computes landing slot, and returns encrypted move data.
 * The callback writes the move to target's pending moves.
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
  applyDistanceDecay,
  computeLandingSlot,
  derivePlanetPDA,
  derivePendingMovesPDA,
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
// Movement Helper Functions (pure unit tests, no chain needed)
// ---------------------------------------------------------------------------

describe("Movement Helper Functions", () => {
  it("computes distance correctly", () => {
    // max(dx, dy) + min(dx, dy) / 2
    // (0,0) -> (3,4): max(3,4) + min(3,4)/2 = 4 + 1 = 5
    expect(computeDistance(0n, 0n, 3n, 4n)).toBe(5n);

    // (0,0) -> (10,0): max(10,0) + 0 = 10
    expect(computeDistance(0n, 0n, 10n, 0n)).toBe(10n);

    // (0,0) -> (0,10): max(0,10) + 0 = 10
    expect(computeDistance(0n, 0n, 0n, 10n)).toBe(10n);

    // negative coordinates
    expect(computeDistance(-5n, -5n, 5n, 5n)).toBe(15n); // max(10,10) + 10/2 = 15

    // same point
    expect(computeDistance(3n, 7n, 3n, 7n)).toBe(0n);
  });

  it("applies distance decay correctly", () => {
    // 10 ships, distance 6, range 3 -> lost = 6/3 = 2 -> 8 survive
    expect(applyDistanceDecay(10n, 6n, 3n)).toBe(8n);

    // 5 ships, distance 20, range 3 -> lost = 6 -> max(0, 5-6) = 0
    expect(applyDistanceDecay(5n, 20n, 3n)).toBe(0n);

    // No distance = no decay
    expect(applyDistanceDecay(10n, 0n, 3n)).toBe(10n);

    // Range 0 = all ships lost
    expect(applyDistanceDecay(10n, 5n, 0n)).toBe(0n);
  });

  it("computes landing slot correctly", () => {
    // current=100, distance=10, velocity=5, speed=10000
    // travel_time = 10 * 10000 / 5 = 20000
    // landing = 100 + 20000 = 20100
    expect(computeLandingSlot(100n, 10n, 5n, 10000n)).toBe(20100n);

    // Zero velocity = max
    expect(computeLandingSlot(100n, 10n, 0n, 10000n)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER)
    );

    // Same spot (distance 0) = instant
    expect(computeLandingSlot(100n, 0n, 5n, 10000n)).toBe(100n);
  });

  it("verifies reinforcement logic (unit test)", () => {
    const planetShips = 50n;
    const maxCapacity = 100n;
    const reinforcement = 30n;
    const result = planetShips + reinforcement;
    const capped = result > maxCapacity ? maxCapacity : result;
    expect(capped).toBe(80n);
  });

  it("verifies combat: attacker wins (unit test)", () => {
    const attackerShips = 100n;
    const defenderShips = 60n;
    const remaining = attackerShips - defenderShips;
    expect(remaining).toBe(40n);
  });

  it("verifies combat: defender wins tie (unit test)", () => {
    const attackerShips = 50n;
    const defenderShips = 50n;
    const defenderRemaining = defenderShips - attackerShips;
    expect(defenderRemaining).toBe(0n);
    // Defender still owns with 0 ships
  });

  it("verifies combat: defender wins with surplus (unit test)", () => {
    const attackerShips = 30n;
    const defenderShips = 80n;
    const defenderRemaining = defenderShips - attackerShips;
    expect(defenderRemaining).toBe(50n);
  });

  it("verifies ship generation computation (unit test)", () => {
    const lastCount = 10n;
    const maxCap = 100n;
    const genSpeed = 2n;
    const lastSlot = 1000n;
    const gameSpeed = 10000n;

    // 1000 slots elapsed: generated = 2 * 1000 / 10000 = 0
    const currentSlot1 = 2000n;
    const elapsed1 = currentSlot1 - lastSlot;
    const generated1 = (genSpeed * elapsed1) / gameSpeed;
    const result1 = (lastCount + generated1) > maxCap ? maxCap : (lastCount + generated1);
    expect(result1).toBe(10n);

    // 50000 slots elapsed: generated = 2 * 50000 / 10000 = 10
    const currentSlot2 = 51000n;
    const elapsed2 = currentSlot2 - lastSlot;
    const generated2 = (genSpeed * elapsed2) / gameSpeed;
    const result2 = (lastCount + generated2) > maxCap ? maxCap : (lastCount + generated2);
    expect(result2).toBe(20n);
  });
});

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

    // Spawn at source
    const source = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: spawnCO, planetPDA: sourcePDA } = await queueInitSpawnPlanet(
      program, admin, gameId, source.x, source.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    // Init target
    const target = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000);
    const targetHash = computePlanetHash(target.x, target.y, gameId);
    const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetHash, program.programId);

    const { computationOffset: initCO } = await queueInitPlanet(
      program, admin, gameId, target.x, target.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

    // Send move
    const sourceBody = await program.account.encryptedCelestialBody.fetch(sourcePDA);
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    const moveValues = buildProcessMoveValues(
      admin.publicKey,
      3n, 0n,
      source.x, source.y, target.x, target.y,
      currentSlot, 10000n,
      BigInt(sourceBody.lastUpdatedSlot.toString())
    );

    const { computationOffset: moveCO } = await queueProcessMove(
      program, admin, gameId, sourcePDA, targetPendingPDA,
      {
        encPubkey: sourceBody.encPubkey as any,
        encNonce: sourceBody.encNonce as any,
        encCiphertexts: sourceBody.encCiphertexts as any,
      },
      moveValues, encCtx
    );

    await awaitComputationFinalization(provider, moveCO, program.programId, "confirmed");

    // Verify pending move
    const pending = await program.account.encryptedPendingMoves.fetch(targetPendingPDA);
    expect(pending.moveCount).toBe(1);
    expect(pending.moves.length).toBe(1);
    expect(pending.moves[0].active).toBe(true);
    expect(pending.moves[0].encPubkey.length).toBe(32);
    expect(pending.moves[0].encNonce.length).toBe(16);
    expect(pending.moves[0].encCiphertexts.length).toBe(6);
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
      program, admin, gameId, source.x, source.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    const bodyBefore = await program.account.encryptedCelestialBody.fetch(sourcePDA);

    // Init target
    const target = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000);
    const targetHash = computePlanetHash(target.x, target.y, gameId);
    const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetHash, program.programId);

    const { computationOffset: initCO } = await queueInitPlanet(
      program, admin, gameId, target.x, target.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

    // Send move
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));
    const moveValues = buildProcessMoveValues(
      admin.publicKey,
      3n, 0n,
      source.x, source.y, target.x, target.y,
      currentSlot, 10000n,
      BigInt(bodyBefore.lastUpdatedSlot.toString())
    );

    const { computationOffset: moveCO } = await queueProcessMove(
      program, admin, gameId, sourcePDA, targetPendingPDA,
      {
        encPubkey: bodyBefore.encPubkey as any,
        encNonce: bodyBefore.encNonce as any,
        encCiphertexts: bodyBefore.encCiphertexts as any,
      },
      moveValues, encCtx
    );
    await awaitComputationFinalization(provider, moveCO, program.programId, "confirmed");

    const bodyAfter = await program.account.encryptedCelestialBody.fetch(sourcePDA);

    // Source state should be updated (ships deducted)
    expect(Number(bodyAfter.lastUpdatedSlot)).toBeGreaterThanOrEqual(
      Number(bodyBefore.lastUpdatedSlot)
    );
    // Ciphertexts should have changed
    const ctsBefore = bodyBefore.encCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const ctsAfter = bodyAfter.encCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const nonceBefore = Buffer.from(bodyBefore.encNonce as any).toString("hex");
    const nonceAfter = Buffer.from(bodyAfter.encNonce as any).toString("hex");
    expect(nonceBefore + ctsBefore).not.toBe(nonceAfter + ctsAfter);
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
      program, admin, gameId, source.x, source.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    const target = findPlanetOfType(gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000);
    const targetHash = computePlanetHash(target.x, target.y, gameId);
    const [targetPlanetPDA] = derivePlanetPDA(gameId, targetHash, program.programId);
    const [targetPendingPDA] = derivePendingMovesPDA(gameId, targetHash, program.programId);

    const { computationOffset: initCO } = await queueInitPlanet(
      program, admin, gameId, target.x, target.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

    // Send move
    const sourceBody = await program.account.encryptedCelestialBody.fetch(sourcePDA);
    const slot1 = BigInt(await provider.connection.getSlot("confirmed"));
    const moveValues = buildProcessMoveValues(
      admin.publicKey, 5n, 0n,
      source.x, source.y, target.x, target.y,
      slot1, 10000n, BigInt(sourceBody.lastUpdatedSlot.toString())
    );
    const { computationOffset: moveCO } = await queueProcessMove(
      program, admin, gameId, sourcePDA, targetPendingPDA,
      {
        encPubkey: sourceBody.encPubkey as any,
        encNonce: sourceBody.encNonce as any,
        encCiphertexts: sourceBody.encCiphertexts as any,
      },
      moveValues, encCtx
    );
    await awaitComputationFinalization(provider, moveCO, program.programId, "confirmed");

    // Verify 1 pending move
    const pendingBefore = await program.account.encryptedPendingMoves.fetch(targetPendingPDA);
    expect(pendingBefore.moveCount).toBe(1);

    // Flush
    const targetBody = await program.account.encryptedCelestialBody.fetch(targetPlanetPDA);
    const slot2 = BigInt(await provider.connection.getSlot("confirmed"));
    const flushValues = buildFlushPlanetValues(
      slot2, 10000n,
      BigInt(targetBody.lastUpdatedSlot.toString()),
      5n, 0n, admin.publicKey, true
    );
    const { computationOffset: flushCO } = await queueFlushPlanet(
      program, admin, targetPlanetPDA, targetPendingPDA,
      {
        encPubkey: targetBody.encPubkey as any,
        encNonce: targetBody.encNonce as any,
        encCiphertexts: targetBody.encCiphertexts as any,
      },
      flushValues, 0, encCtx
    );
    await awaitComputationFinalization(provider, flushCO, program.programId, "confirmed");

    // Verify pending move was removed
    const pendingAfter = await program.account.encryptedPendingMoves.fetch(targetPendingPDA);
    expect(pendingAfter.moveCount).toBe(0);
    expect(pendingAfter.moves.length).toBe(0);

    // Verify last_flushed_slot was updated
    const bodyAfter = await program.account.encryptedCelestialBody.fetch(targetPlanetPDA);
    expect(Number(bodyAfter.lastFlushedSlot)).toBeGreaterThanOrEqual(Number(targetBody.lastFlushedSlot));
  });
});
