/**
 * Instruction builder: queue_flush_planet
 *
 * Queues an Arcium flush_planet computation to resolve a batch of up to 4
 * landed moves on a planet. The computation applies combat/reinforcement
 * sequentially and returns updated PlanetDynamic.
 *
 * Planet state (static + dynamic) is read by MPC nodes directly from
 * celestial_body via .account() -- NOT passed as ciphertexts.
 * Move data is read from PendingMoveAccount PDAs via remaining_accounts.
 *
 * Encrypted input: Enc<Shared, FlushTimingInput> = 4 ciphertexts:
 *   current_slot, game_speed, last_updated_slot, flush_count
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueFlushPlanetArgs {
  computationOffset: bigint;
  /** Number of moves to flush (1-4) */
  flushCount: number;
  /** 4 ciphertexts packed as Vec<u8> (4 * 32 = 128 bytes): FlushTimingInput */
  flushCts: Uint8Array;
  /** x25519 pubkey for Enc<Shared, FlushTimingInput> */
  flushPubkey: Uint8Array;
  /** Nonce for the flush encryption (u128) */
  flushNonce: bigint;
  /** Celestial body account address */
  celestialBody: PublicKey;
  /** Pending moves metadata account address */
  pendingMoves: PublicKey;
  /** PendingMoveAccount PDAs for the moves being flushed (remaining_accounts) */
  moveAccounts: PublicKey[];
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
      args.flushCount,
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
    })
    .remainingAccounts(
      args.moveAccounts.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    );
}
