/**
 * Instruction builder: queue_init_spawn_planet
 *
 * Queues an Arcium init_spawn_planet computation to initialize a planet
 * and claim it as the player's spawn point. Creates the
 * EncryptedCelestialBody and EncryptedPendingMoves accounts, and marks
 * the player as spawned on callback.
 *
 * Ciphertexts (16 * 32 bytes packed):
 *   0: x (u64), 1: y (u64), 2: game_id (u64),
 *   3: dead_space_threshold (u8), 4: planet_threshold (u8),
 *   5: quasar_threshold (u8), 6: spacetime_rip_threshold (u8),
 *   7: size_threshold_1 (u8), 8: size_threshold_2 (u8),
 *   9: size_threshold_3 (u8), 10: size_threshold_4 (u8),
 *   11: size_threshold_5 (u8),
 *   12: player_key_0 (u64), 13: player_key_1 (u64),
 *   14: player_key_2 (u64), 15: player_key_3 (u64)
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueInitSpawnPlanetArgs {
  gameId: bigint;
  computationOffset: bigint;
  planetHash: Uint8Array;
  /** 16 ciphertexts packed as a single Vec<u8> (16 * 32 = 512 bytes) */
  ciphertexts: Uint8Array;
  /** x25519 public key for encryption */
  pubkey: Uint8Array;
  /** Nonce for encryption (u128) */
  nonce: bigint;
  /** Observer x25519 public key */
  observerPubkey: Uint8Array;
}

/**
 * Build a transaction builder for the queue_init_spawn_planet instruction.
 */
export function buildQueueInitSpawnPlanetIx(
  program: Program,
  payer: PublicKey,
  args: QueueInitSpawnPlanetArgs,
  arciumAccounts: ArciumAccounts
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(args.gameId, payer, program.programId);
  const [celestialBodyPDA] = deriveCelestialBodyPDA(
    args.gameId,
    args.planetHash,
    program.programId
  );
  const [pendingMovesPDA] = derivePendingMovesPDA(
    args.gameId,
    args.planetHash,
    program.programId
  );

  return program.methods
    .queueInitSpawnPlanet(
      new BN(args.computationOffset.toString()),
      Array.from(args.planetHash) as any,
      Buffer.from(args.ciphertexts),
      Array.from(args.pubkey) as any,
      new BN(args.nonce.toString()),
      Array.from(args.observerPubkey) as any
    )
    .accounts({
      payer,
      game: gamePDA,
      player: playerPDA,
      celestialBody: celestialBodyPDA,
      pendingMoves: pendingMovesPDA,
      signPdaAccount: arciumAccounts.signPdaAccount,
      mxeAccount: arciumAccounts.mxeAccount,
      mempoolAccount: arciumAccounts.mempoolAccount,
      executingPool: arciumAccounts.executingPool,
      computationAccount: arciumAccounts.computationAccount,
      compDefAccount: arciumAccounts.compDefAccount,
      clusterAccount: arciumAccounts.clusterAccount,
      poolAccount: arciumAccounts.poolAccount,
      clockAccount: arciumAccounts.clockAccount,
      systemProgram: SystemProgram.programId,
      arciumProgram: arciumAccounts.arciumProgram,
    });
}
