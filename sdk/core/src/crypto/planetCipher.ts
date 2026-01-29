/**
 * Deterministic planet cipher using x25519 key exchange.
 *
 * planet_hash = blake3(x, y, game_id) is used as an x25519 private key.
 * The shared secret with the MXE's public key gives the cipher key.
 * Clients who know (x, y) can decrypt planet state locally without any transaction.
 *
 * NOTE: Actual RescueCipher encryption/decryption requires @arcium-hq/client.
 * The placeholders below read raw little-endian u64 from ciphertext bytes,
 * which only works with the placeholder encryptFieldElement.
 * When @arcium-hq/client is integrated, replace encrypt/decrypt bodies
 * with the real RescueCipher calls.
 */

import { x25519 } from "@noble/curves/ed25519.js";

// ---------------------------------------------------------------------------
// Decrypted state interfaces
// ---------------------------------------------------------------------------

/** Decrypted planet state -- the 19 fields in order. */
export interface PlanetState {
  bodyType: number;
  size: number;
  ownerExists: number;
  owner0: bigint;
  owner1: bigint;
  owner2: bigint;
  owner3: bigint;
  shipCount: bigint;
  maxShipCapacity: bigint;
  shipGenSpeed: bigint;
  metalCount: bigint;
  maxMetalCapacity: bigint;
  metalGenSpeed: bigint;
  range: bigint;
  launchVelocity: bigint;
  level: number;
  cometCount: number;
  comet0: number;
  comet1: number;
}

/** Decrypted pending move data -- the 6 fields in order. */
export interface PendingMoveData {
  shipsArriving: bigint;
  metalArriving: bigint;
  attacker0: bigint;
  attacker1: bigint;
  attacker2: bigint;
  attacker3: bigint;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive x25519 public key from planet_hash (used as private key).
 */
export function derivePlanetPublicKey(planetHash: Uint8Array): Uint8Array {
  return x25519.getPublicKey(planetHash);
}

/**
 * Compute x25519 shared secret between planet_hash and MXE public key.
 */
export function computeSharedSecret(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array
): Uint8Array {
  return x25519.getSharedSecret(planetHash, mxePublicKey);
}

// ---------------------------------------------------------------------------
// Encryption / Decryption primitives
// ---------------------------------------------------------------------------

/**
 * Encrypt a single field element using the planet cipher.
 *
 * NOTE: Actual RescueCipher encryption requires @arcium-hq/client.
 * This placeholder stores the value in LE bytes padded to 32 bytes.
 */
export function encryptFieldElement(
  value: bigint,
  _sharedSecret: Uint8Array,
  _nonce: Uint8Array
): Uint8Array {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setBigUint64(0, value, true);
  return new Uint8Array(buf);
}

/**
 * Decrypt a single ciphertext using the planet cipher.
 *
 * NOTE: Actual RescueCipher decryption requires @arcium-hq/client.
 * This placeholder reads the LE u64 at offset 0.
 */
export function decryptFieldElement(
  ciphertext: Uint8Array,
  _sharedSecret: Uint8Array,
  _nonce: Uint8Array
): bigint {
  const view = new DataView(
    ciphertext.buffer,
    ciphertext.byteOffset,
    ciphertext.byteLength
  );
  return view.getBigUint64(0, true);
}

// ---------------------------------------------------------------------------
// High-level decrypt helpers
// ---------------------------------------------------------------------------

/**
 * Decrypt all 19 PlanetState fields from encrypted ciphertexts.
 */
export function decryptPlanetState(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  nonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetState {
  if (ciphertexts.length < 19) {
    throw new Error(
      `Expected 19 ciphertexts for PlanetState, got ${ciphertexts.length}`
    );
  }

  const sharedSecret = computeSharedSecret(planetHash, mxePublicKey);

  const decryptField = (index: number): bigint =>
    decryptFieldElement(ciphertexts[index], sharedSecret, nonce);

  return {
    bodyType: Number(decryptField(0)),
    size: Number(decryptField(1)),
    ownerExists: Number(decryptField(2)),
    owner0: decryptField(3),
    owner1: decryptField(4),
    owner2: decryptField(5),
    owner3: decryptField(6),
    shipCount: decryptField(7),
    maxShipCapacity: decryptField(8),
    shipGenSpeed: decryptField(9),
    metalCount: decryptField(10),
    maxMetalCapacity: decryptField(11),
    metalGenSpeed: decryptField(12),
    range: decryptField(13),
    launchVelocity: decryptField(14),
    level: Number(decryptField(15)),
    cometCount: Number(decryptField(16)),
    comet0: Number(decryptField(17)),
    comet1: Number(decryptField(18)),
  };
}

/**
 * Decrypt pending move data (6 fields).
 */
export function decryptPendingMoveData(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  nonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PendingMoveData {
  if (ciphertexts.length < 6) {
    throw new Error(
      `Expected 6 ciphertexts for PendingMoveData, got ${ciphertexts.length}`
    );
  }

  const sharedSecret = computeSharedSecret(planetHash, mxePublicKey);

  const decryptField = (index: number): bigint =>
    decryptFieldElement(ciphertexts[index], sharedSecret, nonce);

  return {
    shipsArriving: decryptField(0),
    metalArriving: decryptField(1),
    attacker0: decryptField(2),
    attacker1: decryptField(3),
    attacker2: decryptField(4),
    attacker3: decryptField(5),
  };
}

// ---------------------------------------------------------------------------
// Pubkey <-> u64 parts conversion
// ---------------------------------------------------------------------------

/**
 * Reconstruct a 32-byte public key from 4 little-endian u64 parts.
 */
export function pubkeyFromParts(
  p0: bigint,
  p1: bigint,
  p2: bigint,
  p3: bigint
): Uint8Array {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setBigUint64(0, p0, true);
  view.setBigUint64(8, p1, true);
  view.setBigUint64(16, p2, true);
  view.setBigUint64(24, p3, true);
  return new Uint8Array(buf);
}

/**
 * Split a 32-byte public key into 4 little-endian u64 parts.
 */
export function pubkeyToParts(
  pubkey: Uint8Array
): [bigint, bigint, bigint, bigint] {
  const view = new DataView(
    pubkey.buffer,
    pubkey.byteOffset,
    pubkey.byteLength
  );
  return [
    view.getBigUint64(0, true),
    view.getBigUint64(8, true),
    view.getBigUint64(16, true),
    view.getBigUint64(24, true),
  ];
}
