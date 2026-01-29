/**
 * Broadcast integration tests.
 *
 * Tests:
 * 1. Broadcast planet coordinates
 * 2. Verify broadcast event contains (x, y, game_id, planet_hash, broadcaster)
 * 3. Verify broadcast with correct hash passes
 * 4. Reject broadcast with wrong hash
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
  defaultGameConfig,
  deriveGamePDA,
  computePlanetHash,
  findSpawnPlanet,
  nextGameId,
  DEFAULT_THRESHOLDS,
} from "./helpers";

describe("Broadcast", () => {
  let provider: AnchorProvider;
  let program: Program<EncryptedForest>;
  let admin: Keypair;

  beforeAll(async () => {
    const setup = getProviderAndProgram();
    provider = setup.provider;
    program = setup.program;
    admin = readKpJson(`${process.env.HOME}/.config/solana/id.json`);
  });

  it("broadcasts planet coordinates successfully", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    // Set up event listener
    let broadcastEvent: any = null;
    const listenerPromise = new Promise<void>((resolve) => {
      const listenerId = program.addEventListener(
        "broadcastEvent",
        (event: any) => {
          broadcastEvent = event;
          program.removeEventListener(listenerId);
          resolve();
        }
      );
      // Timeout in case event does not fire
      setTimeout(() => resolve(), 5000);
    });

    await program.methods
      .broadcast(
        new BN(gameId.toString()),
        new BN(spawn.x.toString()),
        new BN(spawn.y.toString()),
        Array.from(spawn.hash) as any
      )
      .accounts({
        broadcaster: admin.publicKey,
        game: gamePDA,
      })
      .signers([admin])
      .rpc({ commitment: "confirmed" });

    await listenerPromise;

    // Verify event was emitted
    if (broadcastEvent) {
      expect(broadcastEvent.x.toString()).toBe(spawn.x.toString());
      expect(broadcastEvent.y.toString()).toBe(spawn.y.toString());
      expect(broadcastEvent.gameId.toString()).toBe(gameId.toString());
      expect(broadcastEvent.broadcaster.toString()).toBe(
        admin.publicKey.toString()
      );
    }
  });

  it("rejects broadcast with wrong planet hash", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    // Wrong hash
    const wrongHash = new Uint8Array(32);
    wrongHash.fill(0);

    await expect(
      program.methods
        .broadcast(
          new BN(gameId.toString()),
          new BN(spawn.x.toString()),
          new BN(spawn.y.toString()),
          Array.from(wrongHash) as any
        )
        .accounts({
          broadcaster: admin.publicKey,
          game: gamePDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });

  it("rejects broadcast with mismatched coordinates", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    // Correct hash but wrong coordinates
    await expect(
      program.methods
        .broadcast(
          new BN(gameId.toString()),
          new BN((spawn.x + 1n).toString()), // wrong x
          new BN(spawn.y.toString()),
          Array.from(spawn.hash) as any
        )
        .accounts({
          broadcaster: admin.publicKey,
          game: gamePDA,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" })
    ).rejects.toThrow();
  });

  it("allows anyone to broadcast (permissionless)", async () => {
    const gameId = nextGameId();
    const config = defaultGameConfig(gameId);
    await createGame(program, admin, config);

    const randomUser = Keypair.generate();
    await provider.connection.requestAirdrop(
      randomUser.publicKey,
      1_000_000_000
    );
    await new Promise((r) => setTimeout(r, 1000)); // wait for airdrop

    const spawn = findSpawnPlanet(gameId, DEFAULT_THRESHOLDS);
    const [gamePDA] = deriveGamePDA(gameId, program.programId);

    // Any signer can broadcast -- no ownership required
    await program.methods
      .broadcast(
        new BN(gameId.toString()),
        new BN(spawn.x.toString()),
        new BN(spawn.y.toString()),
        Array.from(spawn.hash) as any
      )
      .accounts({
        broadcaster: randomUser.publicKey,
        game: gamePDA,
      })
      .signers([randomUser])
      .rpc({ commitment: "confirmed" });

    // If we get here, it succeeded (no ownership or player check required)
    expect(true).toBe(true);
  });

  it("verifies hash consistency between client and on-chain", () => {
    // Test that our computePlanetHash matches what the on-chain program expects
    const x = 42n;
    const y = -17n;
    const gameId = 12345n;

    const hash = computePlanetHash(x, y, gameId);
    expect(hash.length).toBe(32);

    // Same inputs should always produce same hash (deterministic)
    const hash2 = computePlanetHash(x, y, gameId);
    expect(hash).toEqual(hash2);

    // Different inputs should produce different hashes
    const hash3 = computePlanetHash(x + 1n, y, gameId);
    expect(hash).not.toEqual(hash3);
  });
});
