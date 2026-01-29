/**
 * Account cleanup integration tests.
 *
 * Tests:
 * 1. Reject game cleanup before game ends
 * 2. Reject player cleanup before game ends
 * 3. Reject planet cleanup before game ends
 * 4. Successful cleanup after game ends (requires game end_slot in the past)
 *
 * NOTE: Cleanup tests that should succeed require the game's end_slot to be in the past.
 * Since we are running against a local validator, we create games with very low end_slots
 * and wait for slots to advance past them.
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
  findSpawnPlanet,
  nextGameId,
  DEFAULT_THRESHOLDS,
} from "./helpers";

describe("Cleanup - Rejection Before Game End", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("rejects game cleanup before game ends", async () => {
    const gameId = nextGameId();
    // Game with end_slot far in the future
    const config = defaultGameConfig(gameId, {
      endSlot: new BN(1_000_000_000),
    });
    await createGame(program, admin, config);

    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    await expect(
      program.methods
        .cleanupGame(new BN(gameId.toString()))
        .accounts({
          closer: admin.publicKey,
          game: gamePDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });

  it("rejects player cleanup before game ends", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      endSlot: new BN(1_000_000_000),
    });
    await createGame(program, admin, config);
    await initPlayer(program, admin, gameId);

    const [gamePDA] = deriveGamePDA(gameId, program.programId);
    const [playerPDA] = derivePlayerPDA(
      gameId,
      admin.publicKey,
      program.programId
    );

    await expect(
      program.methods
        .cleanupPlayer(new BN(gameId.toString()))
        .accounts({
          closer: admin.publicKey,
          game: gamePDA,
          player: playerPDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });

  it("rejects planet cleanup before game ends", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      endSlot: new BN(1_000_000_000),
    });
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

    const [gamePDA] = deriveGamePDA(gameId, program.programId);
    const [planetPDA] = derivePlanetPDA(
      gameId,
      spawn.hash,
      program.programId
    );
    const [pendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn.hash,
      program.programId
    );

    await expect(
      program.methods
        .cleanupPlanet(
          new BN(gameId.toString()),
          Array.from(spawn.hash) as any
        )
        .accounts({
          closer: admin.publicKey,
          game: gamePDA,
          celestialBody: planetPDA,
          pendingMoves: pendingPDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });
});

describe("Cleanup - Success After Game End", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("cleans up game account after game ends", async () => {
    const gameId = nextGameId();

    // Get current slot and create a game that already ended
    const currentSlot = await provider.connection.getSlot("confirmed");

    const config = defaultGameConfig(gameId, {
      startSlot: new BN(0),
      endSlot: new BN(1), // ends at slot 1, which is definitely in the past
    });
    await createGame(program, admin, config);

    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    // Should succeed since current slot > end_slot (1)
    await program.methods
      .cleanupGame(new BN(gameId.toString()))
      .accounts({
        closer: admin.publicKey,
        game: gamePDA,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    // Account should be closed
    const info = await provider.connection.getAccountInfo(gamePDA);
    expect(info).toBeNull();
  });

  it("cleans up player account after game ends", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      startSlot: new BN(0),
      endSlot: new BN(1),
    });
    await createGame(program, admin, config);
    await initPlayer(program, admin, gameId);

    const [gamePDA] = deriveGamePDA(gameId, program.programId);
    const [playerPDA] = derivePlayerPDA(
      gameId,
      admin.publicKey,
      program.programId
    );

    await program.methods
      .cleanupPlayer(new BN(gameId.toString()))
      .accounts({
        closer: admin.publicKey,
        game: gamePDA,
        player: playerPDA,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    const info = await provider.connection.getAccountInfo(playerPDA);
    expect(info).toBeNull();
  });

  it("cleans up planet account after game ends", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      startSlot: new BN(0),
      endSlot: new BN(1),
    });
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

    const [gamePDA] = deriveGamePDA(gameId, program.programId);
    const [planetPDA] = derivePlanetPDA(
      gameId,
      spawn.hash,
      program.programId
    );
    const [pendingPDA] = derivePendingMovesPDA(
      gameId,
      spawn.hash,
      program.programId
    );

    await program.methods
      .cleanupPlanet(
        new BN(gameId.toString()),
        Array.from(spawn.hash) as any
      )
      .accounts({
        closer: admin.publicKey,
        game: gamePDA,
        celestialBody: planetPDA,
        pendingMoves: pendingPDA,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    const planetInfo = await provider.connection.getAccountInfo(planetPDA);
    expect(planetInfo).toBeNull();

    const pendingInfo = await provider.connection.getAccountInfo(pendingPDA);
    expect(pendingInfo).toBeNull();
  });

  it("allows anyone to cleanup (permissionless)", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId, {
      startSlot: new BN(0),
      endSlot: new BN(1),
    });
    await createGame(program, admin, config);

    const randomUser = Keypair.generate();
    await airdrop(provider, randomUser.publicKey, 1);

    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    // Anyone can close, rent goes to closer
    await program.methods
      .cleanupGame(new BN(gameId.toString()))
      .accounts({
        closer: randomUser.publicKey,
        game: gamePDA,
      })
      .signers([randomUser])
      .rpc({ commitment: "confirmed" });

    const info = await provider.connection.getAccountInfo(gamePDA);
    expect(info).toBeNull();
  });
});
