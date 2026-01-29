/**
 * EncryptedCelestialBody account fetching and deserialization.
 */

import { type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { EncryptedCelestialBodyAccount } from "../types/celestialBody.js";
import { deriveCelestialBodyPDA } from "../utils/pda.js";

/**
 * Convert Anchor's deserialized EncryptedCelestialBody to our SDK type.
 */
function convertEncryptedCelestialBody(raw: any): EncryptedCelestialBodyAccount {
  return {
    planetHash: new Uint8Array(raw.planetHash),
    lastUpdatedSlot: BigInt(raw.lastUpdatedSlot.toString()),
    lastFlushedSlot: BigInt(raw.lastFlushedSlot.toString()),
    // Static encryption section
    staticEncPubkey: new Uint8Array(raw.staticEncPubkey),
    staticEncNonce: new Uint8Array(raw.staticEncNonce),
    staticEncCiphertexts: (raw.staticEncCiphertexts as any[]).map(
      (ct: any) => new Uint8Array(ct)
    ),
    // Dynamic encryption section
    dynamicEncPubkey: new Uint8Array(raw.dynamicEncPubkey),
    dynamicEncNonce: new Uint8Array(raw.dynamicEncNonce),
    dynamicEncCiphertexts: (raw.dynamicEncCiphertexts as any[]).map(
      (ct: any) => new Uint8Array(ct)
    ),
  };
}

/**
 * Fetch and deserialize an EncryptedCelestialBody account by PDA.
 */
export async function fetchEncryptedCelestialBody(
  program: Program,
  gameId: bigint,
  planetHash: Uint8Array,
  programId?: PublicKey
): Promise<EncryptedCelestialBodyAccount> {
  const [pda] = deriveCelestialBodyPDA(
    gameId,
    planetHash,
    programId ?? program.programId
  );
  const raw = await (program.account as any).encryptedCelestialBody.fetch(pda);
  return convertEncryptedCelestialBody(raw);
}

/**
 * Fetch an EncryptedCelestialBody account by a known address.
 */
export async function fetchEncryptedCelestialBodyByAddress(
  program: Program,
  address: PublicKey
): Promise<EncryptedCelestialBodyAccount> {
  const raw = await (program.account as any).encryptedCelestialBody.fetch(
    address
  );
  return convertEncryptedCelestialBody(raw);
}
