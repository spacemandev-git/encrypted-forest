/**
 * Deterministic planet cipher using x25519 key exchange.
 *
 * planet_hash = blake3(x, y, game_id) is used as an x25519 private key.
 * The shared secret with the MXE's public key gives the cipher key.
 * Clients who know (x, y) can decrypt planet state locally without any transaction.
 *
 * The on-chain EncryptedCelestialBody stores TWO separate encryption sections:
 *   - Static (4 packed FEs): Pack<[u64;11]> containing body_type, size,
 *     max_ship_capacity, ship_gen_speed, max_metal_capacity, metal_gen_speed,
 *     range, launch_velocity, level, comet_0, comet_1
 *   - Dynamic (2 packed FEs): Pack<[u64;4]> containing ship_count, metal_count,
 *     owner_exists, owner_id
 *
 * NOTE: Actual RescueCipher encryption/decryption requires @arcium-hq/client.
 * The placeholders below read raw little-endian u64 from ciphertext bytes,
 * which only works with the placeholder encryptFieldElement.
 */

import { x25519 } from "@noble/curves/ed25519.js";

// ---------------------------------------------------------------------------
// Decrypted state interfaces
// ---------------------------------------------------------------------------

/** Decrypted static planet properties -- 11 u64 values packed into 4 FEs. */
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
  comet0: number;  // 0=none, 1-6=CometBoost
  comet1: number;  // 0=none, 1-6=CometBoost
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
 * Unpack u64 values from packed field elements.
 * Each FE holds ~26 bytes (208 usable bits). u64 values are packed as 8-byte LE chunks.
 * This is a placeholder that reads from the raw ciphertext bytes directly.
 *
 * NOTE: In production with actual RescueCipher, the generated packers from
 * @arcium-hq/client should be used instead. This placeholder reads LE u64s
 * sequentially from concatenated FE bytes.
 */
function unpackU64Array(ciphertexts: Uint8Array[], count: number): bigint[] {
  // Concatenate all ciphertext field elements into a single byte buffer
  const totalBytes = ciphertexts.length * 32;
  const buf = new Uint8Array(totalBytes);
  for (let i = 0; i < ciphertexts.length; i++) {
    buf.set(ciphertexts[i], i * 32);
  }
  // Read `count` u64 values as LE from the buffer
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const values: bigint[] = [];
  for (let i = 0; i < count; i++) {
    values.push(view.getBigUint64(i * 8, true));
  }
  return values;
}

/**
 * Decrypt the PlanetStatic packed fields from static encryption section.
 * 4 FEs -> unpack to 11 u64 values.
 */
export function decryptPlanetStatic(
  planetHash: Uint8Array,
  encPubkey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetStaticState {
  if (ciphertexts.length < 4) {
    throw new Error(
      `Expected 4 ciphertexts for PlanetStatic, got ${ciphertexts.length}`
    );
  }

  const sharedSecret = computeSharedSecret(planetHash, encPubkey);

  // Decrypt each field element
  const decryptedFEs = ciphertexts.slice(0, 4).map((ct) =>
    decryptFieldElement(ct, sharedSecret, encNonce)
  );

  // For placeholder (non-RescueCipher): each FE is a raw LE u64,
  // but packed data stores multiple u64s per FE.
  // Reconstruct the 4 FE ciphertext blobs and unpack 11 u64s.
  const feBlobs = ciphertexts.slice(0, 4);
  const values = unpackU64Array(feBlobs, 11);

  return {
    bodyType: Number(values[0]),
    size: Number(values[1]),
    maxShipCapacity: values[2],
    shipGenSpeed: values[3],
    maxMetalCapacity: values[4],
    metalGenSpeed: values[5],
    range: values[6],
    launchVelocity: values[7],
    level: Number(values[8]),
    comet0: Number(values[9]),
    comet1: Number(values[10]),
  };
}

/**
 * Decrypt the PlanetDynamic packed fields from dynamic encryption section.
 * 2 FEs -> unpack to 4 u64 values.
 */
export function decryptPlanetDynamic(
  planetHash: Uint8Array,
  encPubkey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetDynamicState {
  if (ciphertexts.length < 2) {
    throw new Error(
      `Expected 2 ciphertexts for PlanetDynamic, got ${ciphertexts.length}`
    );
  }

  const sharedSecret = computeSharedSecret(planetHash, encPubkey);

  const feBlobs = ciphertexts.slice(0, 2);
  const values = unpackU64Array(feBlobs, 4);

  return {
    shipCount: values[0],
    metalCount: values[1],
    ownerExists: Number(values[2]),
    ownerId: values[3],
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
