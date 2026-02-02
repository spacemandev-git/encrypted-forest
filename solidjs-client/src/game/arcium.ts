/**
 * Browser-safe Arcium helpers for the SolidJS client.
 *
 * Ported from tests/helpers.ts with the following adaptations:
 * - getArciumEnv() throws in browser, so cluster offset is hardcoded to 0 for local dev
 * - crypto.randomBytes replaced with crypto.getRandomValues (Web Crypto API)
 * - All PDA derivation fns from @arcium-hq/client are pure JS and work in browser
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getMXEPublicKey,
  getArciumProgramId,
  RescueCipher,
  x25519,
  deserializeLE,
} from "@arcium-hq/client";
import type { ArciumAccounts } from "@encrypted-forest/core";
import { AnchorProvider } from "@coral-xyz/anchor";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hardcoded cluster offset for local dev (getArciumEnv() throws in browser).
 * For devnet/mainnet this would need to come from config.
 */
const ARCIUM_CLUSTER_OFFSET = 0;

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

export function getSignPdaAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    programId
  )[0];
}

function getPoolAccountAddress(): PublicKey {
  try {
    const { getFeePoolAccAddress } = require("@arcium-hq/client");
    return getFeePoolAccAddress();
  } catch {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("FeePool")],
      getArciumProgramId()
    )[0];
  }
}

function getClockAccountAddress(): PublicKey {
  try {
    const { getClockAccAddress } = require("@arcium-hq/client");
    return getClockAccAddress();
  } catch {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ClockAccount")],
      getArciumProgramId()
    )[0];
  }
}

/**
 * Get all Arcium account addresses needed for queue_* instructions.
 * Uses hardcoded cluster offset instead of getArciumEnv() for browser compat.
 */
export function getArciumAccountAddresses(
  programId: PublicKey,
  computationOffset: BN,
  compDefName: string
): ArciumAccounts {
  const clusterOffset = ARCIUM_CLUSTER_OFFSET;
  const offsetBytes = getCompDefAccOffset(compDefName);
  const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();

  return {
    signPdaAccount: getSignPdaAddress(programId),
    mxeAccount: getMXEAccAddress(programId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
    compDefAccount: getCompDefAccAddress(programId, offsetU32),
    clusterAccount: getClusterAccAddress(clusterOffset),
    poolAccount: getPoolAccountAddress(),
    clockAccount: getClockAccountAddress(),
    arciumProgram: getArciumProgramId(),
  };
}

// ---------------------------------------------------------------------------
// Browser-safe random helpers
// ---------------------------------------------------------------------------

/** Generate 16 random bytes using Web Crypto API. */
function browserRandomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

/** Generate a random nonce (16 bytes) and return as bigint via deserializeLE. */
export function generateNonce(): { nonce: Uint8Array; nonceValue: bigint } {
  const nonce = browserRandomBytes(16);
  const nonceValue = deserializeLE(nonce);
  return { nonce, nonceValue };
}

/** Generate a random computation offset (8 bytes) as BN. */
export function generateComputationOffset(): BN {
  const bytes = browserRandomBytes(8);
  // Convert to hex string for BN
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return new BN(hex, "hex");
}

// ---------------------------------------------------------------------------
// Encryption setup
// ---------------------------------------------------------------------------

export interface EncryptionContext {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  cipher: RescueCipher;
}

/**
 * Get MXE public key with retries (MXE may not be ready immediately).
 */
async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

/**
 * Set up encryption context with the MXE. Browser-safe version.
 */
export async function setupEncryption(
  connection: Connection,
  programId: PublicKey
): Promise<EncryptionContext> {
  // Create a read-only provider for fetching MXE public key
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (t: any) => t,
      signAllTransactions: async (t: any) => t,
    } as any,
    { commitment: "confirmed" }
  );

  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programId);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  return { privateKey, publicKey, mxePublicKey, sharedSecret, cipher };
}

// ---------------------------------------------------------------------------
// Encrypt and pack
// ---------------------------------------------------------------------------

/**
 * Encrypt values and pack into a single buffer.
 */
export function encryptAndPack(
  cipher: RescueCipher,
  values: bigint[],
  nonce: Uint8Array
): { packed: Uint8Array; ciphertexts: number[][] } {
  const ciphertexts = cipher.encrypt(values, nonce);
  const packed = new Uint8Array(ciphertexts.length * 32);
  for (let i = 0; i < ciphertexts.length; i++) {
    packed.set(new Uint8Array(ciphertexts[i]), i * 32);
  }
  return { packed, ciphertexts };
}

// ---------------------------------------------------------------------------
// Value builders for MPC circuits
// ---------------------------------------------------------------------------

export function buildInitSpawnPlanetValues(
  x: bigint,
  y: bigint,
  playerId: bigint,
  sourcePlanetId: bigint
): bigint[] {
  return [
    BigInt.asUintN(64, x),
    BigInt.asUintN(64, y),
    BigInt.asUintN(32, playerId),
    BigInt.asUintN(32, sourcePlanetId),
  ];
}

export function buildProcessMoveValues(
  playerId: bigint,
  sourcePlanetId: bigint,
  shipsToSend: bigint,
  metalToSend: bigint,
  sourceX: bigint,
  sourceY: bigint,
  targetX: bigint,
  targetY: bigint
): bigint[] {
  return [
    BigInt.asUintN(32, playerId),
    BigInt.asUintN(32, sourcePlanetId),
    BigInt.asUintN(32, shipsToSend),
    BigInt.asUintN(32, metalToSend),
    BigInt.asUintN(64, sourceX),
    BigInt.asUintN(64, sourceY),
    BigInt.asUintN(64, targetX),
    BigInt.asUintN(64, targetY),
  ];
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { x25519, RescueCipher, deserializeLE };
