/**
 * Planet cipher using RescueCipher + Arcium Pack<[u32;15]> for decryption.
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
 */

import { RescueCipher, x25519, createPacker } from "@arcium-hq/client";

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
// Packer for Pack<[u32;15]>
// ---------------------------------------------------------------------------

const PLANET_STATE_FIELDS = Array.from({ length: 15 }, (_, i) => ({
  name: `[${i}]` as const,
  type: { Integer: { signed: false as const, width: 32 as const } },
}));

const planetStatePacker = createPacker(PLANET_STATE_FIELDS as any, "[u32;15]");

// ---------------------------------------------------------------------------
// Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Create a RescueCipher for a planet given its hash and the MXE public key.
 */
export function createPlanetCipher(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array
): RescueCipher {
  const sharedSecret = x25519.getSharedSecret(planetHash, mxePublicKey);
  return new RescueCipher(sharedSecret);
}

/**
 * Encrypt values for a planet (used when building queue instructions).
 */
export function encryptForPlanet(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  values: bigint[],
  nonce: Uint8Array
): { ciphertexts: number[][]; publicKey: Uint8Array } {
  const cipher = createPlanetCipher(planetHash, mxePublicKey);
  const publicKey = x25519.getPublicKey(planetHash);
  const ciphertexts = cipher.encrypt(values, nonce);
  return { ciphertexts, publicKey };
}

// ---------------------------------------------------------------------------
// High-level decrypt helpers
// ---------------------------------------------------------------------------

/**
 * Decrypt the packed planet state FEs and extract 15 u32 values.
 */
function decryptAndUnpackState(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): bigint[] {
  if (ciphertexts.length < 3) {
    throw new Error(
      `Expected 3 ciphertexts for PlanetState, got ${ciphertexts.length}`
    );
  }

  const cipher = createPlanetCipher(planetHash, mxePublicKey);

  // Convert Uint8Array[] to number[][] for RescueCipher.decrypt()
  const cts: number[][] = ciphertexts.slice(0, 3).map((ct) => Array.from(ct));

  // Decrypt: returns field elements as bigint[]
  const decryptedFEs = cipher.decrypt(cts, encNonce);

  // Unpack: converts field elements to u32 values
  const unpacked = planetStatePacker.unpack(decryptedFEs) as Record<string, bigint>;

  // Extract values in order [0]..[14]
  const values: bigint[] = [];
  for (let i = 0; i < 15; i++) {
    values.push(unpacked[`[${i}]`]);
  }
  return values;
}

/**
 * Decrypt the PlanetStatic packed fields from the state encryption section.
 * 3 FEs -> unpack to 11 u32 values.
 */
export function decryptPlanetStatic(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetStaticState {
  const values = decryptAndUnpackState(planetHash, mxePublicKey, encNonce, ciphertexts);
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
 * Decrypt the PlanetDynamic packed fields from the state encryption section.
 * 3 FEs -> unpack to 4 u32 values.
 */
export function decryptPlanetDynamic(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  encNonce: Uint8Array,
  ciphertexts: Uint8Array[]
): PlanetDynamicState {
  const values = decryptAndUnpackState(planetHash, mxePublicKey, encNonce, ciphertexts);
  return {
    shipCount: values[11],
    metalCount: values[12],
    ownerExists: Number(values[13]),
    ownerId: values[14],
  };
}

/**
 * Decrypt the full planet state from an EncryptedCelestialBodyAccount.
 *
 * @param planetHash - blake3(x, y, gameId) used as x25519 private key
 * @param mxePublicKey - MXE cluster's x25519 public key
 * @param account - On-chain encrypted celestial body data
 */
export function decryptPlanetState(
  planetHash: Uint8Array,
  mxePublicKey: Uint8Array,
  account: {
    stateEncPubkey: Uint8Array;
    stateEncNonce: Uint8Array;
    stateEncCiphertexts: Uint8Array[];
  }
): PlanetState {
  const values = decryptAndUnpackState(
    planetHash,
    mxePublicKey,
    account.stateEncNonce,
    account.stateEncCiphertexts
  );

  return {
    static: {
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
    },
    dynamic: {
      shipCount: values[11],
      metalCount: values[12],
      ownerExists: Number(values[13]),
      ownerId: values[14],
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
