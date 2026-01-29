/**
 * Instruction builder: queue_flush_planet
 *
 * Queues an Arcium flush_planet computation to resolve the first pending
 * move on a planet. The computation applies combat or reinforcement,
 * updates the planet state, and removes the move from the queue.
 *
 * state_cts (19 * 32 = 608 bytes): Current encrypted planet state.
 * flush_cts (10 * 32 = 320 bytes):
 *   0: current_slot (u64), 1: game_speed (u64),
 *   2: last_updated_slot (u64),
 *   3: move_ships (u64), 4: move_metal (u64),
 *   5-8: move_attacker_0..3 (u64 x4),
 *   9: move_has_landed (u8)
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueFlushPlanetArgs {
  computationOffset: bigint;
  /** Index of the pending move to flush (typically 0) */
  moveIndex: number;
  /** Planet encrypted state (19 * 32 bytes) */
  stateCts: Uint8Array;
  /** x25519 pubkey used to encrypt the state ciphertexts */
  statePubkey: Uint8Array;
  /** Nonce used for the state ciphertexts (u128) */
  stateNonce: bigint;
  /** Flush input ciphertexts (10 * 32 bytes) */
  flushCts: Uint8Array;
  /** x25519 pubkey used to encrypt the flush ciphertexts */
  flushPubkey: Uint8Array;
  /** Nonce used for the flush ciphertexts (u128) */
  flushNonce: bigint;
  /** Celestial body account address */
  celestialBody: PublicKey;
  /** Pending moves account address */
  pendingMoves: PublicKey;
}

/**
 * Build a transaction builder for the queue_flush_planet instruction.
 */
export function buildQueueFlushPlanetIx(
  program: Program,
  payer: PublicKey,
  args: QueueFlushPlanetArgs,
  arciumAccounts: ArciumAccounts
) {
  return program.methods
    .queueFlushPlanet(
      new BN(args.computationOffset.toString()),
      args.moveIndex,
      Buffer.from(args.stateCts),
      Array.from(args.statePubkey) as any,
      new BN(args.stateNonce.toString()),
      Buffer.from(args.flushCts),
      Array.from(args.flushPubkey) as any,
      new BN(args.flushNonce.toString())
    )
    .accounts({
      payer,
      celestialBody: args.celestialBody,
      pendingMoves: args.pendingMoves,
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
