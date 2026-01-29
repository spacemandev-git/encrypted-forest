/**
 * Instruction builder: upgrade
 *
 * Upgrade a Planet-type celestial body. Spends metal to level up.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { UpgradeFocus } from "../types/celestialBody.js";
import {
  deriveGamePDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";

export interface UpgradeArgs {
  gameId: bigint;
  planetHash: Uint8Array;
  focus: UpgradeFocus;
}

/**
 * Build a transaction builder for the upgrade instruction.
 * Call .rpc() or .transaction() on the result.
 */
export function buildUpgradeIx(
  program: Program,
  playerOwner: PublicKey,
  args: UpgradeArgs
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
  const [planetPDA] = deriveCelestialBodyPDA(
    args.gameId,
    args.planetHash,
    program.programId
  );
  const [pendingMovesPDA] = derivePendingMovesPDA(
    args.gameId,
    args.planetHash,
    program.programId
  );

  // Convert UpgradeFocus enum to Anchor format
  const anchorFocus =
    args.focus === UpgradeFocus.Range
      ? { range: {} }
      : { launchVelocity: {} };

  return program.methods
    .upgrade(
      new BN(args.gameId.toString()),
      Array.from(args.planetHash) as any,
      anchorFocus
    )
    .accounts({
      playerOwner,
      game: gamePDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
    });
}
