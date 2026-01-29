/**
 * Instruction builder: init_player
 *
 * Creates a Player account for a game.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { deriveGamePDA, derivePlayerPDA } from "../utils/pda.js";

/**
 * Build and return a transaction builder for the init_player instruction.
 * Call .rpc() or .transaction() on the result.
 */
export function buildInitPlayerIx(
  program: Program,
  owner: PublicKey,
  gameId: bigint,
  server?: PublicKey
) {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(gameId, owner, program.programId);

  const accounts: any = {
    owner,
    game: gamePDA,
    player: playerPDA,
    systemProgram: SystemProgram.programId,
  };

  if (server) {
    accounts.server = server;
  }

  return program.methods
    .initPlayer(new BN(gameId.toString()))
    .accounts(accounts);
}
