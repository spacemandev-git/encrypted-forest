/**
 * Instruction builder: queue_init_planet
 *
 * Queues an Arcium init_planet computation to initialize a new planet
 * with encrypted state. Creates the EncryptedCelestialBody and
 * EncryptedPendingMoves accounts.
 *
 * Ciphertexts (12 * 32 bytes packed):
 *   0: x (u64), 1: y (u64), 2: game_id (u64),
 *   3: dead_space_threshold (u8), 4: planet_threshold (u8),
 *   5: quasar_threshold (u8), 6: spacetime_rip_threshold (u8),
 *   7: size_threshold_1 (u8), 8: size_threshold_2 (u8),
 *   9: size_threshold_3 (u8), 10: size_threshold_4 (u8),
 *   11: size_threshold_5 (u8)
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveGamePDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueInitPlanetArgs {
  gameId: bigint;
  computationOffset: bigint;
  planetHash: Uint8Array;
  /** 12 ciphertexts packed as a single Vec<u8> (12 * 32 = 384 bytes) */
  ciphertexts: Uint8Array;
  /** x25519 public key for encryption */
  pubkey: Uint8Array;
  /** Nonce for encryption (u128) */
  nonce: bigint;
  /** Observer x25519 public key */
  observerPubkey: Uint8Array;
}

/**
 * Build a transaction builder for the queue_init_planet instruction.
 */
export function buildQueueInitPlanetIx(
  program: Program,
  payer: PublicKey,
  args: QueueInitPlanetArgs,
  arciumAccounts: ArciumAccounts
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
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
    .queueInitPlanet(
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
