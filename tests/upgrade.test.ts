/**
 * Upgrade integration tests.
 *
 * Tests:
 * 1. queue_upgrade_planet flow (requires Arcium)
 * 2. Verify encrypted state changes after upgrade
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
  createGame,
  initPlayer,
  defaultGameConfig,
  setupEncryption,
  queueInitSpawnPlanet,
  queueUpgradePlanet,
  buildUpgradePlanetValues,
  findSpawnPlanet,
  nextGameId,
  upgradeCost,
  awaitComputationFinalization,
  getArciumEnv,
  UpgradeFocus,
  EncryptionContext,
} from "./helpers";

// ---------------------------------------------------------------------------
// Queue Upgrade Planet (MPC)
// ---------------------------------------------------------------------------

describe("Queue Upgrade Planet", () => {
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

  it("queues upgrade and updates encrypted state", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    // Spawn to own a planet
    const spawn = findSpawnPlanet(gameId, defaultGameConfig(gameId).noiseThresholds);
    const { computationOffset: spawnCO, planetPDA } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn.x, spawn.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    // Read state before upgrade
    const bodyBefore = await program.account.encryptedCelestialBody.fetch(planetPDA);
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    const upgradeValues = buildUpgradePlanetValues(
      1n,
      UpgradeFocus.Range,
      currentSlot,
      1000n,
      BigInt(bodyBefore.lastUpdatedSlot.toString()),
      upgradeCost(1)
    );

    const { computationOffset: upgradeCO } = await queueUpgradePlanet(
      program, admin, gameId, planetPDA,
      upgradeValues, encCtx
    );

    await awaitComputationFinalization(
      provider, upgradeCO, program.programId, "confirmed"
    );

    // Verify encrypted state changed
    const bodyAfter = await program.account.encryptedCelestialBody.fetch(planetPDA);
    expect(Number(bodyAfter.lastUpdatedSlot)).toBeGreaterThanOrEqual(
      Number(bodyBefore.lastUpdatedSlot)
    );

    // State should have changed (level increased, stats doubled)
    const staticCtsBefore = bodyBefore.staticEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const staticCtsAfter = bodyAfter.staticEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const dynamicCtsBefore = bodyBefore.dynamicEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const dynamicCtsAfter = bodyAfter.dynamicEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const staticNonceBefore = Buffer.from(bodyBefore.staticEncNonce as any).toString("hex");
    const staticNonceAfter = Buffer.from(bodyAfter.staticEncNonce as any).toString("hex");
    const dynamicNonceBefore = Buffer.from(bodyBefore.dynamicEncNonce as any).toString("hex");
    const dynamicNonceAfter = Buffer.from(bodyAfter.dynamicEncNonce as any).toString("hex");
    // At least one of static or dynamic encrypted state should have changed
    const beforeFingerprint = staticNonceBefore + staticCtsBefore + dynamicNonceBefore + dynamicCtsBefore;
    const afterFingerprint = staticNonceAfter + staticCtsAfter + dynamicNonceAfter + dynamicCtsAfter;
    expect(beforeFingerprint).not.toBe(afterFingerprint);
  });

  it("queues upgrade with LaunchVelocity focus", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    const spawn = findSpawnPlanet(gameId, defaultGameConfig(gameId).noiseThresholds);
    const { computationOffset: spawnCO, planetPDA } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn.x, spawn.y, 0n, 0n, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    const bodyBefore = await program.account.encryptedCelestialBody.fetch(planetPDA);
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    const upgradeValues = buildUpgradePlanetValues(
      1n,
      UpgradeFocus.LaunchVelocity,
      currentSlot,
      1000n,
      BigInt(bodyBefore.lastUpdatedSlot.toString()),
      upgradeCost(1)
    );

    const { computationOffset: upgradeCO } = await queueUpgradePlanet(
      program, admin, gameId, planetPDA,
      upgradeValues, encCtx
    );

    await awaitComputationFinalization(
      provider, upgradeCO, program.programId, "confirmed"
    );

    const bodyAfter = await program.account.encryptedCelestialBody.fetch(planetPDA);
    expect(Number(bodyAfter.lastUpdatedSlot)).toBeGreaterThanOrEqual(
      Number(bodyBefore.lastUpdatedSlot)
    );
  });
});
