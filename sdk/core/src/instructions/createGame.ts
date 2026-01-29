/**
 * Instruction builder: create_game
 *
 * Creates a new game instance. Permissionless.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { NoiseThresholds, WinCondition } from "../types/game.js";
import { deriveGamePDA } from "../utils/pda.js";

export interface CreateGameArgs {
  gameId: bigint;
  mapDiameter: bigint;
  gameSpeed: bigint;
  startSlot: bigint;
  endSlot: bigint;
  winCondition: WinCondition;
  whitelist: boolean;
  serverPubkey: PublicKey | null;
  noiseThresholds: NoiseThresholds;
  hashRounds: number;
}

/**
 * Build and return a transaction builder for the create_game instruction.
 * Call .rpc() or .transaction() on the result.
 */
export function buildCreateGameIx(
  program: Program,
  admin: PublicKey,
  args: CreateGameArgs
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);

  // Convert WinCondition to Anchor format
  let anchorWinCondition: any;
  if ("pointsBurning" in args.winCondition) {
    anchorWinCondition = {
      pointsBurning: {
        pointsPerMetal: new BN(
          args.winCondition.pointsBurning.pointsPerMetal.toString()
        ),
      },
    };
  } else {
    anchorWinCondition = {
      raceToCenter: {
        minSpawnDistance: new BN(
          args.winCondition.raceToCenter.minSpawnDistance.toString()
        ),
      },
    };
  }

  return program.methods
    .createGame(
      new BN(args.gameId.toString()),
      new BN(args.mapDiameter.toString()),
      new BN(args.gameSpeed.toString()),
      new BN(args.startSlot.toString()),
      new BN(args.endSlot.toString()),
      anchorWinCondition,
      args.whitelist,
      args.serverPubkey,
      args.noiseThresholds,
      args.hashRounds
    )
    .accounts({
      admin,
      game: gamePDA,
      systemProgram: SystemProgram.programId,
    });
}
