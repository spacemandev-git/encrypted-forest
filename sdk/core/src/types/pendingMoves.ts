/**
 * Encrypted pending moves -- matches on-chain structs.
 */

/**
 * A single encrypted pending move.
 * Matches on-chain `EncryptedPendingMove` struct.
 */
export interface EncryptedPendingMove {
  active: boolean;
  landingSlot: bigint;
  encPubkey: Uint8Array; // [u8; 32]
  encNonce: Uint8Array; // [u8; 16]
  encCiphertexts: Uint8Array[]; // 6 x [u8; 32]
}

/**
 * Encrypted pending moves account state.
 * Matches on-chain `EncryptedPendingMoves` account struct.
 * PDA: ["moves", game_id.to_le_bytes(), planet_hash]
 */
export interface EncryptedPendingMoves {
  gameId: bigint;
  planetHash: Uint8Array; // [u8; 32]
  moveCount: number;
  moves: EncryptedPendingMove[];
}

/**
 * Maximum number of pending moves per planet (on-chain constant).
 */
export const MAX_PENDING_MOVES = 16;
