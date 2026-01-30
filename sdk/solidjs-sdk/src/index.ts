/**
 * @encrypted-forest/solidjs-sdk
 *
 * SolidJS reactive layer for Encrypted Forest.
 * Provides signal-based reactive stores, IndexedDB persistence,
 * plugin system, and reusable UI components.
 */

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export { createGameStore, type GameStoreAPI } from "./stores/game.js";
export {
  createPlanetsStore,
  type PlanetsStoreAPI,
  type PlanetEntry,
} from "./stores/planets.js";
export { createPlayerStore, type PlayerStoreAPI } from "./stores/player.js";
export {
  createFogOfWarStore,
  type FogOfWarStoreAPI,
} from "./stores/fogOfWar.js";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export {
  hashToHex,
  hexToHash,
  persistPlanet,
  persistPlanets,
  getPersistedPlanet,
  getAllPersistedPlanets,
  deletePersistedPlanet,
  clearPersistedPlanets,
  persistEvent,
  getEventsByPlanet,
  getAllEvents,
  clearEvents,
  setPreference,
  getPreference,
  saveScanProgress,
  getScanProgress,
  type PersistedPlanet,
  type PersistedEvent,
  type PlayerPreferences,
  type ScanProgressEntry,
} from "./persistence/db.js";

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export type {
  PluginAPI,
  EncryptedForestPlugin,
  TransactionRequest,
  WindowRegistration,
  ReadonlyGameStore,
  ReadonlyPlanetsStore,
  ReadonlyPlayerStore,
  ReadonlyFogOfWarStore,
} from "./plugins/types.js";

export { PluginManager } from "./plugins/loader.js";

// ---------------------------------------------------------------------------
// UI Components
// ---------------------------------------------------------------------------

export { default as Window } from "./ui/Window.js";
export type { WindowProps, WindowState } from "./ui/types.js";
