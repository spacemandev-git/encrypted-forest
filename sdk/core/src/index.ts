/**
 * @encrypted-forest/core
 *
 * Framework-agnostic core TypeScript SDK for Encrypted Forest.
 * Pure data layer -- no UI/framework dependencies.
 *
 * Wraps Arcium/Solana web3.js for transactions, subscriptions, and crypto.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  Game,
  WinCondition,
  WinConditionAnchor,
  NoiseThresholds,
} from "./types/game.js";
export { DEFAULT_THRESHOLDS, DEFAULT_HASH_ROUNDS } from "./types/game.js";

export type {
  CelestialBody,
  CelestialBodyProperties,
  CelestialBodyStats,
  EncryptedCelestialBodyAccount,
} from "./types/celestialBody.js";
export {
  CelestialBodyType,
  CometBoost,
  UpgradeFocus,
  PLANET_STATE_FIELDS,
} from "./types/celestialBody.js";

export type { Player } from "./types/player.js";

export type {
  PendingMoveEntry,
  PendingMovesMetadata,
  PendingMoveAccount,
} from "./types/pendingMoves.js";
export {
  PENDING_MOVE_DATA_FIELDS,
  MAX_FLUSH_BATCH,
  MAX_QUEUED_CALLBACKS,
} from "./types/pendingMoves.js";

export type {
  InitPlanetEvent,
  InitSpawnPlanetEvent,
  ProcessMoveEvent,
  FlushPlanetEvent,
  UpgradePlanetEvent,
  BroadcastEvent,
} from "./types/events.js";

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

export {
  PROGRAM_ID,
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,
} from "./utils/pda.js";

// ---------------------------------------------------------------------------
// Noise (hash-based body determination)
// ---------------------------------------------------------------------------

export {
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
} from "./noise/index.js";
export type { ScannedCoordinate } from "./noise/index.js";

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

export { derivePlanetKeySeed, verifyPlanetHash } from "./crypto/planetKey.js";
export {
  discoverCoordinate,
  discoverRange,
  revealPlanet,
} from "./crypto/fog.js";
export type { DiscoveredPlanet } from "./crypto/fog.js";

export {
  derivePlanetPublicKey,
  computeSharedSecret,
  encryptFieldElement,
  decryptFieldElement,
  decryptPlanetStatic,
  decryptPlanetDynamic,
  decryptPlanetState,
  decryptPendingMoveData,
} from "./crypto/planetCipher.js";
export type {
  PlanetStaticState,
  PlanetDynamicState,
  PlanetState,
  PendingMoveData,
} from "./crypto/planetCipher.js";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export { fetchGame, fetchGameByAddress } from "./accounts/game.js";
export { fetchPlayer, fetchPlayerByAddress } from "./accounts/player.js";
export {
  fetchEncryptedCelestialBody,
  fetchEncryptedCelestialBodyByAddress,
} from "./accounts/celestialBody.js";
export {
  fetchPendingMovesMetadata,
  fetchPendingMovesMetadataByAddress,
} from "./accounts/pendingMoves.js";

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export { buildCreateGameIx } from "./instructions/createGame.js";
export type { CreateGameArgs } from "./instructions/createGame.js";

export { buildInitPlayerIx } from "./instructions/initPlayer.js";

export type { ArciumAccounts } from "./instructions/arciumAccounts.js";

export { buildQueueInitPlanetIx } from "./instructions/queueInitPlanet.js";
export type { QueueInitPlanetArgs } from "./instructions/queueInitPlanet.js";

export { buildQueueInitSpawnPlanetIx } from "./instructions/queueInitSpawnPlanet.js";
export type { QueueInitSpawnPlanetArgs } from "./instructions/queueInitSpawnPlanet.js";

export { buildQueueProcessMoveIx } from "./instructions/queueProcessMove.js";
export type { QueueProcessMoveArgs } from "./instructions/queueProcessMove.js";

export { buildQueueFlushPlanetIx } from "./instructions/queueFlushPlanet.js";
export type { QueueFlushPlanetArgs } from "./instructions/queueFlushPlanet.js";

export { buildQueueUpgradePlanetIx } from "./instructions/queueUpgradePlanet.js";
export type { QueueUpgradePlanetArgs } from "./instructions/queueUpgradePlanet.js";

export { buildBroadcastIx } from "./instructions/broadcast.js";
export type { BroadcastArgs } from "./instructions/broadcast.js";

export {
  buildCleanupGameIx,
  buildCleanupPlayerIx,
  buildCleanupPlanetIx,
} from "./instructions/cleanup.js";

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export {
  subscribeToGame,
  subscribeToPlayer,
  subscribeToCelestialBody,
  subscribeToPendingMoves,
  subscribeToMultiplePlanets,
} from "./subscriptions/accounts.js";
export type { Subscription } from "./subscriptions/accounts.js";

export {
  subscribeToGameLogs,
  subscribeToBroadcasts,
  subscribeToInitPlanetEvents,
  subscribeToProcessMoveEvents,
  subscribeToFlushPlanetEvents,
  subscribeToUpgradePlanetEvents,
} from "./subscriptions/logs.js";

// ---------------------------------------------------------------------------
// IDL
// ---------------------------------------------------------------------------

// Re-exported so downstream packages import from core, not their own copies.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — resolveJsonModule handles this
export { default as idlJson } from "./idl/encrypted_forest.json";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { EncryptedForestClient } from "./client.js";
