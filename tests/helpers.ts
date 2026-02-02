/**
 * Shared test utilities for Encrypted Forest integration tests.
 *
 * Imports all types, enums, constants, and pure functions from @encrypted-forest/core SDK.
 * Only test-specific infrastructure (Anchor setup, airdrop, Arcium wrappers, encryption)
 * is defined here. This ensures changes only need to happen in the SDK.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as web3 from "@solana/web3.js";
import { readFileSync } from "fs";
import {
  getArciumEnv,
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getMXEPublicKey,
  getArciumProgramId,
  getLookupTableAddress,
  RescueCipher,
  x25519,
  deserializeLE,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import type { EncryptedForest } from "../target/types/encrypted_forest";

let anchorSendCompatPatched = false;

class ConfirmError extends Error {}

function isVersionedTransaction(tx: any): boolean {
  return typeof tx?.version !== "undefined";
}

async function sendAndConfirmRawTransactionCompat(
  connection: Connection,
  rawTransaction: Buffer,
  options?: {
    skipPreflight?: boolean;
    preflightCommitment?: string;
    commitment?: string;
    maxRetries?: number;
    minContextSlot?: number;
    blockhash?: any;
  }
): Promise<string> {
  const sendOptions = options
    ? {
        skipPreflight: options.skipPreflight,
        preflightCommitment: options.preflightCommitment || options.commitment,
        maxRetries: options.maxRetries,
        minContextSlot: options.minContextSlot,
      }
    : {};
  let status;
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    try {
      const signature = await connection.sendRawTransaction(
        rawTransaction,
        sendOptions
      );
      if (options?.blockhash) {
        if (sendOptions.maxRetries === 0) {
          const abortSignal = AbortSignal.timeout(15000);
          status = (
            await connection.confirmTransaction(
              { abortSignal, signature, ...options.blockhash },
              options && options.commitment
            )
          ).value;
        } else {
          status = (
            await connection.confirmTransaction(
              { signature, ...options.blockhash },
              options && options.commitment
            )
          ).value;
        }
      } else {
        status = (
          await connection.confirmTransaction(
            signature,
            options && options.commitment
          )
        ).value;
      }
      if (status.err) {
        throw new ConfirmError(
          `Raw transaction ${signature} failed (${JSON.stringify(status)})`
        );
      }
      return signature;
    } catch (err: any) {
      if (err?.name === "TimeoutError") {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Transaction failed to confirm in 60s");
}

function patchAnchorSendAndConfirm(): void {
  if (anchorSendCompatPatched) return;
  anchorSendCompatPatched = true;

  AnchorProvider.prototype.sendAndConfirm = async function (
    tx: any,
    signers?: any,
    opts?: any
  ): Promise<string> {
    if (opts === undefined) {
      opts = this.opts;
    }
    if (isVersionedTransaction(tx)) {
      if (signers) {
        tx.sign(signers);
      }
    } else {
      tx.feePayer = tx.feePayer ?? this.wallet.publicKey;
      tx.recentBlockhash = (
        await this.connection.getLatestBlockhash(opts.preflightCommitment)
      ).blockhash;
      if (signers) {
        for (const signer of signers) {
          tx.partialSign(signer);
        }
      }
    }
    tx = await this.wallet.signTransaction(tx);
    const rawTx = tx.serialize();
    try {
      return await sendAndConfirmRawTransactionCompat(
        this.connection,
        rawTx,
        opts
      );
    } catch (err: any) {
      if (err instanceof ConfirmError) {
        const signatureMatch = /Raw transaction ([^ ]+) failed/.exec(
          err.message
        );
        const txSig = signatureMatch?.[1];
        if (!txSig) {
          throw err;
        }
        const maxVer = isVersionedTransaction(tx) ? 0 : undefined;
        const failedTx = await this.connection.getTransaction(txSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: maxVer,
        });
        if (!failedTx) {
          throw err;
        }
        const logs = failedTx.meta?.logMessages;
        if (!logs) {
          throw err;
        }
        throw new web3.SendTransactionError({
          action: "send",
          signature: txSig,
          transactionMessage: err.message,
          logs,
        });
      }
      throw err;
    }
  };

  AnchorProvider.prototype.sendAll = async function (
    txWithSigners: any,
    opts?: any
  ): Promise<string[]> {
    if (opts === undefined) {
      opts = this.opts;
    }
    const recentBlockhash = (
      await this.connection.getLatestBlockhash(opts.preflightCommitment)
    ).blockhash;
    const txs = txWithSigners.map((r: any) => {
      if (isVersionedTransaction(r.tx)) {
        const tx = r.tx;
        if (r.signers) {
          tx.sign(r.signers);
        }
        return tx;
      }
      const tx = r.tx;
      const signerList = r.signers ?? [];
      tx.feePayer = tx.feePayer ?? this.wallet.publicKey;
      tx.recentBlockhash = recentBlockhash;
      signerList.forEach((kp: any) => {
        tx.partialSign(kp);
      });
      return tx;
    });
    const signedTxs = await this.wallet.signAllTransactions(txs);
    const sigs: string[] = [];
    for (let k = 0; k < txs.length; k += 1) {
      const tx = signedTxs[k];
      const rawTx = tx.serialize();
      try {
        sigs.push(
          await sendAndConfirmRawTransactionCompat(
            this.connection,
            rawTx,
            opts
          )
        );
      } catch (err: any) {
        if (err instanceof ConfirmError) {
          const signatureMatch = /Raw transaction ([^ ]+) failed/.exec(
            err.message
          );
          const txSig = signatureMatch?.[1];
          if (!txSig) {
            throw err;
          }
          const maxVer = isVersionedTransaction(tx) ? 0 : undefined;
          const failedTx = await this.connection.getTransaction(txSig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: maxVer,
          });
          if (!failedTx) {
            throw err;
          }
          const logs = failedTx.meta?.logMessages;
          if (!logs) {
            throw err;
          }
          throw new web3.SendTransactionError({
            action: "send",
            signature: txSig,
            transactionMessage: err.message,
            logs,
          });
        }
        throw err;
      }
    }
    return sigs;
  };
}

// ---------------------------------------------------------------------------
// Re-export everything from SDK so test files can import from ./helpers
// (avoids mass-updating every test file's import paths)
// ---------------------------------------------------------------------------

export {
  // Types
  type Game,
  type WinCondition,
  type WinConditionAnchor,
  type NoiseThresholds,
  type CelestialBody,
  type CelestialBodyProperties,
  type CelestialBodyStats,
  type EncryptedCelestialBodyAccount,
  type Player,
  type PendingMoveEntry,
  type PendingMovesMetadata,
  type PendingMoveAccount,
  type ScannedCoordinate,
  type InitPlanetEvent,
  type InitSpawnPlanetEvent,
  type ProcessMoveEvent,
  type FlushPlanetEvent,
  type UpgradePlanetEvent,
  type BroadcastEvent,
  type ArciumAccounts,
  type CreateGameArgs,
  type QueueInitPlanetArgs,
  type QueueInitSpawnPlanetArgs,
  type QueueProcessMoveArgs,
  type QueueFlushPlanetArgs,
  type QueueUpgradePlanetArgs,
  type BroadcastArgs,
  type PlanetStaticState,
  type PlanetDynamicState,
  type PlanetState,
  type PendingMoveData,
  type DiscoveredPlanet,

  // Enums
  CelestialBodyType,
  CometBoost,
  UpgradeFocus,

  // Constants
  DEFAULT_THRESHOLDS,
  DEFAULT_HASH_ROUNDS,
  PROGRAM_ID,
  PLANET_STATE_FIELDS,
  PENDING_MOVE_DATA_FIELDS,
  MAX_FLUSH_BATCH,
  MAX_QUEUED_CALLBACKS,

  // PDA derivation
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,

  // Noise / game mechanics
  computePlanetHash,
  computePropertyHash,
  mixHashBytes,
  determineCelestialBody,
  baseStats,
  applyCometBoosts,
  computeCurrentShips,
  computeCurrentMetal,
  computeDistance,
  applyDistanceDecay,
  computeLandingSlot,
  upgradeCost,
  scanCoordinate,
  scanRange,
  findSpawnPlanet,
  findPlanetOfType,

  // Crypto
  derivePlanetKeySeed,
  verifyPlanetHash,
  derivePlanetPublicKey,
  computeSharedSecret,
  createPlanetCipher,
  encryptForPlanet,
  decryptPlanetStatic,
  decryptPlanetDynamic,
  decryptPlanetState,
  decryptPendingMoveData,
  discoverCoordinate,
  discoverRange,
  revealPlanet,

  // Account fetching
  fetchGame,
  fetchGameByAddress,
  fetchPlayer,
  fetchPlayerByAddress,
  fetchEncryptedCelestialBody,
  fetchEncryptedCelestialBodyByAddress,
  fetchPendingMovesMetadata,
  fetchPendingMovesMetadataByAddress,

  // Instruction builders
  buildCreateGameIx,
  buildInitPlayerIx,
  buildQueueInitPlanetIx,
  buildQueueInitSpawnPlanetIx,
  buildQueueProcessMoveIx,
  buildQueueFlushPlanetIx,
  buildQueueUpgradePlanetIx,
  buildBroadcastIx,
  buildCleanupGameIx,
  buildCleanupPlayerIx,
  buildCleanupPlanetIx,

  // Subscriptions
  subscribeToGame,
  subscribeToPlayer,
  subscribeToCelestialBody,
  subscribeToPendingMoves,
  subscribeToMultiplePlanets,
  subscribeToGameLogs,
  subscribeToBroadcasts,
  subscribeToInitPlanetEvents,
  subscribeToProcessMoveEvents,
  subscribeToFlushPlanetEvents,
  subscribeToUpgradePlanetEvents,

  // Client
  EncryptedForestClient,

  // IDL
  idlJson,
} from "@encrypted-forest/core";

import {
  type NoiseThresholds,
  type ScannedCoordinate,
  CelestialBodyType,
  DEFAULT_THRESHOLDS,
  PROGRAM_ID,
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,
  computePlanetHash,
  determineCelestialBody,
  computeDistance,
  computeLandingSlot,
  buildCreateGameIx,
  buildInitPlayerIx,
} from "@encrypted-forest/core";

// ---------------------------------------------------------------------------
// Backward-compat aliases for renamed functions
// ---------------------------------------------------------------------------

/** Alias: SDK uses `deriveCelestialBodyPDA`, tests used `derivePlanetPDA` */
export const derivePlanetPDA = deriveCelestialBodyPDA;

// ---------------------------------------------------------------------------
// Default test configuration
// ---------------------------------------------------------------------------

export const DEFAULT_GAME_SPEED = new BN(1000);
export const DEFAULT_MAP_DIAMETER = new BN(1000);

// ---------------------------------------------------------------------------
// Anchor program + provider setup (test-specific)
// ---------------------------------------------------------------------------

import idlJsonLocal from "../target/idl/encrypted_forest.json";

const DEFAULT_RPC_URL = "http://localhost:8899";
const DEFAULT_WALLET_PATH = `${process.env.HOME}/.config/solana/id.json`;

export function getProviderAndProgram(): {
  provider: AnchorProvider;
  program: Program<EncryptedForest>;
} {
  patchAnchorSendAndConfirm();
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || DEFAULT_RPC_URL;
  const walletPath = process.env.ANCHOR_WALLET || DEFAULT_WALLET_PATH;

  const connection = new Connection(rpcUrl, "confirmed");
  const kpRaw = JSON.parse(readFileSync(walletPath, "utf-8"));
  const kp = Keypair.fromSecretKey(Uint8Array.from(kpRaw));
  const wallet = new Wallet(kp);

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  anchor.setProvider(provider);

  const program = new Program<EncryptedForest>(idlJsonLocal as any, provider);
  return { provider, program };
}

export function readKpJson(path: string): Keypair {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export async function airdrop(
  provider: AnchorProvider,
  pubkey: PublicKey,
  amount: number = 10
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    amount * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

// ---------------------------------------------------------------------------
// Game + Player shortcuts (use SDK instruction builders)
// ---------------------------------------------------------------------------

export interface GameConfig {
  gameId: bigint;
  mapDiameter: BN;
  gameSpeed: BN;
  startSlot: BN;
  endSlot: BN;
  winCondition: object;
  whitelist: boolean;
  serverPubkey: PublicKey | null;
  noiseThresholds: NoiseThresholds;
  hashRounds: number;
}

export function defaultGameConfig(
  gameId: bigint,
  overrides?: Partial<GameConfig>
): GameConfig {
  return {
    gameId,
    mapDiameter: DEFAULT_MAP_DIAMETER,
    gameSpeed: DEFAULT_GAME_SPEED,
    startSlot: new BN(0),
    endSlot: new BN(1_000_000_000),
    winCondition: { pointsBurning: { pointsPerMetal: new BN(1) } },
    whitelist: false,
    serverPubkey: null,
    noiseThresholds: DEFAULT_THRESHOLDS,
    hashRounds: 1,
    ...overrides,
  };
}

export async function createGame(
  program: Program<EncryptedForest>,
  admin: Keypair,
  config: GameConfig
): Promise<PublicKey> {
  const [gamePDA] = deriveGamePDA(config.gameId, program.programId);

  const anchorThresholds = {
    deadSpaceThreshold: config.noiseThresholds.deadSpaceThreshold,
    planetThreshold: config.noiseThresholds.planetThreshold,
    quasarThreshold: config.noiseThresholds.quasarThreshold,
    spacetimeRipThreshold: config.noiseThresholds.spacetimeRipThreshold,
    asteroidBeltThreshold: config.noiseThresholds.asteroidBeltThreshold,
    sizeThreshold1: config.noiseThresholds.sizeThreshold1,
    sizeThreshold2: config.noiseThresholds.sizeThreshold2,
    sizeThreshold3: config.noiseThresholds.sizeThreshold3,
    sizeThreshold4: config.noiseThresholds.sizeThreshold4,
    sizeThreshold5: config.noiseThresholds.sizeThreshold5,
  };

  await program.methods
    .createGame(
      new BN(config.gameId.toString()),
      config.mapDiameter,
      config.gameSpeed,
      config.startSlot,
      config.endSlot,
      config.winCondition as any,
      config.whitelist,
      config.serverPubkey,
      anchorThresholds,
      config.hashRounds
    )
    .accounts({
      admin: admin.publicKey,
      game: gamePDA,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc({ commitment: "confirmed" });

  return gamePDA;
}

export async function initPlayer(
  program: Program<EncryptedForest>,
  owner: Keypair,
  gameId: bigint,
  server?: Keypair
): Promise<PublicKey> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(
    gameId,
    owner.publicKey,
    program.programId
  );

  const accounts: any = {
    owner: owner.publicKey,
    game: gamePDA,
    player: playerPDA,
    systemProgram: SystemProgram.programId,
  };

  if (server) {
    accounts.server = server.publicKey;
  }

  const signers = server ? [owner, server] : [owner];

  await program.methods
    .initPlayer(new BN(gameId.toString()))
    .accounts(accounts)
    .signers(signers)
    .rpc({ commitment: "confirmed" });

  return playerPDA;
}

// ---------------------------------------------------------------------------
// Dead space finder (not in SDK since it's test-only)
// ---------------------------------------------------------------------------

export function findDeadSpace(
  gameId: bigint,
  thresholds: NoiseThresholds,
  mapDiameter: number = 1000,
  rounds: number = 1
): { x: bigint; y: bigint; hash: Uint8Array } {
  const half = Math.floor(mapDiameter / 2);

  for (let attempt = 0; attempt < 100_000; attempt++) {
    const x = BigInt((attempt % mapDiameter) - half);
    const y = BigInt(Math.floor(attempt / mapDiameter) - half);

    const hash = computePlanetHash(x, y, gameId, rounds);
    const propHash = computePropertyHash(x, y, gameId, rounds);
    const props = determineCelestialBody(propHash, thresholds);

    if (props === null) {
      return { x, y, hash };
    }
  }

  throw new Error("Could not find dead space coordinates");
}

// ---------------------------------------------------------------------------
// Arcium helpers (test-specific infrastructure)
// ---------------------------------------------------------------------------

/**
 * Get MXE public key with retries (MXE may not be ready immediately).
 */
export async function getMXEPublicKeyWithRetry(
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
      console.log(
        `Attempt ${attempt} failed to fetch MXE public key:`,
        error
      );
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

/**
 * Derive the Arcium sign PDA for this program.
 */
export function getSignPdaAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    programId
  )[0];
}

/**
 * Circuit base URL for offchain comp def storage (Cloudflare R2).
 * Must be set via CIRCUIT_BASE_URL env var.
 */
export const DEFAULT_CIRCUIT_BASE_URL =
  process.env.CIRCUIT_BASE_URL || "https://s3.spacerisk.io";

/**
 * Initialize all 5 computation definitions for the program.
 */
export async function initAllCompDefs(
  program: Program<EncryptedForest>,
  payer: Keypair,
  circuitBaseUrl: string = DEFAULT_CIRCUIT_BASE_URL
): Promise<void> {
  const mxeAccount = getMXEAccAddress(program.programId);
  const arciumProgram = getArciumProgramId();
  const addressLookupTable = getLookupTableAddress(program.programId);
  const lutProgram = new PublicKey("AddressLookupTab1e1111111111111111111111111");

  const compDefNames = [
    "init_planet",
    "init_spawn_planet",
    "process_move",
    "flush_planet",
    "upgrade_planet",
  ];

  const methodNames = [
    "initCompDefInitPlanet",
    "initCompDefInitSpawnPlanet",
    "initCompDefProcessMove",
    "initCompDefFlushPlanet",
    "initCompDefUpgradePlanet",
  ] as const;

  for (let i = 0; i < compDefNames.length; i++) {
    const offsetBytes = getCompDefAccOffset(compDefNames[i]);
    const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();
    const compDefAddress = getCompDefAccAddress(program.programId, offsetU32);

    try {
      await (program.methods as any)
        [methodNames[i]](circuitBaseUrl)
        .accounts({
          payer: payer.publicKey,
          mxeAccount,
          compDefAccount: compDefAddress,
          addressLookupTable,
          lutProgram,
          systemProgram: SystemProgram.programId,
          arciumProgram,
        })
        .signers([payer])
        .rpc({ commitment: "confirmed" });
      console.log(`Initialized comp def: ${compDefNames[i]} (offchain: ${circuitBaseUrl}/${compDefNames[i]}.arcis)`);
    } catch (e: any) {
      console.log(
        `Comp def ${compDefNames[i]} may already be initialized:`,
        e.message?.substring(0, 100)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Encryption helpers for building ciphertext payloads
// ---------------------------------------------------------------------------

export interface EncryptionContext {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  cipher: RescueCipher;
}

/**
 * Set up encryption context with the MXE.
 */
export async function setupEncryption(
  provider: AnchorProvider,
  programId: PublicKey
): Promise<EncryptionContext> {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programId);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  return { privateKey, publicKey, mxePublicKey, sharedSecret, cipher };
}

/**
 * Encrypt values and pack into a single buffer.
 */
export function encryptAndPack(
  cipher: RescueCipher,
  values: bigint[],
  nonce: Uint8Array
): { packed: Uint8Array; ciphertexts: Uint8Array[] } {
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

export function buildInitPlanetValues(x: bigint, y: bigint): bigint[] {
  return [BigInt.asUintN(64, x), BigInt.asUintN(64, y)];
}

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

export function buildFlushPlanetValues(
  currentSlot: bigint,
  gameSpeed: bigint,
  lastUpdatedSlot: bigint,
  flushCount: bigint
): bigint[] {
  return [
    BigInt.asUintN(32, currentSlot),
    BigInt.asUintN(32, gameSpeed),
    BigInt.asUintN(32, lastUpdatedSlot),
    BigInt.asUintN(32, flushCount),
  ];
}

export function buildUpgradePlanetValues(
  playerId: bigint,
  focus: number,
  currentSlot: bigint,
  gameSpeed: bigint,
  lastUpdatedSlot: bigint,
  metalUpgradeCost: bigint
): bigint[] {
  return [
    BigInt.asUintN(32, playerId),
    BigInt.asUintN(32, BigInt(focus)),
    BigInt.asUintN(32, currentSlot),
    BigInt.asUintN(32, gameSpeed),
    BigInt.asUintN(32, lastUpdatedSlot),
    BigInt.asUintN(32, metalUpgradeCost),
  ];
}

// ---------------------------------------------------------------------------
// Queue instruction helpers (test-specific: send actual transactions)
// ---------------------------------------------------------------------------

/**
 * Get all Arcium account addresses needed for queue_* instructions.
 */
export function getArciumAccountAddresses(
  program: Program<EncryptedForest>,
  computationOffset: BN,
  compDefName: string
): Record<string, PublicKey> {
  const arciumEnv = getArciumEnv();
  const clusterOffset = arciumEnv.arciumClusterOffset;
  const offsetBytes = getCompDefAccOffset(compDefName);
  const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();

  return {
    signPdaAccount: getSignPdaAddress(program.programId),
    mxeAccount: getMXEAccAddress(program.programId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(
      clusterOffset,
      computationOffset
    ),
    compDefAccount: getCompDefAccAddress(program.programId, offsetU32),
    clusterAccount: getClusterAccAddress(clusterOffset),
    poolAccount: getPoolAccountAddress(),
    clockAccount: getClockAccountAddress(),
    arciumProgram: getArciumProgramId(),
    systemProgram: SystemProgram.programId,
  };
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
 * Queue init_planet MPC computation.
 */
export async function queueInitPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  x: bigint,
  y: bigint,
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN; planetPDA: PublicKey; pendingMovesPDA: PublicKey }> {
  const planetHash = computePlanetHash(x, y, gameId);
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [planetPDA] = deriveCelestialBodyPDA(gameId, planetHash, program.programId);
  const [pendingMovesPDA] = derivePendingMovesPDA(gameId, planetHash, program.programId);

  const nonce = randomBytes(16);
  const nonceValue = deserializeLE(nonce);
  const values = buildInitPlanetValues(x, y);
  const { packed } = encryptAndPack(encCtx.cipher, values, nonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "init_planet");

  const observerKey = x25519.utils.randomSecretKey();
  const observerPubkey = x25519.getPublicKey(observerKey);

  await program.methods
    .queueInitPlanet(
      computationOffset,
      Array.from(planetHash) as any,
      Buffer.from(packed) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(nonceValue.toString()),
      Array.from(observerPubkey) as any
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset, planetPDA, pendingMovesPDA };
}

/**
 * Queue init_spawn_planet MPC computation.
 */
export async function queueInitSpawnPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  x: bigint,
  y: bigint,
  playerId: bigint,
  sourcePlanetId: bigint,
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN; planetPDA: PublicKey; pendingMovesPDA: PublicKey; playerPDA: PublicKey }> {
  const planetHash = computePlanetHash(x, y, gameId);
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(gameId, payer.publicKey, program.programId);
  const [planetPDA] = deriveCelestialBodyPDA(gameId, planetHash, program.programId);
  const [pendingMovesPDA] = derivePendingMovesPDA(gameId, planetHash, program.programId);

  const nonce = randomBytes(16);
  const nonceValue = deserializeLE(nonce);
  const values = buildInitSpawnPlanetValues(x, y, playerId, sourcePlanetId);
  const { packed } = encryptAndPack(encCtx.cipher, values, nonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "init_spawn_planet");

  const observerKey = x25519.utils.randomSecretKey();
  const observerPubkey = x25519.getPublicKey(observerKey);

  await program.methods
    .queueInitSpawnPlanet(
      computationOffset,
      Array.from(planetHash) as any,
      Buffer.from(packed) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(nonceValue.toString()),
      Array.from(observerPubkey) as any
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      player: playerPDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset, planetPDA, pendingMovesPDA, playerPDA };
}

/**
 * Queue process_move MPC computation.
 */
export async function queueProcessMove(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  sourceBody: PublicKey,
  sourcePending: PublicKey,
  targetPending: PublicKey,
  landingSlot: bigint,
  currentShips: bigint,
  currentMetal: bigint,
  moveValues: bigint[],
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN }> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);

  const pendingData = await program.account.pendingMovesMetadata.fetch(targetPending);
  const predictedMoveId = BigInt(pendingData.nextMoveId.toString()) + BigInt(pendingData.queuedCount);
  const targetPlanetHash = new Uint8Array(pendingData.planetHash);
  const [moveAccountPDA] = derivePendingMoveAccountPDA(gameId, targetPlanetHash, predictedMoveId, program.programId);

  const moveNonce = randomBytes(16);
  const moveNonceValue = deserializeLE(moveNonce);
  const { packed: movePacked } = encryptAndPack(encCtx.cipher, moveValues, moveNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "process_move");

  const observerKey = x25519.utils.randomSecretKey();
  const observerPubkey = x25519.getPublicKey(observerKey);

  await program.methods
    .queueProcessMove(
      computationOffset,
      new BN(landingSlot.toString()),
      new BN(currentShips.toString()),
      new BN(currentMetal.toString()),
      Buffer.from(movePacked) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(moveNonceValue.toString()),
      Array.from(observerPubkey) as any
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      sourceBody,
      sourcePending,
      targetPending,
      moveAccount: moveAccountPDA,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset };
}

/**
 * Queue flush_planet MPC computation.
 */
export async function queueFlushPlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  celestialBody: PublicKey,
  pendingMoves: PublicKey,
  flushCount: number,
  flushValues: bigint[],
  moveAccounts: PublicKey[],
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN }> {
  const flushNonce = randomBytes(16);
  const flushNonceValue = deserializeLE(flushNonce);
  const { packed: flushPacked } = encryptAndPack(encCtx.cipher, flushValues, flushNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "flush_planet");

  await program.methods
    .queueFlushPlanet(
      computationOffset,
      flushCount,
      Buffer.from(flushPacked) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(flushNonceValue.toString())
    )
    .accountsPartial({
      payer: payer.publicKey,
      celestialBody,
      pendingMoves,
      ...arciumAccts,
    })
    .remainingAccounts(
      moveAccounts.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset };
}

/**
 * Queue upgrade_planet MPC computation.
 */
export async function queueUpgradePlanet(
  program: Program<EncryptedForest>,
  payer: Keypair,
  gameId: bigint,
  celestialBody: PublicKey,
  upgradeValues: bigint[],
  encCtx: EncryptionContext
): Promise<{ computationOffset: BN }> {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);

  const upgradeNonce = randomBytes(16);
  const upgradeNonceValue = deserializeLE(upgradeNonce);
  const { packed: upgradePacked } = encryptAndPack(encCtx.cipher, upgradeValues, upgradeNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const arciumAccts = getArciumAccountAddresses(program, computationOffset, "upgrade_planet");

  await program.methods
    .queueUpgradePlanet(
      computationOffset,
      Buffer.from(upgradePacked) as any,
      Array.from(encCtx.publicKey) as any,
      new BN(upgradeNonceValue.toString())
    )
    .accountsPartial({
      payer: payer.publicKey,
      game: gamePDA,
      celestialBody,
      ...arciumAccts,
    })
    .signers([payer])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  return { computationOffset };
}

// ---------------------------------------------------------------------------
// Unique game ID generator
// ---------------------------------------------------------------------------

export function nextGameId(): bigint {
  const bytes = randomBytes(8);
  return BigInt("0x" + bytes.toString("hex"));
}

// ---------------------------------------------------------------------------
// Re-exports from @arcium-hq/client for convenience
// ---------------------------------------------------------------------------
export {
  getArciumEnv,
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  RescueCipher,
  x25519,
  deserializeLE,
  awaitComputationFinalization,
};
