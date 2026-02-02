/**
 * EncryptedForestClient
 *
 * High-level client tying together all SDK modules:
 * - Game management (create game, init player)
 * - Exploration (client-side hash-based noise scanning)
 * - Actions (queue init planet, queue init spawn planet, queue process move,
 *   queue flush planet, queue upgrade planet, broadcast)
 * - Data fetching (game, player, encrypted celestial body, pending moves metadata)
 * - Decryption (planet static/dynamic state, pending move data)
 * - Subscriptions (account changes, log events)
 */

import { type Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  type Commitment,
} from "@solana/web3.js";
import type { Game, NoiseThresholds } from "./types/game.js";
import type { Player } from "./types/player.js";
import type { EncryptedCelestialBodyAccount } from "./types/celestialBody.js";
import { CelestialBodyType } from "./types/celestialBody.js";
import type { PendingMovesMetadata } from "./types/pendingMoves.js";
import {
  PROGRAM_ID,
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,
} from "./utils/pda.js";
import {
  computePlanetHash,
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
  type ScannedCoordinate,
} from "./noise/index.js";
import {
  discoverCoordinate,
  discoverRange,
  revealPlanet,
  type DiscoveredPlanet,
} from "./crypto/fog.js";
import { derivePlanetKeySeed, verifyPlanetHash } from "./crypto/planetKey.js";
import {
  decryptPlanetStatic,
  decryptPlanetDynamic,
  decryptPlanetState,
  decryptPendingMoveData,
  derivePlanetPublicKey,
  computeSharedSecret,
  type PlanetStaticState,
  type PlanetDynamicState,
  type PlanetState,
  type PendingMoveData,
} from "./crypto/planetCipher.js";
import { fetchGame, fetchGameByAddress } from "./accounts/game.js";
import { fetchPlayer, fetchPlayerByAddress } from "./accounts/player.js";
import {
  fetchEncryptedCelestialBody,
  fetchEncryptedCelestialBodyByAddress,
} from "./accounts/celestialBody.js";
import {
  fetchPendingMovesMetadata,
  fetchPendingMovesMetadataByAddress,
} from "./accounts/pendingMoves.js";
import {
  buildCreateGameIx,
  type CreateGameArgs,
} from "./instructions/createGame.js";
import { buildInitPlayerIx } from "./instructions/initPlayer.js";
import {
  buildBroadcastIx,
  type BroadcastArgs,
} from "./instructions/broadcast.js";
import {
  buildCleanupGameIx,
  buildCleanupPlayerIx,
  buildCleanupPlanetIx,
} from "./instructions/cleanup.js";
import type { ArciumAccounts } from "./instructions/arciumAccounts.js";
import {
  buildQueueInitPlanetIx,
  type QueueInitPlanetArgs,
} from "./instructions/queueInitPlanet.js";
import {
  buildQueueInitSpawnPlanetIx,
  type QueueInitSpawnPlanetArgs,
} from "./instructions/queueInitSpawnPlanet.js";
import {
  buildQueueProcessMoveIx,
  type QueueProcessMoveArgs,
} from "./instructions/queueProcessMove.js";
import {
  buildQueueFlushPlanetIx,
  type QueueFlushPlanetArgs,
} from "./instructions/queueFlushPlanet.js";
import {
  buildQueueUpgradePlanetIx,
  type QueueUpgradePlanetArgs,
} from "./instructions/queueUpgradePlanet.js";
import {
  subscribeToGame,
  subscribeToPlayer,
  subscribeToCelestialBody,
  subscribeToPendingMoves,
  subscribeToMultiplePlanets,
  type Subscription,
} from "./subscriptions/accounts.js";
import {
  subscribeToGameLogs,
  subscribeToBroadcasts,
  subscribeToInitPlanetEvents,
  subscribeToProcessMoveEvents,
  subscribeToFlushPlanetEvents,
  subscribeToUpgradePlanetEvents,
} from "./subscriptions/logs.js";

// ---------------------------------------------------------------------------
// Client class
// ---------------------------------------------------------------------------

export class EncryptedForestClient {
  public readonly connection: Connection;
  public readonly program: Program;
  public readonly programId: PublicKey;

  constructor(program: Program, connection?: Connection) {
    this.program = program;
    this.programId = program.programId;
    this.connection =
      connection ?? (program.provider as AnchorProvider).connection;
  }

  // -------------------------------------------------------------------------
  // PDA derivation
  // -------------------------------------------------------------------------

  deriveGamePDA(gameId: bigint): [PublicKey, number] {
    return deriveGamePDA(gameId, this.programId);
  }

  derivePlayerPDA(
    gameId: bigint,
    playerPubkey: PublicKey
  ): [PublicKey, number] {
    return derivePlayerPDA(gameId, playerPubkey, this.programId);
  }

  deriveCelestialBodyPDA(
    gameId: bigint,
    planetHash: Uint8Array
  ): [PublicKey, number] {
    return deriveCelestialBodyPDA(gameId, planetHash, this.programId);
  }

  derivePendingMovesPDA(
    gameId: bigint,
    planetHash: Uint8Array
  ): [PublicKey, number] {
    return derivePendingMovesPDA(gameId, planetHash, this.programId);
  }

  derivePendingMoveAccountPDA(
    gameId: bigint,
    planetHash: Uint8Array,
    moveId: bigint
  ): [PublicKey, number] {
    return derivePendingMoveAccountPDA(gameId, planetHash, moveId, this.programId);
  }

  // -------------------------------------------------------------------------
  // Account fetching
  // -------------------------------------------------------------------------

  async getGame(gameId: bigint): Promise<Game> {
    return fetchGame(this.program, gameId, this.programId);
  }

  async getGameByAddress(address: PublicKey): Promise<Game> {
    return fetchGameByAddress(this.program, address);
  }

  async getPlayer(gameId: bigint, playerPubkey: PublicKey): Promise<Player> {
    return fetchPlayer(this.program, gameId, playerPubkey, this.programId);
  }

  async getPlayerByAddress(address: PublicKey): Promise<Player> {
    return fetchPlayerByAddress(this.program, address);
  }

  async getEncryptedCelestialBody(
    gameId: bigint,
    planetHash: Uint8Array
  ): Promise<EncryptedCelestialBodyAccount> {
    return fetchEncryptedCelestialBody(
      this.program,
      gameId,
      planetHash,
      this.programId
    );
  }

  async getEncryptedCelestialBodyByAddress(
    address: PublicKey
  ): Promise<EncryptedCelestialBodyAccount> {
    return fetchEncryptedCelestialBodyByAddress(this.program, address);
  }

  async getPendingMovesMetadata(
    gameId: bigint,
    planetHash: Uint8Array
  ): Promise<PendingMovesMetadata> {
    return fetchPendingMovesMetadata(
      this.program,
      gameId,
      planetHash,
      this.programId
    );
  }

  async getPendingMovesMetadataByAddress(
    address: PublicKey
  ): Promise<PendingMovesMetadata> {
    return fetchPendingMovesMetadataByAddress(this.program, address);
  }

  // -------------------------------------------------------------------------
  // Decryption
  // -------------------------------------------------------------------------

  /**
   * Decrypt the full encrypted planet state.
   */
  decryptPlanetState(
    planetHash: Uint8Array,
    mxePublicKey: Uint8Array,
    encAccount: EncryptedCelestialBodyAccount
  ): PlanetState {
    return decryptPlanetState(planetHash, mxePublicKey, encAccount);
  }

  /**
   * Decrypt only the static portion of the planet state.
   */
  decryptPlanetStatic(
    planetHash: Uint8Array,
    mxePublicKey: Uint8Array,
    encAccount: EncryptedCelestialBodyAccount
  ): PlanetStaticState {
    return decryptPlanetStatic(
      planetHash,
      mxePublicKey,
      encAccount.stateEncNonce,
      encAccount.stateEncCiphertexts
    );
  }

  /**
   * Decrypt only the dynamic portion of the planet state.
   */
  decryptPlanetDynamic(
    planetHash: Uint8Array,
    mxePublicKey: Uint8Array,
    encAccount: EncryptedCelestialBodyAccount
  ): PlanetDynamicState {
    return decryptPlanetDynamic(
      planetHash,
      mxePublicKey,
      encAccount.stateEncNonce,
      encAccount.stateEncCiphertexts
    );
  }

  // -------------------------------------------------------------------------
  // Instruction builders
  // -------------------------------------------------------------------------

  buildCreateGame(admin: PublicKey, args: CreateGameArgs) {
    return buildCreateGameIx(this.program, admin, args);
  }

  buildInitPlayer(owner: PublicKey, gameId: bigint, server?: PublicKey) {
    return buildInitPlayerIx(this.program, owner, gameId, server);
  }

  buildQueueInitPlanet(
    payer: PublicKey,
    args: QueueInitPlanetArgs,
    arciumAccounts: ArciumAccounts
  ) {
    return buildQueueInitPlanetIx(
      this.program,
      payer,
      args,
      arciumAccounts
    );
  }

  buildQueueInitSpawnPlanet(
    payer: PublicKey,
    args: QueueInitSpawnPlanetArgs,
    arciumAccounts: ArciumAccounts
  ) {
    return buildQueueInitSpawnPlanetIx(
      this.program,
      payer,
      args,
      arciumAccounts
    );
  }

  buildQueueProcessMove(
    payer: PublicKey,
    args: QueueProcessMoveArgs,
    arciumAccounts: ArciumAccounts
  ) {
    return buildQueueProcessMoveIx(
      this.program,
      payer,
      args,
      arciumAccounts
    );
  }

  buildQueueFlushPlanet(
    payer: PublicKey,
    args: QueueFlushPlanetArgs,
    arciumAccounts: ArciumAccounts
  ) {
    return buildQueueFlushPlanetIx(
      this.program,
      payer,
      args,
      arciumAccounts
    );
  }

  buildQueueUpgradePlanet(
    payer: PublicKey,
    args: QueueUpgradePlanetArgs,
    arciumAccounts: ArciumAccounts
  ) {
    return buildQueueUpgradePlanetIx(
      this.program,
      payer,
      args,
      arciumAccounts
    );
  }

  buildBroadcast(broadcaster: PublicKey, args: BroadcastArgs) {
    return buildBroadcastIx(this.program, broadcaster, args);
  }

  buildCleanupGame(closer: PublicKey, gameId: bigint) {
    return buildCleanupGameIx(this.program, closer, gameId);
  }

  buildCleanupPlayer(
    closer: PublicKey,
    gameId: bigint,
    playerOwner: PublicKey
  ) {
    return buildCleanupPlayerIx(this.program, closer, gameId, playerOwner);
  }

  buildCleanupPlanet(
    closer: PublicKey,
    gameId: bigint,
    planetHash: Uint8Array
  ) {
    return buildCleanupPlanetIx(this.program, closer, gameId, planetHash);
  }

  // -------------------------------------------------------------------------
  // Exploration (client-side hash-based noise)
  // -------------------------------------------------------------------------

  scanCoordinate(
    x: bigint,
    y: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds
  ): ScannedCoordinate {
    return scanCoordinate(x, y, gameId, thresholds);
  }

  scanRange(
    startX: bigint,
    startY: bigint,
    endX: bigint,
    endY: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds
  ): ScannedCoordinate[] {
    return scanRange(startX, startY, endX, endY, gameId, thresholds);
  }

  discoverCoordinate(
    x: bigint,
    y: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds
  ): DiscoveredPlanet | null {
    return discoverCoordinate(x, y, gameId, thresholds);
  }

  discoverRange(
    startX: bigint,
    startY: bigint,
    endX: bigint,
    endY: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds
  ): DiscoveredPlanet[] {
    return discoverRange(startX, startY, endX, endY, gameId, thresholds);
  }

  revealPlanet(
    x: bigint,
    y: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds,
    expectedHash?: Uint8Array
  ): DiscoveredPlanet | null {
    return revealPlanet(x, y, gameId, thresholds, expectedHash);
  }

  findSpawnPlanet(
    gameId: bigint,
    thresholds: NoiseThresholds,
    mapDiameter?: number,
    maxAttempts?: number
  ): ScannedCoordinate {
    return findSpawnPlanet(gameId, thresholds, mapDiameter, maxAttempts);
  }

  findPlanetOfType(
    gameId: bigint,
    thresholds: NoiseThresholds,
    bodyType: CelestialBodyType,
    minSize?: number,
    mapDiameter?: number,
    maxAttempts?: number,
    startOffset?: number
  ): ScannedCoordinate {
    return findPlanetOfType(
      gameId,
      thresholds,
      bodyType,
      minSize,
      mapDiameter,
      maxAttempts,
      startOffset
    );
  }

  // -------------------------------------------------------------------------
  // Game mechanics helpers
  // -------------------------------------------------------------------------

  computeCurrentShips(
    lastShipCount: bigint,
    maxCapacity: bigint,
    genSpeed: bigint,
    lastUpdatedSlot: bigint,
    currentSlot: bigint,
    gameSpeed: bigint
  ): bigint {
    return computeCurrentShips(
      lastShipCount,
      maxCapacity,
      genSpeed,
      lastUpdatedSlot,
      currentSlot,
      gameSpeed
    );
  }

  computeCurrentMetal(
    lastMetalCount: bigint,
    maxCapacity: bigint,
    genSpeed: bigint,
    lastUpdatedSlot: bigint,
    currentSlot: bigint,
    gameSpeed: bigint
  ): bigint {
    return computeCurrentMetal(
      lastMetalCount,
      maxCapacity,
      genSpeed,
      lastUpdatedSlot,
      currentSlot,
      gameSpeed
    );
  }

  computeDistance(
    x1: bigint,
    y1: bigint,
    x2: bigint,
    y2: bigint
  ): bigint {
    return computeDistance(x1, y1, x2, y2);
  }

  applyDistanceDecay(ships: bigint, distance: bigint, range: bigint): bigint {
    return applyDistanceDecay(ships, distance, range);
  }

  computeLandingSlot(
    currentSlot: bigint,
    distance: bigint,
    launchVelocity: bigint,
    gameSpeed: bigint
  ): bigint {
    return computeLandingSlot(currentSlot, distance, launchVelocity, gameSpeed);
  }

  upgradeCost(currentLevel: number): bigint {
    return upgradeCost(currentLevel);
  }

  baseStats(bodyType: CelestialBodyType, size: number) {
    return baseStats(bodyType, size);
  }

  applyCometBoosts(
    stats: ReturnType<typeof baseStats>,
    comets: import("./types/celestialBody.js").CometBoost[]
  ) {
    return applyCometBoosts(stats, comets);
  }

  // -------------------------------------------------------------------------
  // Crypto helpers
  // -------------------------------------------------------------------------

  computePlanetHash(x: bigint, y: bigint, gameId: bigint, rounds: number = 1): Uint8Array {
    return computePlanetHash(x, y, gameId, rounds);
  }

  derivePlanetKeySeed(x: bigint, y: bigint, gameId: bigint, rounds: number = 1): Uint8Array {
    return derivePlanetKeySeed(x, y, gameId, rounds);
  }

  verifyPlanetHash(
    x: bigint,
    y: bigint,
    gameId: bigint,
    expectedHash: Uint8Array
  ): boolean {
    return verifyPlanetHash(x, y, gameId, expectedHash);
  }

  derivePlanetPublicKey(planetHash: Uint8Array): Uint8Array {
    return derivePlanetPublicKey(planetHash);
  }

  computeSharedSecret(
    planetHash: Uint8Array,
    mxePublicKey: Uint8Array
  ): Uint8Array {
    return computeSharedSecret(planetHash, mxePublicKey);
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  subscribeToGame(
    gameId: bigint,
    callback: (accountInfo: any) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToGame(
      this.connection,
      gameId,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToPlayer(
    gameId: bigint,
    playerPubkey: PublicKey,
    callback: (accountInfo: any) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToPlayer(
      this.connection,
      gameId,
      playerPubkey,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToCelestialBody(
    gameId: bigint,
    planetHash: Uint8Array,
    callback: (accountInfo: any) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToCelestialBody(
      this.connection,
      gameId,
      planetHash,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToPendingMoves(
    gameId: bigint,
    planetHash: Uint8Array,
    callback: (accountInfo: any) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToPendingMoves(
      this.connection,
      gameId,
      planetHash,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToMultiplePlanets(
    gameId: bigint,
    planetHashes: Uint8Array[],
    callback: (planetHash: Uint8Array, accountInfo: any) => void,
    commitment?: Commitment
  ): () => void {
    return subscribeToMultiplePlanets(
      this.connection,
      gameId,
      planetHashes,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToGameLogs(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToGameLogs(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToBroadcasts(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToBroadcasts(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToInitPlanetEvents(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToInitPlanetEvents(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToProcessMoveEvents(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToProcessMoveEvents(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToFlushPlanetEvents(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToFlushPlanetEvents(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }

  subscribeToUpgradePlanetEvents(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToUpgradePlanetEvents(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }
}
