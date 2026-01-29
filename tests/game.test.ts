/**
 * Game creation integration tests.
 *
 * Tests:
 * 1. Create game with default config
 * 2. Create game with custom thresholds
 * 3. Create game with whitelist enabled
 * 4. Verify game account data matches config
 * 5. Reject invalid configurations (zero map diameter, zero game speed, bad time range)
 * 6. Create multiple independent games
 * 7. Both win condition types
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import type { EncryptedForest } from "../target/types/encrypted_forest";
import {
  getProviderAndProgram,
  readKpJson,
  createGame,
  defaultGameConfig,
  deriveGamePDA,
  nextGameId,
  DEFAULT_THRESHOLDS,
  DEFAULT_MAP_DIAMETER,
  DEFAULT_GAME_SPEED,
} from "./helpers";

describe("Game Creation", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("creates a game with default config", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    const gamePDA = await createGame(program, admin, config);

    const gameAccount = await program.account.game.fetch(gamePDA);
    expect(gameAccount.admin.toString()).toBe(admin.publicKey.toString());
    expect(gameAccount.gameId.toString()).toBe(gameId.toString());
    expect(gameAccount.mapDiameter.toString()).toBe(
      DEFAULT_MAP_DIAMETER.toString()
    );
    expect(gameAccount.gameSpeed.toString()).toBe(
      DEFAULT_GAME_SPEED.toString()
    );
    expect(gameAccount.whitelist).toBe(false);
    expect(gameAccount.serverPubkey).toBeNull();
  });

  it("creates a game with custom noise thresholds", async () => {
    const gameId = nextGameId();
    const customThresholds = {
      deadSpaceThreshold: 64,
      planetThreshold: 200,
      quasarThreshold: 230,
      spacetimeRipThreshold: 245,
      asteroidBeltThreshold: 255,
      sizeThreshold1: 20,
      sizeThreshold2: 60,
      sizeThreshold3: 120,
      sizeThreshold4: 180,
      sizeThreshold5: 240,
    };

    const config = defaultGameConfig(gameId, {
      noiseThresholds: customThresholds,
    });
    const gamePDA = await createGame(program, admin, config);

    const gameAccount = await program.account.game.fetch(gamePDA);
    expect(gameAccount.noiseThresholds.deadSpaceThreshold).toBe(64);
    expect(gameAccount.noiseThresholds.planetThreshold).toBe(200);
    expect(gameAccount.noiseThresholds.sizeThreshold1).toBe(20);
  });

  it("creates a game with whitelist enabled", async () => {
    const gameId = nextGameId();
    const serverKp = Keypair.generate();

    const config = defaultGameConfig(gameId, {
      whitelist: true,
      serverPubkey: serverKp.publicKey,
    });
    const gamePDA = await createGame(program, admin, config);

    const gameAccount = await program.account.game.fetch(gamePDA);
    expect(gameAccount.whitelist).toBe(true);
    expect(gameAccount.serverPubkey?.toString()).toBe(
      serverKp.publicKey.toString()
    );
  });

  it("creates a game with PointsBurning win condition", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      winCondition: { pointsBurning: { pointsPerMetal: new BN(5) } },
    });
    const gamePDA = await createGame(program, admin, config);

    const gameAccount = await program.account.game.fetch(gamePDA);
    expect(gameAccount.winCondition).toBeDefined();
  });

  it("creates a game with RaceToCenter win condition", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      winCondition: { raceToCenter: { minSpawnDistance: new BN(50) } },
    });
    const gamePDA = await createGame(program, admin, config);

    const gameAccount = await program.account.game.fetch(gamePDA);
    expect(gameAccount.winCondition).toBeDefined();
  });

  it("rejects game with zero map diameter", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      mapDiameter: new BN(0),
    });

    await expect(createGame(program, admin, config)).rejects.toThrow();
  });

  it("rejects game with zero game speed", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      gameSpeed: new BN(0),
    });

    await expect(createGame(program, admin, config)).rejects.toThrow();
  });

  it("rejects game with end_slot <= start_slot", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      startSlot: new BN(1000),
      endSlot: new BN(500),
    });

    await expect(createGame(program, admin, config)).rejects.toThrow();
  });

  it("rejects whitelist game without server pubkey", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      whitelist: true,
      serverPubkey: null,
    });

    await expect(createGame(program, admin, config)).rejects.toThrow();
  });

  it("creates multiple independent games", async () => {
    const gameId1 = nextGameId();
    const gameId2 = nextGameId();
    const config1 = defaultGameConfig(gameId1);
    const config2 = defaultGameConfig(gameId2, {
      mapDiameter: new BN(500),
    });

    const gamePDA1 = await createGame(program, admin, config1);
    const gamePDA2 = await createGame(program, admin, config2);

    expect(gamePDA1.toString()).not.toBe(gamePDA2.toString());

    const game1 = await program.account.game.fetch(gamePDA1);
    const game2 = await program.account.game.fetch(gamePDA2);
    expect(game1.mapDiameter.toString()).toBe("1000");
    expect(game2.mapDiameter.toString()).toBe("500");
  });

  it("verifies game account PDA derivation matches", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);

    const [expectedPDA] = deriveGamePDA(gameId, program.programId);
    const gamePDA = await createGame(program, admin, config);

    expect(gamePDA.toString()).toBe(expectedPDA.toString());
  });
});
