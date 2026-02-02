/**
 * Instruction builder: queue_process_move
 *
 * Queues an Arcium process_move computation to send ships from a source
 * planet to a target planet.
 *
 * Planet state and move input are passed inline as ciphertexts.
 *
 * Encrypted input: Enc<Shared, ProcessMoveInputPacked> = 2 ciphertexts (Pack<[u32;8]>):
 *   Packed fields: player_id, source_planet_id, ships_to_send, metal_to_send,
 *   source_x, source_y, target_x, target_y (coords biased by 2^31)
 *
 * Plaintext params (computed on-chain from lazy generation):
 *   current_ships, current_metal, current_slot, game_speed
 *
 * landing_slot is a public parameter validated by the circuit.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { deriveGamePDA } from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueProcessMoveArgs {
  gameId: bigint;
  computationOffset: bigint;
  /** Public landing slot (validated by MPC) */
  landingSlot: bigint;
  /** Client-computed current ship count (lazy generation from on-chain state) */
  currentShips: bigint;
  /** Client-computed current metal count (lazy generation from on-chain state) */
  currentMetal: bigint;
  /** 2 ciphertexts packed as Vec<u8> (2 * 32 = 64 bytes) — Pack<[u32;8]> */
  moveCts: Uint8Array;
  /** x25519 pubkey for Enc<Shared, ProcessMoveInput> */
  movePubkey: Uint8Array;
  /** Nonce for the move encryption (u128) */
  moveNonce: bigint;
  /** Source celestial body account address */
  sourceBody: PublicKey;
  /** Source planet's pending moves metadata (read-only, for flush check) */
  sourcePending: PublicKey;
  /** Target planet's pending moves metadata (mut, for adding move entry) */
  targetPending: PublicKey;
  /** PendingMoveAccount PDA (init'd here, populated by callback) */
  moveAccount: PublicKey;
}

/**
 * Build a transaction builder for the queue_process_move instruction.
 */
export function buildQueueProcessMoveIx(
  program: Program,
  payer: PublicKey,
  args: QueueProcessMoveArgs,
  arciumAccounts: ArciumAccounts
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);

  return program.methods
    .queueProcessMove(
      new BN(args.computationOffset.toString()),
      new BN(args.landingSlot.toString()),
      new BN(args.currentShips.toString()),
      new BN(args.currentMetal.toString()),
      Buffer.from(args.moveCts),
      Array.from(args.movePubkey) as any,
      new BN(args.moveNonce.toString())
    )
    .accounts({
      payer,
      game: gamePDA,
      sourceBody: args.sourceBody,
      sourcePending: args.sourcePending,
      targetPending: args.targetPending,
      moveAccount: args.moveAccount,
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
