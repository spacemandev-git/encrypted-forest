/**
 * Plugin system types for Encrypted Forest (SolidJS).
 *
 * Plugins get read-only access to core SDK and stores,
 * can register UI windows, and can request transactions
 * that require user approval.
 */

import type { EncryptedForestClient } from "@encrypted-forest/core";
import type { Component } from "solid-js";

// ---------------------------------------------------------------------------
// Plugin API
// ---------------------------------------------------------------------------

export interface ReadonlyGameStore {
  readonly game: import("@encrypted-forest/core").Game | null;
  readonly gameId: bigint | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface ReadonlyPlanetsStore {
  readonly planets: ReadonlyMap<
    string,
    import("../stores/planets.js").PlanetEntry
  >;
  readonly count: number;
  getPlanet(
    hashHex: string
  ): import("../stores/planets.js").PlanetEntry | undefined;
}

export interface ReadonlyPlayerStore {
  readonly player: import("@encrypted-forest/core").Player | null;
  readonly totalShips: bigint;
  readonly totalMetal: bigint;
  readonly ownedPlanets: number;
  readonly loading: boolean;
}

export interface ReadonlyFogOfWarStore {
  readonly exploredCoords: ReadonlySet<string>;
  readonly exploredCount: number;
  readonly scanning: boolean;
}

export interface TransactionRequest {
  description: string;
  instructions: any[];
  additionalSigners?: any[];
}

export interface WindowRegistration {
  id: string;
  title: string;
  /** SolidJS component to render inside the window */
  component: Component<any>;
  props?: Record<string, any>;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface PluginAPI {
  readonly client: EncryptedForestClient;

  readonly stores: {
    readonly game: ReadonlyGameStore;
    readonly planets: ReadonlyPlanetsStore;
    readonly player: ReadonlyPlayerStore;
    readonly fogOfWar: ReadonlyFogOfWarStore;
  };

  registerWindow(registration: WindowRegistration): void;
  unregisterWindow(id: string): void;
  requestTransaction(request: TransactionRequest): Promise<string | null>;
  onEvent(
    eventType: string,
    callback: (data: unknown) => void
  ): () => void;
}

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export interface EncryptedForestPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  activate(api: PluginAPI): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
