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
export { DEFAULT_THRESHOLDS } from "./types/game.js";

export type {
  CelestialBody,
  CelestialBodyProperties,
  CelestialBodyStats,
} from "./types/celestialBody.js";
export {
  CelestialBodyType,
  CometBoost,
  UpgradeFocus,
} from "./types/celestialBody.js";

export type { Player } from "./types/player.js";

export type { PendingMoves, PendingMove } from "./types/pendingMoves.js";
export { MAX_PENDING_MOVES } from "./types/pendingMoves.js";

export type {
  SpawnResultEvent,
  PlanetKeyEvent,
  CombatResultEvent,
  MoveEvent,
  UpgradeEvent,
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

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export { fetchGame, fetchGameByAddress } from "./accounts/game.js";
export { fetchPlayer, fetchPlayerByAddress } from "./accounts/player.js";
export {
  fetchCelestialBody,
  fetchCelestialBodyByAddress,
} from "./accounts/celestialBody.js";
export {
  fetchPendingMoves,
  fetchPendingMovesByAddress,
} from "./accounts/pendingMoves.js";

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export { buildCreateGameIx } from "./instructions/createGame.js";
export type { CreateGameArgs } from "./instructions/createGame.js";

export { buildInitPlayerIx } from "./instructions/initPlayer.js";

export {
  buildSpawnIx,
  buildCreatePlanetIx,
  buildClaimSpawnPlanetIx,
} from "./instructions/spawn.js";
export type { SpawnArgs } from "./instructions/spawn.js";

export { buildMoveShipsIx } from "./instructions/moveShips.js";
export type { MoveShipsArgs } from "./instructions/moveShips.js";

export { buildUpgradeIx } from "./instructions/upgrade.js";
export type { UpgradeArgs } from "./instructions/upgrade.js";

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
  subscribeToMoveEvents,
} from "./subscriptions/logs.js";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export { EncryptedForestClient } from "./client.js";
