import { PublicKey } from "@solana/web3.js";

/**
 * A single pending move (ships in transit to a planet).
 * Matches on-chain `PendingMove` struct.
 */
export interface PendingMove {
  sourcePlanetHash: Uint8Array;
  shipsSent: bigint;
  metalSent: bigint;
  landingSlot: bigint;
  attacker: PublicKey;
}

/**
 * Pending moves account state.
 * Matches on-chain `PendingMoves` account struct.
 * PDA: ["moves", game_id.to_le_bytes(), planet_hash]
 */
export interface PendingMoves {
  gameId: bigint;
  planetHash: Uint8Array;
  moves: PendingMove[];
}

/**
 * Maximum number of pending moves per planet (on-chain constant).
 */
export const MAX_PENDING_MOVES = 32;
