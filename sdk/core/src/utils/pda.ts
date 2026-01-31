import { PublicKey } from "@solana/web3.js";
import idlJson from "../idl/encrypted_forest.json";

/**
 * Program ID derived from the IDL (matches declare_id! in lib.rs).
 */
export const PROGRAM_ID = new PublicKey(idlJson.address);

// ---------------------------------------------------------------------------
// Helper: encode a u64/bigint as 8 little-endian bytes
// ---------------------------------------------------------------------------

function u64ToLeBytes(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, value, true);
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// PDA Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the Game PDA.
 * Seeds: ["game", game_id.to_le_bytes()]
 */
export function deriveGamePDA(
  gameId: bigint,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("game"), u64ToLeBytes(gameId)],
    programId
  );
}

/**
 * Derive the Player PDA.
 * Seeds: ["player", game_id.to_le_bytes(), player_pubkey.to_bytes()]
 */
export function derivePlayerPDA(
  gameId: bigint,
  playerPubkey: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player"), u64ToLeBytes(gameId), playerPubkey.toBuffer()],
    programId
  );
}

/**
 * Derive the CelestialBody (planet) PDA.
 * Seeds: ["planet", game_id.to_le_bytes(), planet_hash(32 bytes)]
 */
export function deriveCelestialBodyPDA(
  gameId: bigint,
  planetHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("planet"), u64ToLeBytes(gameId), planetHash],
    programId
  );
}

/**
 * Derive the PendingMoves PDA.
 * Seeds: ["moves", game_id.to_le_bytes(), planet_hash(32 bytes)]
 */
export function derivePendingMovesPDA(
  gameId: bigint,
  planetHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("moves"), u64ToLeBytes(gameId), planetHash],
    programId
  );
}

/**
 * Derive a PendingMoveAccount PDA.
 * Seeds: ["move", game_id.to_le_bytes(), planet_hash(32 bytes), move_id.to_le_bytes()]
 */
export function derivePendingMoveAccountPDA(
  gameId: bigint,
  planetHash: Uint8Array,
  moveId: bigint,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("move"),
      u64ToLeBytes(gameId),
      planetHash,
      u64ToLeBytes(moveId),
    ],
    programId
  );
}
