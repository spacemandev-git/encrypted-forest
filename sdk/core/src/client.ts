/**
 * EncryptedForestClient
 *
 * High-level client tying together all SDK modules:
 * - Game management (create game, init player)
 * - Exploration (client-side hash-based noise scanning)
 * - Actions (spawn, move ships, upgrade, broadcast)
 * - Data fetching (game, player, celestial body, pending moves)
 * - Subscriptions (account changes, log events)
 */

import { type Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  type Commitment,
} from "@solana/web3.js";
import type { Game, NoiseThresholds, WinCondition } from "./types/game.js";
import type { Player } from "./types/player.js";
import type { CelestialBody } from "./types/celestialBody.js";
import type { PendingMoves } from "./types/pendingMoves.js";
import { CelestialBodyType, UpgradeFocus } from "./types/celestialBody.js";
import {
  PROGRAM_ID,
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
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
import { fetchGame, fetchGameByAddress } from "./accounts/game.js";
import { fetchPlayer, fetchPlayerByAddress } from "./accounts/player.js";
import {
  fetchCelestialBody,
  fetchCelestialBodyByAddress,
} from "./accounts/celestialBody.js";
import {
  fetchPendingMoves,
  fetchPendingMovesByAddress,
} from "./accounts/pendingMoves.js";
import {
  buildCreateGameIx,
  type CreateGameArgs,
} from "./instructions/createGame.js";
import { buildInitPlayerIx } from "./instructions/initPlayer.js";
import {
  buildSpawnIx,
  buildCreatePlanetIx,
  buildClaimSpawnPlanetIx,
  type SpawnArgs,
} from "./instructions/spawn.js";
import {
  buildMoveShipsIx,
  type MoveShipsArgs,
} from "./instructions/moveShips.js";
import { buildUpgradeIx, type UpgradeArgs } from "./instructions/upgrade.js";
import {
  buildBroadcastIx,
  type BroadcastArgs,
} from "./instructions/broadcast.js";
import {
  buildCleanupGameIx,
  buildCleanupPlayerIx,
  buildCleanupPlanetIx,
} from "./instructions/cleanup.js";
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
  subscribeToMoveEvents,
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

  async getCelestialBody(
    gameId: bigint,
    planetHash: Uint8Array
  ): Promise<CelestialBody> {
    return fetchCelestialBody(
      this.program,
      gameId,
      planetHash,
      this.programId
    );
  }

  async getCelestialBodyByAddress(address: PublicKey): Promise<CelestialBody> {
    return fetchCelestialBodyByAddress(this.program, address);
  }

  async getPendingMoves(
    gameId: bigint,
    planetHash: Uint8Array
  ): Promise<PendingMoves> {
    return fetchPendingMoves(
      this.program,
      gameId,
      planetHash,
      this.programId
    );
  }

  async getPendingMovesByAddress(address: PublicKey): Promise<PendingMoves> {
    return fetchPendingMovesByAddress(this.program, address);
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

  buildSpawn(
    payer: PublicKey,
    args: SpawnArgs,
    arciumAccounts: Parameters<typeof buildSpawnIx>[3]
  ) {
    return buildSpawnIx(this.program, payer, args, arciumAccounts);
  }

  buildCreatePlanet(
    payer: PublicKey,
    gameId: bigint,
    x: bigint,
    y: bigint,
    planetHash: Uint8Array
  ) {
    return buildCreatePlanetIx(
      this.program,
      payer,
      gameId,
      x,
      y,
      planetHash
    );
  }

  buildClaimSpawnPlanet(
    owner: PublicKey,
    gameId: bigint,
    planetHash: Uint8Array
  ) {
    return buildClaimSpawnPlanetIx(this.program, owner, gameId, planetHash);
  }

  buildMoveShips(playerOwner: PublicKey, args: MoveShipsArgs) {
    return buildMoveShipsIx(this.program, playerOwner, args);
  }

  buildUpgrade(playerOwner: PublicKey, args: UpgradeArgs) {
    return buildUpgradeIx(this.program, playerOwner, args);
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

  /**
   * Scan a single coordinate.
   */
  scanCoordinate(
    x: bigint,
    y: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds
  ): ScannedCoordinate {
    return scanCoordinate(x, y, gameId, thresholds);
  }

  /**
   * Scan a rectangular range.
   */
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

  /**
   * Discover a coordinate (scan + derive key).
   */
  discoverCoordinate(
    x: bigint,
    y: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds
  ): DiscoveredPlanet | null {
    return discoverCoordinate(x, y, gameId, thresholds);
  }

  /**
   * Discover a range (scan + derive keys).
   */
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

  /**
   * Reveal a planet from broadcast coordinates.
   */
  revealPlanet(
    x: bigint,
    y: bigint,
    gameId: bigint,
    thresholds: NoiseThresholds,
    expectedHash?: Uint8Array
  ): DiscoveredPlanet | null {
    return revealPlanet(x, y, gameId, thresholds, expectedHash);
  }

  /**
   * Find a valid spawn planet.
   */
  findSpawnPlanet(
    gameId: bigint,
    thresholds: NoiseThresholds,
    mapDiameter?: number,
    maxAttempts?: number
  ): ScannedCoordinate {
    return findSpawnPlanet(gameId, thresholds, mapDiameter, maxAttempts);
  }

  /**
   * Find a planet of a specific type.
   */
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

  computePlanetHash(x: bigint, y: bigint, gameId: bigint): Uint8Array {
    return computePlanetHash(x, y, gameId);
  }

  derivePlanetKeySeed(x: bigint, y: bigint, gameId: bigint): Uint8Array {
    return derivePlanetKeySeed(x, y, gameId);
  }

  verifyPlanetHash(
    x: bigint,
    y: bigint,
    gameId: bigint,
    expectedHash: Uint8Array
  ): boolean {
    return verifyPlanetHash(x, y, gameId, expectedHash);
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

  subscribeToMoveEvents(
    callback: (logs: { signature: string; logs: string[] }) => void,
    commitment?: Commitment
  ): Subscription {
    return subscribeToMoveEvents(
      this.connection,
      callback,
      this.programId,
      commitment
    );
  }
}
