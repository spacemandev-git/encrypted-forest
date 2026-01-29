/**
 * EncryptedPendingMoves account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type {
  EncryptedPendingMoves,
  EncryptedPendingMove,
} from "../types/pendingMoves.js";
import { derivePendingMovesPDA } from "../utils/pda.js";

/**
 * Convert Anchor's deserialized EncryptedPendingMove to our SDK type.
 */
function convertEncryptedPendingMove(raw: any): EncryptedPendingMove {
  return {
    active: raw.active,
    landingSlot: BigInt(raw.landingSlot.toString()),
    encPubkey: new Uint8Array(raw.encPubkey),
    encNonce: new Uint8Array(raw.encNonce),
    encCiphertexts: (raw.encCiphertexts as any[]).map(
      (ct: any) => new Uint8Array(ct)
    ),
  };
}

/**
 * Convert Anchor's deserialized EncryptedPendingMoves account to our SDK type.
 */
function convertEncryptedPendingMoves(raw: any): EncryptedPendingMoves {
  return {
    gameId: BigInt(raw.gameId.toString()),
    planetHash: new Uint8Array(raw.planetHash),
    moveCount: raw.moveCount,
    moves: (raw.moves as any[]).map(convertEncryptedPendingMove),
  };
}

/**
 * Fetch and deserialize an EncryptedPendingMoves account by PDA.
 */
export async function fetchEncryptedPendingMoves(
  program: Program,
  gameId: bigint,
  planetHash: Uint8Array,
  programId?: PublicKey
): Promise<EncryptedPendingMoves> {
  const [pda] = derivePendingMovesPDA(
    gameId,
    planetHash,
    programId ?? program.programId
  );
  const raw = await (program.account as any).encryptedPendingMoves.fetch(pda);
  return convertEncryptedPendingMoves(raw);
}

/**
 * Fetch an EncryptedPendingMoves account by a known address.
 */
export async function fetchEncryptedPendingMovesByAddress(
  program: Program,
  address: PublicKey
): Promise<EncryptedPendingMoves> {
  const raw = await (program.account as any).encryptedPendingMoves.fetch(
    address
  );
  return convertEncryptedPendingMoves(raw);
}
