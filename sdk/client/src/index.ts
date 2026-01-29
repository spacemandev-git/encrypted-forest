/**
 * @encrypted-forest/client
 *
 * Svelte 5 reactive layer for Encrypted Forest.
 * Provides rune-based reactive stores, IndexedDB persistence,
 * plugin system, and reusable UI components.
 */

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export { GameStore, createGameStore } from "./stores/game.svelte.js";
export {
  PlanetsStore,
  createPlanetsStore,
  type PlanetEntry,
} from "./stores/planets.svelte.js";
export { PlayerStore, createPlayerStore } from "./stores/player.svelte.js";
export {
  FogOfWarStore,
  createFogOfWarStore,
} from "./stores/fogOfWar.svelte.js";

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

export { default as Window } from "./ui/Window.svelte";
export type { WindowProps, WindowState } from "./ui/types.js";
