/**
 * PendingMovesMetadata account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type {
  PendingMovesMetadata,
  PendingMoveEntry,
} from "../types/pendingMoves.js";
import { derivePendingMovesPDA } from "../utils/pda.js";

/**
 * Convert Anchor's deserialized PendingMoveEntry to our SDK type.
 */
function convertPendingMoveEntry(raw: any): PendingMoveEntry {
  return {
    landingSlot: BigInt(raw.landingSlot.toString()),
    moveId: BigInt(raw.moveId.toString()),
  };
}

/**
 * Convert Anchor's deserialized PendingMovesMetadata account to our SDK type.
 */
function convertPendingMovesMetadata(raw: any): PendingMovesMetadata {
  return {
    gameId: BigInt(raw.gameId.toString()),
    planetHash: new Uint8Array(raw.planetHash),
    nextMoveId: BigInt(raw.nextMoveId.toString()),
    moveCount: raw.moveCount,
    queuedCount: raw.queuedCount,
    queuedLandingSlots: (raw.queuedLandingSlots as any[]).map(
      (s: any) => BigInt(s.toString())
    ),
    moves: (raw.moves as any[]).map(convertPendingMoveEntry),
  };
}

/**
 * Fetch and deserialize a PendingMovesMetadata account by PDA.
 */
export async function fetchPendingMovesMetadata(
  program: Program,
  gameId: bigint,
  planetHash: Uint8Array,
  programId?: PublicKey
): Promise<PendingMovesMetadata> {
  const [pda] = derivePendingMovesPDA(
    gameId,
    planetHash,
    programId ?? program.programId
  );
  const raw = await (program.account as any).pendingMovesMetadata.fetch(pda);
  return convertPendingMovesMetadata(raw);
}

/**
 * Fetch a PendingMovesMetadata account by a known address.
 */
export async function fetchPendingMovesMetadataByAddress(
  program: Program,
  address: PublicKey
): Promise<PendingMovesMetadata> {
  const raw = await (program.account as any).pendingMovesMetadata.fetch(
    address
  );
  return convertPendingMovesMetadata(raw);
}
