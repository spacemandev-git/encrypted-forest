/**
 * Reactive discovered planets store.
 *
 * Manages a reactive map of discovered planets. Auto-fetches
 * from IndexedDB on load, auto-persists changes in background,
 * and subscribes to planet account changes.
 *
 * Now supports encrypted on-chain state: fetches EncryptedCelestialBody
 * accounts and decrypts them locally using the planet_hash as key material.
 */

import { SvelteMap } from "svelte/reactivity";
import type { EncryptedForestClient, DiscoveredPlanet } from "@encrypted-forest/core";
import type { EncryptedCelestialBodyAccount } from "@encrypted-forest/core";
import {
  fetchEncryptedCelestialBody,
  decryptPlanetState,
} from "@encrypted-forest/core";
import type { PlanetState } from "@encrypted-forest/core";
import {
  hashToHex,
  getAllPersistedPlanets,
  persistPlanet,
  type PersistedPlanet,
} from "../persistence/db.js";

/**
 * A planet entry combining discovery info with encrypted + decrypted state.
 */
export interface PlanetEntry {
  /** Discovery info from local scanning */
  discovery: DiscoveredPlanet;
  /** Raw encrypted on-chain account data (null if not yet fetched) */
  encrypted: EncryptedCelestialBodyAccount | null;
  /** Locally decrypted planet state (null if not yet decrypted) */
  decrypted: PlanetState | null;
  /** hex-encoded hash for map key */
  hashHex: string;
}

/**
 * Serialize an array of Uint8Array ciphertexts to a flat number[] for IndexedDB.
 */
function serializeCiphertexts(cts: Uint8Array[]): number[] {
  const result: number[] = [];
  for (const ct of cts) {
    result.push(...Array.from(ct));
  }
  return result;
}

/**
 * Deserialize a flat number[] back into an array of Uint8Array ciphertexts.
 */
function deserializeCiphertexts(flat: number[], chunkSize: number): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let i = 0; i < flat.length; i += chunkSize) {
    result.push(new Uint8Array(flat.slice(i, i + chunkSize)));
  }
  return result;
}

export class PlanetsStore {
  #client: EncryptedForestClient;
  #mxePublicKey: Uint8Array;
  #gameId: bigint | null = null;
  #unsubscribeAll: (() => void) | null = null;

  /** Reactive map of hashHex -> PlanetEntry */
  planets = new SvelteMap<string, PlanetEntry>();

  /** Number of discovered planets */
  count = $derived(this.planets.size);

  /** All planet entries as an array */
  all = $derived([...this.planets.values()]);

  /** Planets owned by a specific owner (passed as ownerId bigint) */
  ownedBy = $derived.by(() => {
    return (ownerId: bigint): PlanetEntry[] => {
      return this.all.filter((p) => {
        if (!p.decrypted || p.decrypted.dynamic.ownerExists === 0) return false;
        return p.decrypted.dynamic.ownerId === ownerId;
      });
    };
  });

  constructor(client: EncryptedForestClient, mxePublicKey: Uint8Array) {
    this.#client = client;
    this.#mxePublicKey = mxePublicKey;
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
        encrypted: null,
        decrypted: null,
        hashHex: p.hashHex,
      };

      // If we have cached encrypted data, restore it and attempt decryption
      if (p.staticEncNonce && p.staticEncCiphertexts && p.dynamicEncNonce && p.dynamicEncCiphertexts) {
        try {
          const cachedEncrypted: EncryptedCelestialBodyAccount = {
            planetHash: new Uint8Array(p.hash),
            lastUpdatedSlot: 0n,
            lastFlushedSlot: 0n,
            staticEncPubkey: p.staticEncPubkey ? new Uint8Array(p.staticEncPubkey) : this.#mxePublicKey,
            staticEncNonce: new Uint8Array(p.staticEncNonce),
            staticEncCiphertexts: deserializeCiphertexts(p.staticEncCiphertexts, 32),
            dynamicEncPubkey: p.dynamicEncPubkey ? new Uint8Array(p.dynamicEncPubkey) : this.#mxePublicKey,
            dynamicEncNonce: new Uint8Array(p.dynamicEncNonce),
            dynamicEncCiphertexts: deserializeCiphertexts(p.dynamicEncCiphertexts, 32),
          };
          entry.encrypted = cachedEncrypted;
          entry.decrypted = decryptPlanetState(
            entry.discovery.hash,
            cachedEncrypted
          );
        } catch {
          // Cached encrypted data may be stale; will re-fetch from chain
        }
      }

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
      encrypted: null,
      decrypted: null,
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
        encrypted: null,
        decrypted: null,
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

    // Persist encrypted account data if available
    if (entry.encrypted) {
      persisted.staticEncPubkey = Array.from(entry.encrypted.staticEncPubkey);
      persisted.staticEncNonce = Array.from(entry.encrypted.staticEncNonce);
      persisted.staticEncCiphertexts = serializeCiphertexts(entry.encrypted.staticEncCiphertexts);
      persisted.dynamicEncPubkey = Array.from(entry.encrypted.dynamicEncPubkey);
      persisted.dynamicEncNonce = Array.from(entry.encrypted.dynamicEncNonce);
      persisted.dynamicEncCiphertexts = serializeCiphertexts(entry.encrypted.dynamicEncCiphertexts);
    }

    await persistPlanet(persisted);
  }

  async #fetchOnChainState(entry: PlanetEntry): Promise<void> {
    if (this.#gameId === null) return;

    try {
      // Fetch the encrypted celestial body account from chain
      const encAccount = await fetchEncryptedCelestialBody(
        this.#client.program,
        this.#gameId,
        entry.discovery.hash,
        this.#client.programId
      );

      // Decrypt locally using the planet hash as key material
      let decrypted: PlanetState | null = null;
      try {
        decrypted = decryptPlanetState(
          entry.discovery.hash,
          encAccount
        );
      } catch {
        // Decryption may fail if key material is wrong or data is corrupted
      }

      // Update reactively by creating a new entry object
      const updated: PlanetEntry = {
        ...entry,
        encrypted: encAccount,
        decrypted,
      };
      this.planets.set(entry.hashHex, updated);

      // Persist updated encrypted data to IndexedDB
      this.#persistEntry(updated);
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

        // Re-fetch and re-decrypt the updated planet data
        this.#fetchOnChainState(entry).catch(() => {
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
  client: EncryptedForestClient,
  mxePublicKey: Uint8Array
): PlanetsStore {
  return new PlanetsStore(client, mxePublicKey);
}
