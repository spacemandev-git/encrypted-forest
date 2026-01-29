/**
 * Pending moves types -- matches on-chain structs.
 */

/**
 * Entry in the sorted moves array.
 * Matches on-chain `PendingMoveEntry`.
 */
export interface PendingMoveEntry {
  landingSlot: bigint;
  moveId: bigint;
}

/**
 * PendingMovesMetadata account state.
 * Matches on-chain `PendingMovesMetadata` account struct.
 * PDA: ["moves", game_id.to_le_bytes(), planet_hash]
 */
export interface PendingMovesMetadata {
  gameId: bigint;
  planetHash: Uint8Array; // [u8; 32]
  nextMoveId: bigint;
  moveCount: number; // u16
  queuedCount: number; // u8
  queuedLandingSlots: bigint[]; // [u64; 8]
  moves: PendingMoveEntry[];
}

/**
 * Individual PendingMoveAccount (one per in-flight move).
 * Matches on-chain `PendingMoveAccount`.
 * PDA: ["move", game_id.to_le_bytes(), planet_hash, move_id.to_le_bytes()]
 * Contains Enc<Mxe, PendingMoveData> (4 ciphertexts: ships, metal, attacking_planet_id, attacking_player_id).
 */
export interface PendingMoveAccount {
  gameId: bigint;
  planetHash: Uint8Array; // [u8; 32]
  moveId: bigint;
  landingSlot: bigint;
  payer: Uint8Array; // [u8; 32] (Pubkey)
  encNonce: bigint; // u128
  encCiphertexts: Uint8Array[]; // 4 x [u8; 32]
}

/** Number of encrypted fields in PendingMoveData. */
export const PENDING_MOVE_DATA_FIELDS = 4;

/** Maximum number of moves flushed in a single batch. */
export const MAX_FLUSH_BATCH = 8;

/** Maximum number of queued callbacks. */
export const MAX_QUEUED_CALLBACKS = 8;
