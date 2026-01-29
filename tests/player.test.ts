/**
 * Player initialization integration tests.
 *
 * Tests:
 * 1. Initialize player for non-whitelist game
 * 2. Initialize player with whitelist (requires server co-sign)
 * 3. Reject duplicate player init
 * 4. Verify player account data
 * 5. Reject whitelist player without server signature
 * 6. Reject whitelist player with wrong server key
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
  deriveGamePDA,
  derivePlayerPDA,
  nextGameId,
} from "./helpers";

describe("Player Initialization", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("initializes a player for a non-whitelist game", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const playerPDA = await initPlayer(program, admin, gameId);
    const playerAccount = await program.account.player.fetch(playerPDA);

    expect(playerAccount.owner.toString()).toBe(admin.publicKey.toString());
    expect(playerAccount.gameId.toString()).toBe(gameId.toString());
    expect(playerAccount.points.toString()).toBe("0");
    expect(playerAccount.hasSpawned).toBe(false);
  });

  it("initializes a player with whitelist (server co-sign)", async () => {
    const gameId = nextGameId();
    const serverKp = Keypair.generate();

    await airdrop(provider, serverKp.publicKey, 1);

    const config = defaultGameConfig(gameId, {
      whitelist: true,
      serverPubkey: serverKp.publicKey,
    });
    await createGame(program, admin, config);

    const playerPDA = await initPlayer(program, admin, gameId, serverKp);
    const playerAccount = await program.account.player.fetch(playerPDA);

    expect(playerAccount.owner.toString()).toBe(admin.publicKey.toString());
    expect(playerAccount.hasSpawned).toBe(false);
  });

  it("rejects duplicate player initialization", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    // First init should succeed
    await initPlayer(program, admin, gameId);

    // Second init with same player + game should fail (PDA already exists)
    await expect(initPlayer(program, admin, gameId)).rejects.toThrow();
  });

  it("allows different players in the same game", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const player2 = Keypair.generate();
    await airdrop(provider, player2.publicKey, 2);

    const pda1 = await initPlayer(program, admin, gameId);
    const pda2 = await initPlayer(program, player2, gameId);

    expect(pda1.toString()).not.toBe(pda2.toString());

    const account1 = await program.account.player.fetch(pda1);
    const account2 = await program.account.player.fetch(pda2);
    expect(account1.owner.toString()).toBe(admin.publicKey.toString());
    expect(account2.owner.toString()).toBe(player2.publicKey.toString());
  });

  it("allows same player in different games", async () => {
    const gameId1 = nextGameId();
    const gameId2 = nextGameId();

    await createGame(program, admin, defaultGameConfig(gameId1));
    await createGame(program, admin, defaultGameConfig(gameId2));

    const pda1 = await initPlayer(program, admin, gameId1);
    const pda2 = await initPlayer(program, admin, gameId2);

    expect(pda1.toString()).not.toBe(pda2.toString());
  });

  it("rejects whitelist player init without server signer", async () => {
    const gameId = nextGameId();
    const serverKp = Keypair.generate();
    const config = defaultGameConfig(gameId, {
      whitelist: true,
      serverPubkey: serverKp.publicKey,
    });
    await createGame(program, admin, config);

    // Attempt to init without server co-sign
    await expect(initPlayer(program, admin, gameId)).rejects.toThrow();
  });

  it("rejects whitelist player init with wrong server key", async () => {
    const gameId = nextGameId();
    const serverKp = Keypair.generate();
    const wrongServerKp = Keypair.generate();

    await airdrop(provider, wrongServerKp.publicKey, 1);

    const config = defaultGameConfig(gameId, {
      whitelist: true,
      serverPubkey: serverKp.publicKey,
    });
    await createGame(program, admin, config);

    // Attempt to init with wrong server key
    await expect(
      initPlayer(program, admin, gameId, wrongServerKp)
    ).rejects.toThrow();
  });

  it("verifies player PDA derivation matches", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const [expectedPDA] = derivePlayerPDA(
      gameId,
      admin.publicKey,
      program.programId
    );
    const playerPDA = await initPlayer(program, admin, gameId);

    expect(playerPDA.toString()).toBe(expectedPDA.toString());
  });
});
