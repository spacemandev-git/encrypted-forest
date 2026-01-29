import { PublicKey } from "@solana/web3.js";

/**
 * Player account state.
 * Matches on-chain `Player` account struct.
 * PDA: ["player", game_id.to_le_bytes(), player_pubkey.to_bytes()]
 */
export interface Player {
  owner: PublicKey;
  gameId: bigint;
  points: bigint;
  hasSpawned: boolean;
}
