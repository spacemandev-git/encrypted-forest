/**
 * Instruction builders: cleanup_game, cleanup_player, cleanup_planet
 *
 * Close game-related accounts after the game has ended to reclaim rent.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";

/**
 * Build a transaction builder for the cleanup_game instruction.
 */
export function buildCleanupGameIx(
  program: Program,
  closer: PublicKey,
  gameId: bigint
) {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);

  return program.methods.cleanupGame(new BN(gameId.toString())).accounts({
    closer,
    game: gamePDA,
  });
}

/**
 * Build a transaction builder for the cleanup_player instruction.
 */
export function buildCleanupPlayerIx(
  program: Program,
  closer: PublicKey,
  gameId: bigint,
  playerOwner: PublicKey
) {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(gameId, playerOwner, program.programId);

  return program.methods.cleanupPlayer(new BN(gameId.toString())).accounts({
    closer,
    game: gamePDA,
    player: playerPDA,
  });
}

/**
 * Build a transaction builder for the cleanup_planet instruction.
 */
export function buildCleanupPlanetIx(
  program: Program,
  closer: PublicKey,
  gameId: bigint,
  planetHash: Uint8Array
) {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [planetPDA] = deriveCelestialBodyPDA(
    gameId,
    planetHash,
    program.programId
  );
  const [pendingMovesPDA] = derivePendingMovesPDA(
    gameId,
    planetHash,
    program.programId
  );

  return program.methods
    .cleanupPlanet(
      new BN(gameId.toString()),
      Array.from(planetHash) as any
    )
    .accounts({
      closer,
      game: gamePDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
    });
}
