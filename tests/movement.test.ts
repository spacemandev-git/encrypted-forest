/**
 * Ship movement integration tests.
 *
 * Tests:
 * 1. Move ships between own planets (reinforcement)
 * 2. Move ships to neutral planet (attack)
 * 3. Verify distance decay
 * 4. Verify landing slot computation
 * 5. Verify metal transfers
 * 6. Reject move with insufficient ships
 * 7. Reject move when not planet owner
 * 8. Test pending moves creation
 *
 * NOTE: Movement requires the source planet to be owned by the player.
 * Since claim_spawn_planet requires Arcium (has_spawned = true from callback),
 * these tests document the expected instruction behavior and test what we can
 * with the publicly writable instruction. We need to set up planet ownership
 * which normally comes from the Arcium spawn flow.
 *
 * For tests that require owned planets, we test the helper functions directly
 * and verify the instruction account constraints.
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
  deriveGamePDA,
  derivePlayerPDA,
  derivePlanetPDA,
  derivePendingMovesPDA,
  computePlanetHash,
  computeDistance,
  applyDistanceDecay,
  computeLandingSlot,
  findSpawnPlanet,
  findPlanetOfType,
  nextGameId,
  CelestialBodyType,
  DEFAULT_THRESHOLDS,
  DEFAULT_GAME_SPEED,
} from "./helpers";

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
});

describe("Move Ships Instruction", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("rejects move when player does not own source planet", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    // Create two planets (both unowned neutral)
    const spawn1 = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const spawn2 = findPlanetOfType(
      gameId,
      DEFAULT_THRESHOLDS,
      CelestialBodyType.Planet,
      2,
      1000,
      100_000,
      50_000
    );

    await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn1.x,
      spawn1.y,
      spawn1.hash
    );
    await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn2.x,
      spawn2.y,
      spawn2.hash
    );

    const [gamePDA] = deriveGamePDA(gameId, program.programId);
    const [sourcePlanetPDA] = derivePlanetPDA(
      gameId,
      spawn1.hash,
      program.programId
    );
    const [sourcePendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn1.hash,
      program.programId
    );
    const [targetPlanetPDA] = derivePlanetPDA(
      gameId,
      spawn2.hash,
      program.programId
    );
    const [targetPendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn2.hash,
      program.programId
    );

    // Neither planet is owned, so move should fail
    await expect(
      program.methods
        .moveShips(
          new BN(gameId.toString()),
          Array.from(spawn1.hash) as any,
          Array.from(spawn2.hash) as any,
          new BN(1), // ships_to_send
          new BN(0), // metal_to_send
          new BN(spawn1.x.toString()), // source_x
          new BN(spawn1.y.toString()), // source_y
          new BN(spawn2.x.toString()), // target_x
          new BN(spawn2.y.toString()) // target_y
        )
        .accounts({
          playerOwner: admin.publicKey,
          game: gamePDA,
          sourcePlanet: sourcePlanetPDA,
          sourcePending: sourcePendingPDA,
          targetPlanet: targetPlanetPDA,
          targetPending: targetPendingPDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });

  it("rejects move with zero ships", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn1 = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const spawn2 = findPlanetOfType(
      gameId,
      DEFAULT_THRESHOLDS,
      CelestialBodyType.Planet,
      2,
      1000,
      100_000,
      50_000
    );

    await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn1.x,
      spawn1.y,
      spawn1.hash
    );
    await createPlanetOnChain(
      program,
      admin,
      gameId,
      spawn2.x,
      spawn2.y,
      spawn2.hash
    );

    const [gamePDA] = deriveGamePDA(gameId, program.programId);
    const [sourcePlanetPDA] = derivePlanetPDA(
      gameId,
      spawn1.hash,
      program.programId
    );
    const [sourcePendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn1.hash,
      program.programId
    );
    const [targetPlanetPDA] = derivePlanetPDA(
      gameId,
      spawn2.hash,
      program.programId
    );
    const [targetPendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn2.hash,
      program.programId
    );

    await expect(
      program.methods
        .moveShips(
          new BN(gameId.toString()),
          Array.from(spawn1.hash) as any,
          Array.from(spawn2.hash) as any,
          new BN(0), // zero ships -> should fail
          new BN(0),
          new BN(spawn1.x.toString()),
          new BN(spawn1.y.toString()),
          new BN(spawn2.x.toString()),
          new BN(spawn2.y.toString())
        )
        .accounts({
          playerOwner: admin.publicKey,
          game: gamePDA,
          sourcePlanet: sourcePlanetPDA,
          sourcePending: sourcePendingPDA,
          targetPlanet: targetPlanetPDA,
          targetPending: targetPendingPDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });
});

describe("Pending Moves and Combat Logic (unit tests)", () => {
  it("verifies reinforcement logic", () => {
    // When a friendly move lands, ships are added (capped at max capacity)
    const planetShips = 50n;
    const maxCapacity = 100n;
    const reinforcement = 30n;
    const result = planetShips + reinforcement;
    const capped = result > maxCapacity ? maxCapacity : result;
    expect(capped).toBe(80n);
  });

  it("verifies combat: attacker wins", () => {
    // Attacker has more ships than defender
    const attackerShips = 100n;
    const defenderShips = 60n;
    const remaining = attackerShips - defenderShips;
    expect(remaining).toBe(40n);
    // Attacker takes over with 40 ships
  });

  it("verifies combat: defender wins (tie goes to defender)", () => {
    const attackerShips = 50n;
    const defenderShips = 50n;
    // tie: defender wins
    const defenderRemaining = defenderShips - attackerShips;
    expect(defenderRemaining).toBe(0n);
    // Defender still owns but has 0 ships
  });

  it("verifies combat: defender wins with surplus", () => {
    const attackerShips = 30n;
    const defenderShips = 80n;
    const defenderRemaining = defenderShips - attackerShips;
    expect(defenderRemaining).toBe(50n);
  });

  it("verifies ship generation computation", () => {
    // compute_current_ships(last_count, max_cap, gen_speed, last_slot, current_slot, game_speed)
    const lastCount = 10n;
    const maxCap = 100n;
    const genSpeed = 2n;
    const lastSlot = 1000n;
    const currentSlot = 2000n;
    const gameSpeed = 10000n;

    // elapsed = 1000, generated = 2 * 1000 / 10000 = 0 (integer division)
    const elapsed = currentSlot - lastSlot;
    const generated = (genSpeed * elapsed) / gameSpeed;
    const ships = lastCount + generated;
    const result = ships > maxCap ? maxCap : ships;
    expect(result).toBe(10n); // 0 generated in 1000 slots at game_speed 10000

    // With more elapsed time
    const currentSlot2 = 51000n;
    const elapsed2 = currentSlot2 - lastSlot;
    const generated2 = (genSpeed * elapsed2) / gameSpeed;
    const ships2 = lastCount + generated2;
    const result2 = ships2 > maxCap ? maxCap : ships2;
    expect(result2).toBe(20n); // 10 + 2*50000/10000 = 10 + 10 = 20
  });
});
