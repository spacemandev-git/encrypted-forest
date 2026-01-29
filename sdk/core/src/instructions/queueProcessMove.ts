/**
 * Instruction builder: queue_process_move
 *
 * Queues an Arcium process_move computation to send ships from a source
 * planet to a target planet. The computation validates ownership,
 * deducts ships/metal from source, and creates a pending move on target.
 *
 * state_cts (19 * 32 = 608 bytes): Current encrypted planet state of the source.
 * move_cts (13 * 32 = 416 bytes):
 *   0-3: player_key parts (u64 x4)
 *   4: ships_to_send (u64), 5: metal_to_send (u64),
 *   6: source_x (u64), 7: source_y (u64),
 *   8: target_x (u64), 9: target_y (u64),
 *   10: current_slot (u64), 11: game_speed (u64),
 *   12: last_updated_slot (u64)
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { deriveGamePDA } from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueProcessMoveArgs {
  gameId: bigint;
  computationOffset: bigint;
  /** Source planet encrypted state (19 * 32 bytes) */
  stateCts: Uint8Array;
  /** x25519 pubkey used to encrypt the state ciphertexts */
  statePubkey: Uint8Array;
  /** Nonce used for the state ciphertexts (u128) */
  stateNonce: bigint;
  /** Move input ciphertexts (13 * 32 bytes) */
  moveCts: Uint8Array;
  /** x25519 pubkey used to encrypt the move ciphertexts */
  movePubkey: Uint8Array;
  /** Nonce used for the move ciphertexts (u128) */
  moveNonce: bigint;
  /** Observer x25519 public key */
  observerPubkey: Uint8Array;
  /** Source celestial body account address */
  sourceBody: PublicKey;
  /** Target pending moves account address */
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
      Buffer.from(args.stateCts),
      Array.from(args.statePubkey) as any,
      new BN(args.stateNonce.toString()),
      Buffer.from(args.moveCts),
      Array.from(args.movePubkey) as any,
      new BN(args.moveNonce.toString()),
      Array.from(args.observerPubkey) as any
    )
    .accounts({
      payer,
      game: gamePDA,
      sourceBody: args.sourceBody,
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
