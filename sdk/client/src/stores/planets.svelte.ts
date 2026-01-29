/**
 * Reactive discovered planets store.
 *
 * Manages a reactive map of discovered planets. Auto-fetches
 * from IndexedDB on load, auto-persists changes in background,
 * and subscribes to planet account changes.
 */

import { SvelteMap } from "svelte/reactivity";
import type { EncryptedForestClient, DiscoveredPlanet, CelestialBody } from "@encrypted-forest/core";
import {
  hashToHex,
  getAllPersistedPlanets,
  persistPlanet,
  type PersistedPlanet,
} from "../persistence/db.js";

/**
 * A planet entry combining discovery info with on-chain state.
 */
export interface PlanetEntry {
  /** Discovery info from local scanning */
  discovery: DiscoveredPlanet;
  /** On-chain account state (null if not yet fetched) */
  onChain: CelestialBody | null;
  /** hex-encoded hash for map key */
  hashHex: string;
}

export class PlanetsStore {
  #client: EncryptedForestClient;
  #gameId: bigint | null = null;
  #unsubscribeAll: (() => void) | null = null;

  /** Reactive map of hashHex -> PlanetEntry */
  planets = new SvelteMap<string, PlanetEntry>();

  /** Number of discovered planets */
  count = $derived(this.planets.size);

  /** All planet entries as an array */
  all = $derived([...this.planets.values()]);

  /** Planets owned by a specific pubkey (string comparison) */
  ownedBy = $derived.by(() => {
    return (ownerStr: string): PlanetEntry[] => {
      return this.all.filter(
        (p) => p.onChain?.owner?.toBase58() === ownerStr
      );
    };
  });

  constructor(client: EncryptedForestClient) {
    this.#client = client;
  }

  /**
   * Initialize the store for a game. Loads from IndexedDB and
   * subscribes to on-chain updates for all known planets.
   */
  async init(gameId: bigint): Promise<void> {
    this.#gameId = gameId;

    // Clean up previous subscriptions
    this.#cleanupSubscriptions();

    // Load from IndexedDB
    const persisted = await getAllPersistedPlanets();
    const gameIdStr = gameId.toString();

    for (const p of persisted) {
      if (p.gameId !== gameIdStr) continue;

      const entry: PlanetEntry = {
        discovery: {
          x: BigInt(p.x),
          y: BigInt(p.y),
          hash: new Uint8Array(p.hash),
          keySeed: new Uint8Array(p.keySeed),
          properties: {
            bodyType: p.bodyType,
            size: p.size,
            comets: p.comets,
          },
        },
        onChain: null,
        hashHex: p.hashHex,
      };
      this.planets.set(p.hashHex, entry);
    }

    // Fetch on-chain state for all known planets and subscribe
    await this.#subscribeToAll();
  }

  /**
   * Add a newly discovered planet.
   */
  async addPlanet(discovered: DiscoveredPlanet): Promise<void> {
    const hex = hashToHex(discovered.hash);

    if (this.planets.has(hex)) return;

    const entry: PlanetEntry = {
      discovery: discovered,
      onChain: null,
      hashHex: hex,
    };

    this.planets.set(hex, entry);

    // Persist to IndexedDB
    await this.#persistEntry(entry);

    // Try to fetch on-chain state
    await this.#fetchOnChainState(entry);

    // Re-subscribe to include new planet
    await this.#subscribeToAll();
  }

  /**
   * Add multiple discovered planets at once.
   */
  async addPlanets(discovered: DiscoveredPlanet[]): Promise<void> {
    let added = false;
    for (const d of discovered) {
      const hex = hashToHex(d.hash);
      if (this.planets.has(hex)) continue;

      const entry: PlanetEntry = {
        discovery: d,
        onChain: null,
        hashHex: hex,
      };
      this.planets.set(hex, entry);
      this.#persistEntry(entry); // fire and forget
      added = true;
    }

    if (added) {
      // Fetch on-chain state for all
      await this.#fetchAllOnChainStates();
      await this.#subscribeToAll();
    }
  }

  /**
   * Get a planet by hash hex.
   */
  getPlanet(hashHex: string): PlanetEntry | undefined {
    return this.planets.get(hashHex);
  }

  /**
   * Get a planet by hash bytes.
   */
  getPlanetByHash(hash: Uint8Array): PlanetEntry | undefined {
    return this.planets.get(hashToHex(hash));
  }

  /**
   * Remove a planet from the store (does not affect chain).
   */
  removePlanet(hashHex: string): void {
    this.planets.delete(hashHex);
  }

  /**
   * Refresh all on-chain states.
   */
  async refreshAll(): Promise<void> {
    await this.#fetchAllOnChainStates();
  }

  /**
   * Clean up all subscriptions.
   */
  destroy(): void {
    this.#cleanupSubscriptions();
    this.planets.clear();
    this.#gameId = null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  async #persistEntry(entry: PlanetEntry): Promise<void> {
    if (this.#gameId === null) return;

    const persisted: PersistedPlanet = {
      hashHex: entry.hashHex,
      x: entry.discovery.x.toString(),
      y: entry.discovery.y.toString(),
      gameId: this.#gameId.toString(),
      hash: Array.from(entry.discovery.hash),
      keySeed: Array.from(entry.discovery.keySeed),
      bodyType: entry.discovery.properties.bodyType,
      size: entry.discovery.properties.size,
      comets: entry.discovery.properties.comets,
      lastFetched: Date.now(),
    };

    await persistPlanet(persisted);
  }

  async #fetchOnChainState(entry: PlanetEntry): Promise<void> {
    if (this.#gameId === null) return;

    try {
      const body = await this.#client.getCelestialBody(
        this.#gameId,
        entry.discovery.hash
      );
      // Update reactively by creating a new entry object
      const updated = { ...entry, onChain: body };
      this.planets.set(entry.hashHex, updated);
    } catch {
      // Planet may not exist on chain yet -- that is fine
    }
  }

  async #fetchAllOnChainStates(): Promise<void> {
    const entries = [...this.planets.values()];
    await Promise.allSettled(
      entries.map((entry) => this.#fetchOnChainState(entry))
    );
  }

  async #subscribeToAll(): Promise<void> {
    if (this.#gameId === null) return;

    this.#cleanupSubscriptions();

    const hashes = [...this.planets.values()].map(
      (e) => e.discovery.hash
    );

    if (hashes.length === 0) return;

    this.#unsubscribeAll = this.#client.subscribeToMultiplePlanets(
      this.#gameId,
      hashes,
      (planetHash, _accountInfo) => {
        const hex = hashToHex(planetHash);
        const entry = this.planets.get(hex);
        if (!entry || this.#gameId === null) return;

        // Re-fetch the updated planet data
        this.#client
          .getCelestialBody(this.#gameId, planetHash)
          .then((body) => {
            const updated = { ...entry, onChain: body };
            this.planets.set(hex, updated);
          })
          .catch(() => {
            // ignore fetch errors on subscription callbacks
          });
      }
    );
  }

  #cleanupSubscriptions(): void {
    if (this.#unsubscribeAll) {
      this.#unsubscribeAll();
      this.#unsubscribeAll = null;
    }
  }
}

/**
 * Create a reactive planets store.
 */
export function createPlanetsStore(
  client: EncryptedForestClient
): PlanetsStore {
  return new PlanetsStore(client);
}
