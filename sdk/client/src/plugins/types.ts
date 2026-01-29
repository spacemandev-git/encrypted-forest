/**
 * Plugin system types for Encrypted Forest.
 *
 * Plugins get read-only access to core SDK and stores,
 * can register UI windows, and can request transactions
 * that require user approval.
 */

import type { EncryptedForestClient } from "@encrypted-forest/core";
import type { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Plugin API
// ---------------------------------------------------------------------------

/**
 * Read-only view of the game store.
 */
export interface ReadonlyGameStore {
  readonly game: import("@encrypted-forest/core").Game | null;
  readonly gameId: bigint | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Read-only view of the planets store.
 */
export interface ReadonlyPlanetsStore {
  readonly planets: ReadonlyMap<
    string,
    import("../stores/planets.svelte.js").PlanetEntry
  >;
  readonly count: number;
  getPlanet(
    hashHex: string
  ): import("../stores/planets.svelte.js").PlanetEntry | undefined;
}

/**
 * Read-only view of the player store.
 */
export interface ReadonlyPlayerStore {
  readonly player: import("@encrypted-forest/core").Player | null;
  readonly totalShips: bigint;
  readonly totalMetal: bigint;
  readonly ownedPlanets: number;
  readonly loading: boolean;
}

/**
 * Read-only view of the fog of war store.
 */
export interface ReadonlyFogOfWarStore {
  readonly exploredCoords: ReadonlySet<string>;
  readonly exploredCount: number;
  readonly scanning: boolean;
}

/**
 * Transaction request that plugins can submit.
 * All transactions require user approval before execution.
 */
export interface TransactionRequest {
  /** Human-readable description of what this transaction does */
  description: string;
  /** The instruction(s) to execute */
  instructions: any[];
  /** Optional signers beyond the wallet */
  additionalSigners?: any[];
}

/**
 * Window registration for plugin UI.
 */
export interface WindowRegistration {
  id: string;
  title: string;
  /** Svelte component to render inside the window */
  component: any;
  /** Component props */
  props?: Record<string, any>;
  /** Initial position */
  position?: { x: number; y: number };
  /** Initial size */
  size?: { width: number; height: number };
}

/**
 * The API surface exposed to plugins.
 */
export interface PluginAPI {
  /** Core SDK client (read-only -- plugins cannot send transactions directly) */
  readonly client: EncryptedForestClient;

  /** Reactive stores (read-only snapshots) */
  readonly stores: {
    readonly game: ReadonlyGameStore;
    readonly planets: ReadonlyPlanetsStore;
    readonly player: ReadonlyPlayerStore;
    readonly fogOfWar: ReadonlyFogOfWarStore;
  };

  /** Register a UI window */
  registerWindow(registration: WindowRegistration): void;

  /** Unregister a UI window */
  unregisterWindow(id: string): void;

  /** Request a transaction (requires user approval) */
  requestTransaction(request: TransactionRequest): Promise<string | null>;

  /** Subscribe to game events */
  onEvent(
    eventType: string,
    callback: (data: unknown) => void
  ): () => void;
}

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

/**
 * A plugin must export a default object matching this interface.
 */
export interface EncryptedForestPlugin {
  /** Unique plugin identifier */
  id: string;
  /** Display name */
  name: string;
  /** Plugin version */
  version: string;
  /** Optional description */
  description?: string;
  /** Called when the plugin is loaded with the API */
  activate(api: PluginAPI): void | Promise<void>;
  /** Called when the plugin is unloaded */
  deactivate?(): void | Promise<void>;
}
