/**
 * Game account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { Game, NoiseThresholds } from "../types/game.js";
import { deriveGamePDA } from "../utils/pda.js";

/**
 * Convert Anchor's deserialized Game account to our SDK type.
 */
function convertGame(raw: any): Game {
  let winCondition: Game["winCondition"];
  if (raw.winCondition.pointsBurning) {
    winCondition = {
      pointsBurning: {
        pointsPerMetal: BigInt(
          raw.winCondition.pointsBurning.pointsPerMetal.toString()
        ),
      },
    };
  } else {
    winCondition = {
      raceToCenter: {
        minSpawnDistance: BigInt(
          raw.winCondition.raceToCenter.minSpawnDistance.toString()
        ),
      },
    };
  }

  return {
    admin: raw.admin,
    gameId: BigInt(raw.gameId.toString()),
    mapDiameter: BigInt(raw.mapDiameter.toString()),
    gameSpeed: BigInt(raw.gameSpeed.toString()),
    startSlot: BigInt(raw.startSlot.toString()),
    endSlot: BigInt(raw.endSlot.toString()),
    winCondition,
    whitelist: raw.whitelist,
    serverPubkey: raw.serverPubkey ?? null,
    noiseThresholds: raw.noiseThresholds as NoiseThresholds,
    hashRounds: raw.hashRounds ?? 100,
  };
}

/**
 * Fetch and deserialize a Game account by its PDA.
 */
export async function fetchGame(
  program: Program,
  gameId: bigint,
  programId?: PublicKey
): Promise<Game> {
  const [gamePDA] = deriveGamePDA(gameId, programId ?? program.programId);
  const raw = await (program.account as any).game.fetch(gamePDA);
  return convertGame(raw);
}

/**
 * Fetch a Game account by a known address.
 */
export async function fetchGameByAddress(
  program: Program,
  address: PublicKey
): Promise<Game> {
  const raw = await (program.account as any).game.fetch(address);
  return convertGame(raw);
}
