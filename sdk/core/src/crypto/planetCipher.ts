/**
 * Deterministic planet cipher using x25519 key exchange.
 *
 * planet_hash = blake3(x, y, game_id) is used as an x25519 private key.
 * The shared secret with the MXE's public key gives the cipher key.
 * Clients who know (x, y) can decrypt planet state locally without any transaction.
 *
 * The on-chain EncryptedCelestialBody stores a single encryption section:
 *   - State (3 packed FEs): Pack<[u32;15]> containing body_type, size,
 *     max_ship_capacity, ship_gen_speed, max_metal_capacity, metal_gen_speed,
 *     range, launch_velocity, level, comet_0, comet_1, ship_count,
 *     metal_count, owner_exists, owner_id
 *
 * NOTE: Actual RescueCipher encryption/decryption requires @arcium-hq/client.
 * The placeholders below read raw little-endian u64 from ciphertext bytes,
 * which only works with the placeholder encryptFieldElement.
 */

import { x25519 } from "@noble/curves/ed25519.js";

// ---------------------------------------------------------------------------
// Decrypted state interfaces
// ---------------------------------------------------------------------------

/** Decrypted static planet properties -- 11 u32 values packed into 3 FEs. */
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
 * Unpack u32 values from packed field elements.
 * Each FE holds ~26 bytes (208 usable bits). u32 values are packed as 4-byte LE chunks.
 * This is a placeholder that reads from the raw ciphertext bytes directly.
 *
 * NOTE: In production with actual RescueCipher, the generated packers from
 * @arcium-hq/client should be used instead. This placeholder reads LE u32s
 * sequentially from concatenated FE bytes.
 */
function unpackU32Array(ciphertexts: Uint8Array[], count: number): number[] {
  // Concatenate all ciphertext field elements into a single byte buffer
  const totalBytes = ciphertexts.length * 32;
  const buf = new Uint8Array(totalBytes);
  for (let i = 0; i < ciphertexts.length; i++) {
    buf.set(ciphertexts[i], i * 32);
  }
  // Read `count` u32 values as LE from the buffer
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(view.getUint32(i * 4, true));
  }
  return values;
}

function unpackPlanetState(ciphertexts: Uint8Array[]): number[] {
  if (ciphertexts.length < 3) {
    throw new Error(
      `Expected 3 ciphertexts for PlanetState, got ${ciphertexts.length}`
    );
  }

  const feBlobs = ciphertexts.slice(0, 3);
  return unpackU32Array(feBlobs, 15);
}

/**
 * Decrypt the PlanetStatic packed fields from the state encryption section.
 * 3 FEs -> unpack to 11 u32 values.
 */
export function decryptPlanetStatic(
  planetHash: Uint8Array,
  encPubkey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetStaticState {
  const values = unpackPlanetState(ciphertexts);

  return {
    bodyType: values[0],
    size: values[1],
    maxShipCapacity: BigInt(values[2]),
    shipGenSpeed: BigInt(values[3]),
    maxMetalCapacity: BigInt(values[4]),
    metalGenSpeed: BigInt(values[5]),
    range: BigInt(values[6]),
    launchVelocity: BigInt(values[7]),
    level: values[8],
    comet0: values[9],
    comet1: values[10],
  };
}

/**
 * Decrypt the PlanetDynamic packed fields from the state encryption section.
 * 3 FEs -> unpack to 4 u32 values.
 */
export function decryptPlanetDynamic(
  planetHash: Uint8Array,
  encPubkey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetDynamicState {
  const values = unpackPlanetState(ciphertexts);

  return {
    shipCount: BigInt(values[11]),
    metalCount: BigInt(values[12]),
    ownerExists: values[13],
    ownerId: BigInt(values[14]),
  };
}

/**
 * Decrypt the full planet state from an EncryptedCelestialBodyAccount.
 */
export function decryptPlanetState(
  planetHash: Uint8Array,
  account: {
    stateEncPubkey: Uint8Array;
    stateEncNonce: Uint8Array;
    stateEncCiphertexts: Uint8Array[];
  }
): PlanetState {
  const values = unpackPlanetState(account.stateEncCiphertexts);

  return {
    static: {
      bodyType: values[0],
      size: values[1],
      maxShipCapacity: BigInt(values[2]),
      shipGenSpeed: BigInt(values[3]),
      maxMetalCapacity: BigInt(values[4]),
      metalGenSpeed: BigInt(values[5]),
      range: BigInt(values[6]),
      launchVelocity: BigInt(values[7]),
      level: values[8],
      comet0: values[9],
      comet1: values[10],
    },
    dynamic: {
      shipCount: BigInt(values[11]),
      metalCount: BigInt(values[12]),
      ownerExists: values[13],
      ownerId: BigInt(values[14]),
    },
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
  // This reads raw LE u32 for local testing only.
  const readU32 = (ct: Uint8Array): bigint => {
    const view = new DataView(ct.buffer, ct.byteOffset, ct.byteLength);
    return BigInt(view.getUint32(0, true));
  };

  return {
    shipsArriving: readU32(ciphertexts[0]),
    metalArriving: readU32(ciphertexts[1]),
    attackingPlanetId: readU32(ciphertexts[2]),
    attackingPlayerId: readU32(ciphertexts[3]),
  };
}
