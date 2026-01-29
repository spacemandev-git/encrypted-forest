/**
 * Instruction builder: broadcast
 *
 * Broadcast planet coordinates publicly so all players can discover it.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { deriveGamePDA } from "../utils/pda.js";

export interface BroadcastArgs {
  gameId: bigint;
  x: bigint;
  y: bigint;
  planetHash: Uint8Array;
}

/**
 * Build a transaction builder for the broadcast instruction.
 * Call .rpc() or .transaction() on the result.
 */
export function buildBroadcastIx(
  program: Program,
  broadcaster: PublicKey,
  args: BroadcastArgs
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);

  return program.methods
    .broadcast(
      new BN(args.gameId.toString()),
      new BN(args.x.toString()),
      new BN(args.y.toString()),
      Array.from(args.planetHash) as any
    )
    .accounts({
      broadcaster,
      game: gamePDA,
    });
}
