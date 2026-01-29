/**
 * Instruction builder: move_ships
 *
 * Move ships (and optionally metal) from source planet to target planet.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  deriveGamePDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";

export interface MoveShipsArgs {
  gameId: bigint;
  sourceHash: Uint8Array;
  targetHash: Uint8Array;
  shipsToSend: bigint;
  metalToSend: bigint;
  sourceX: bigint;
  sourceY: bigint;
  targetX: bigint;
  targetY: bigint;
}

/**
 * Build a transaction builder for the move_ships instruction.
 * Call .rpc() or .transaction() on the result.
 */
export function buildMoveShipsIx(
  program: Program,
  playerOwner: PublicKey,
  args: MoveShipsArgs
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
  const [sourcePlanetPDA] = deriveCelestialBodyPDA(
    args.gameId,
    args.sourceHash,
    program.programId
  );
  const [sourcePendingPDA] = derivePendingMovesPDA(
    args.gameId,
    args.sourceHash,
    program.programId
  );
  const [targetPlanetPDA] = deriveCelestialBodyPDA(
    args.gameId,
    args.targetHash,
    program.programId
  );
  const [targetPendingPDA] = derivePendingMovesPDA(
    args.gameId,
    args.targetHash,
    program.programId
  );

  return program.methods
    .moveShips(
      new BN(args.gameId.toString()),
      Array.from(args.sourceHash) as any,
      Array.from(args.targetHash) as any,
      new BN(args.shipsToSend.toString()),
      new BN(args.metalToSend.toString()),
      new BN(args.sourceX.toString()),
      new BN(args.sourceY.toString()),
      new BN(args.targetX.toString()),
      new BN(args.targetY.toString())
    )
    .accounts({
      playerOwner,
      game: gamePDA,
      sourcePlanet: sourcePlanetPDA,
      sourcePending: sourcePendingPDA,
      targetPlanet: targetPlanetPDA,
      targetPending: targetPendingPDA,
    });
}
