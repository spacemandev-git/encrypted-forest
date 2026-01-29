/**
 * PendingMoves account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { PendingMoves, PendingMove } from "../types/pendingMoves.js";
import { derivePendingMovesPDA } from "../utils/pda.js";

/**
 * Convert Anchor's deserialized PendingMove to our SDK type.
 */
function convertPendingMove(raw: any): PendingMove {
  return {
    sourcePlanetHash: new Uint8Array(raw.sourcePlanetHash),
    shipsSent: BigInt(raw.shipsSent.toString()),
    metalSent: BigInt(raw.metalSent.toString()),
    landingSlot: BigInt(raw.landingSlot.toString()),
    attacker: raw.attacker,
  };
}

/**
 * Convert Anchor's deserialized PendingMoves account to our SDK type.
 */
function convertPendingMoves(raw: any): PendingMoves {
  return {
    gameId: BigInt(raw.gameId.toString()),
    planetHash: new Uint8Array(raw.planetHash),
    moves: (raw.moves as any[]).map(convertPendingMove),
  };
}

/**
 * Fetch and deserialize a PendingMoves account by PDA.
 */
export async function fetchPendingMoves(
  program: Program,
  gameId: bigint,
  planetHash: Uint8Array,
  programId?: PublicKey
): Promise<PendingMoves> {
  const [pda] = derivePendingMovesPDA(
    gameId,
    planetHash,
    programId ?? program.programId
  );
  const raw = await (program.account as any).pendingMoves.fetch(pda);
  return convertPendingMoves(raw);
}

/**
 * Fetch a PendingMoves account by a known address.
 */
export async function fetchPendingMovesByAddress(
  program: Program,
  address: PublicKey
): Promise<PendingMoves> {
  const raw = await (program.account as any).pendingMoves.fetch(address);
  return convertPendingMoves(raw);
}
