/**
 * Instruction builder: queue_process_move
 *
 * Queues an Arcium process_move computation to send ships from a source
 * planet to a target planet.
 *
 * Planet state (static + dynamic) is read by MPC nodes directly from the
 * source_body account via .account() -- NOT passed as ciphertexts.
 *
 * Encrypted input: Enc<Shared, ProcessMoveInput> = 11 ciphertexts:
 *   player_id, source_planet_id, ships_to_send, metal_to_send,
 *   source_x, source_y, target_x, target_y,
 *   current_slot, game_speed, last_updated_slot
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
  /** 11 ciphertexts packed as Vec<u8> (11 * 32 = 352 bytes) */
  moveCts: Uint8Array;
  /** x25519 pubkey for Enc<Shared, ProcessMoveInput> */
  movePubkey: Uint8Array;
  /** Nonce for the move encryption (u128) */
  moveNonce: bigint;
  /** Observer x25519 public key */
  observerPubkey: Uint8Array;
  /** Source celestial body account address */
  sourceBody: PublicKey;
  /** Source planet's pending moves metadata (read-only, for flush check) */
  sourcePending: PublicKey;
  /** Target planet's pending moves metadata (mut, for adding move entry) */
  targetPending: PublicKey;
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
      Buffer.from(args.moveCts),
      Array.from(args.movePubkey) as any,
      new BN(args.moveNonce.toString()),
      Array.from(args.observerPubkey) as any
    )
    .accounts({
      payer,
      game: gamePDA,
      sourceBody: args.sourceBody,
      sourcePending: args.sourcePending,
      targetPending: args.targetPending,
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
