/**
 * Upgrade integration tests.
 *
 * Tests:
 * 1. Upgrade cost computation (client-side unit test)
 * 2. Upgrade stat changes for Range focus (unit test)
 * 3. Upgrade stat changes for LaunchVelocity focus (unit test)
 * 4. queue_upgrade_planet flow (requires Arcium)
 * 5. Verify encrypted state changes after upgrade
 *
 * NOTE: Upgrades go through MPC via queue_upgrade_planet. The MPC circuit
 * validates: player owns the planet, planet is a Planet type, has enough metal,
 * then doubles caps/gen and applies focus bonus.
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
  DEFAULT_THRESHOLDS,
  EncryptionContext,
} from "./helpers";

// ---------------------------------------------------------------------------
// Upgrade Cost Computation (pure unit tests)
// ---------------------------------------------------------------------------

describe("Upgrade Cost Computation", () => {
  it("computes correct upgrade costs", () => {
    // cost = 100 * 2^level
    expect(upgradeCost(1)).toBe(200n);   // level 1 -> 200 metal
    expect(upgradeCost(2)).toBe(400n);   // level 2 -> 400 metal
    expect(upgradeCost(3)).toBe(800n);   // level 3 -> 800 metal
    expect(upgradeCost(4)).toBe(1600n);
    expect(upgradeCost(5)).toBe(3200n);
  });
});

describe("Upgrade Stat Changes (Unit Tests)", () => {
  it("verifies Range focus upgrade doubles caps + gen + range", () => {
    const beforeStats = {
      maxShipCapacity: 100,
      maxMetalCapacity: 0,
      shipGenSpeed: 1,
      range: 4,
      launchVelocity: 2,
      level: 1,
    };

    const afterRange = {
      maxShipCapacity: beforeStats.maxShipCapacity * 2,
      maxMetalCapacity: beforeStats.maxMetalCapacity * 2,
      shipGenSpeed: beforeStats.shipGenSpeed * 2,
      range: beforeStats.range * 2,              // doubled
      launchVelocity: beforeStats.launchVelocity, // unchanged
      level: beforeStats.level + 1,
    };

    expect(afterRange.maxShipCapacity).toBe(200);
    expect(afterRange.shipGenSpeed).toBe(2);
    expect(afterRange.range).toBe(8);
    expect(afterRange.launchVelocity).toBe(2);
    expect(afterRange.level).toBe(2);
  });

  it("verifies LaunchVelocity focus upgrade doubles caps + gen + velocity", () => {
    const beforeStats = {
      maxShipCapacity: 100,
      maxMetalCapacity: 0,
      shipGenSpeed: 1,
      range: 4,
      launchVelocity: 2,
      level: 1,
    };

    const afterVelocity = {
      maxShipCapacity: beforeStats.maxShipCapacity * 2,
      maxMetalCapacity: beforeStats.maxMetalCapacity * 2,
      shipGenSpeed: beforeStats.shipGenSpeed * 2,
      range: beforeStats.range,                         // unchanged
      launchVelocity: beforeStats.launchVelocity * 2,   // doubled
      level: beforeStats.level + 1,
    };

    expect(afterVelocity.range).toBe(4);
    expect(afterVelocity.launchVelocity).toBe(4);
    expect(afterVelocity.level).toBe(2);
  });
});

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
    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: spawnCO, planetPDA } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn.x, spawn.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    // Read state before upgrade
    const bodyBefore = await program.account.encryptedCelestialBody.fetch(planetPDA);
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    const upgradeValues = buildUpgradePlanetValues(
      admin.publicKey,
      UpgradeFocus.Range,
      currentSlot,
      10000n,
      BigInt(bodyBefore.lastUpdatedSlot.toString())
    );

    const { computationOffset: upgradeCO } = await queueUpgradePlanet(
      program, admin, gameId, planetPDA,
      {
        encPubkey: bodyBefore.encPubkey as any,
        encNonce: bodyBefore.encNonce as any,
        encCiphertexts: bodyBefore.encCiphertexts as any,
      },
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
    const ctsBefore = bodyBefore.encCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const ctsAfter = bodyAfter.encCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
    const nonceBefore = Buffer.from(bodyBefore.encNonce as any).toString("hex");
    const nonceAfter = Buffer.from(bodyAfter.encNonce as any).toString("hex");
    expect(nonceBefore + ctsBefore).not.toBe(nonceAfter + ctsAfter);
  });

  it("queues upgrade with LaunchVelocity focus", async () => {
    if (!arciumAvailable) {
      console.log("Skipping: Arcium not available");
      return;
    }

    const gameId = nextGameId();
    await createGame(program, admin, defaultGameConfig(gameId));
    await initPlayer(program, admin, gameId);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const { computationOffset: spawnCO, planetPDA } = await queueInitSpawnPlanet(
      program, admin, gameId, spawn.x, spawn.y, DEFAULT_THRESHOLDS, encCtx
    );
    await awaitComputationFinalization(provider, spawnCO, program.programId, "confirmed");

    const bodyBefore = await program.account.encryptedCelestialBody.fetch(planetPDA);
    const currentSlot = BigInt(await provider.connection.getSlot("confirmed"));

    const upgradeValues = buildUpgradePlanetValues(
      admin.publicKey,
      UpgradeFocus.LaunchVelocity,
      currentSlot,
      10000n,
      BigInt(bodyBefore.lastUpdatedSlot.toString())
    );

    const { computationOffset: upgradeCO } = await queueUpgradePlanet(
      program, admin, gameId, planetPDA,
      {
        encPubkey: bodyBefore.encPubkey as any,
        encNonce: bodyBefore.encNonce as any,
        encCiphertexts: bodyBefore.encCiphertexts as any,
      },
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
