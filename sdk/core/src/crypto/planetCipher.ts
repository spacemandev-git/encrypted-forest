/**
 * Deterministic planet cipher using x25519 key exchange.
 *
 * planet_hash = blake3(x, y, game_id) is used as an x25519 private key.
 * The shared secret with the MXE's public key gives the cipher key.
 * Clients who know (x, y) can decrypt planet state locally without any transaction.
 *
 * The on-chain EncryptedCelestialBody stores TWO separate encryption sections:
 *   - Static (12 fields): body_type, size, max_ship_capacity, ship_gen_speed,
 *     max_metal_capacity, metal_gen_speed, range, launch_velocity,
 *     level, comet_count, comet_0, comet_1
 *   - Dynamic (4 fields): ship_count, metal_count, owner_exists, owner_id
 *
 * NOTE: Actual RescueCipher encryption/decryption requires @arcium-hq/client.
 * The placeholders below read raw little-endian u64 from ciphertext bytes,
 * which only works with the placeholder encryptFieldElement.
 */

import { x25519 } from "@noble/curves/ed25519.js";

// ---------------------------------------------------------------------------
// Decrypted state interfaces
// ---------------------------------------------------------------------------

/** Decrypted static planet properties -- the 12 fields in order. */
export interface PlanetStaticState {
  bodyType: number;
  size: number;
  maxShipCapacity: bigint;
  shipGenSpeed: bigint;
  maxMetalCapacity: bigint;
  metalGenSpeed: bigint;
  range: bigint;
  launchVelocity: bigint;
  level: number;
  cometCount: number;
  comet0: number;
  comet1: number;
}

/** Decrypted dynamic planet properties -- the 4 fields in order. */
export interface PlanetDynamicState {
  shipCount: bigint;
  metalCount: bigint;
  ownerExists: number;
  ownerId: bigint;
}

/** Combined decrypted planet state (convenience type). */
export interface PlanetState {
  static: PlanetStaticState;
  dynamic: PlanetDynamicState;
}

/** Decrypted pending move data -- the 4 fields in order. */
export interface PendingMoveData {
  shipsArriving: bigint;
  metalArriving: bigint;
  attackingPlanetId: bigint;
  attackingPlayerId: bigint;
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
 * Decrypt the 12 PlanetStatic fields from static encryption section.
 */
export function decryptPlanetStatic(
  planetHash: Uint8Array,
  encPubkey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetStaticState {
  if (ciphertexts.length < 12) {
    throw new Error(
      `Expected 12 ciphertexts for PlanetStatic, got ${ciphertexts.length}`
    );
  }

  const sharedSecret = computeSharedSecret(planetHash, encPubkey);

  const decryptField = (index: number): bigint =>
    decryptFieldElement(ciphertexts[index], sharedSecret, encNonce);

  return {
    bodyType: Number(decryptField(0)),
    size: Number(decryptField(1)),
    maxShipCapacity: decryptField(2),
    shipGenSpeed: decryptField(3),
    maxMetalCapacity: decryptField(4),
    metalGenSpeed: decryptField(5),
    range: decryptField(6),
    launchVelocity: decryptField(7),
    level: Number(decryptField(8)),
    cometCount: Number(decryptField(9)),
    comet0: Number(decryptField(10)),
    comet1: Number(decryptField(11)),
  };
}

/**
 * Decrypt the 4 PlanetDynamic fields from dynamic encryption section.
 */
export function decryptPlanetDynamic(
  planetHash: Uint8Array,
  encPubkey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetDynamicState {
  if (ciphertexts.length < 4) {
    throw new Error(
      `Expected 4 ciphertexts for PlanetDynamic, got ${ciphertexts.length}`
    );
  }

  const sharedSecret = computeSharedSecret(planetHash, encPubkey);

  const decryptField = (index: number): bigint =>
    decryptFieldElement(ciphertexts[index], sharedSecret, encNonce);

  return {
    shipCount: decryptField(0),
    metalCount: decryptField(1),
    ownerExists: Number(decryptField(2)),
    ownerId: decryptField(3),
  };
}

/**
 * Decrypt both static and dynamic sections from an EncryptedCelestialBodyAccount.
 */
export function decryptPlanetState(
  planetHash: Uint8Array,
  account: {
    staticEncPubkey: Uint8Array;
    staticEncNonce: Uint8Array;
    staticEncCiphertexts: Uint8Array[];
    dynamicEncPubkey: Uint8Array;
    dynamicEncNonce: Uint8Array;
    dynamicEncCiphertexts: Uint8Array[];
  }
): PlanetState {
  return {
    static: decryptPlanetStatic(
      planetHash,
      account.staticEncPubkey,
      account.staticEncNonce,
      account.staticEncCiphertexts
    ),
    dynamic: decryptPlanetDynamic(
      planetHash,
      account.dynamicEncPubkey,
      account.dynamicEncNonce,
      account.dynamicEncCiphertexts
    ),
  };
}

/**
 * Decrypt pending move data (4 fields).
 * PendingMoveData is Enc<Mxe, ...> so only MXE can decrypt in production.
 * This placeholder supports local testing with plaintext ciphertexts.
 */
export function decryptPendingMoveData(
  _planetHash: Uint8Array,
  _mxePublicKey: Uint8Array,
  nonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PendingMoveData {
  if (ciphertexts.length < 4) {
    throw new Error(
      `Expected 4 ciphertexts for PendingMoveData, got ${ciphertexts.length}`
    );
  }

  // NOTE: PendingMoveData is Enc<Mxe, ...> so clients cannot decrypt it.
  // This reads raw LE u64 for local testing only.
  const readU64 = (ct: Uint8Array): bigint => {
    const view = new DataView(ct.buffer, ct.byteOffset, ct.byteLength);
    return view.getBigUint64(0, true);
  };

  return {
    shipsArriving: readU64(ciphertexts[0]),
    metalArriving: readU64(ciphertexts[1]),
    attackingPlanetId: readU64(ciphertexts[2]),
    attackingPlayerId: readU64(ciphertexts[3]),
  };
}
