/**
 * Player account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { Player } from "../types/player.js";
import { derivePlayerPDA } from "../utils/pda.js";

/**
 * Convert Anchor's deserialized Player account to our SDK type.
 */
function convertPlayer(raw: any): Player {
  return {
    owner: raw.owner,
    gameId: BigInt(raw.gameId.toString()),
    points: BigInt(raw.points.toString()),
    hasSpawned: raw.hasSpawned,
  };
}

/**
 * Fetch and deserialize a Player account by PDA.
 */
export async function fetchPlayer(
  program: Program,
  gameId: bigint,
  playerPubkey: PublicKey,
  programId?: PublicKey
): Promise<Player> {
  const [playerPDA] = derivePlayerPDA(
    gameId,
    playerPubkey,
    programId ?? program.programId
  );
  const raw = await (program.account as any).player.fetch(playerPDA);
  return convertPlayer(raw);
}

/**
 * Fetch a Player account by a known address.
 */
export async function fetchPlayerByAddress(
  program: Program,
  address: PublicKey
): Promise<Player> {
  const raw = await (program.account as any).player.fetch(address);
  return convertPlayer(raw);
}
