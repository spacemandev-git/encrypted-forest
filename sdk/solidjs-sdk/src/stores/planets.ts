/**
 * Reactive discovered planets store (SolidJS).
 *
 * Manages a reactive map of discovered planets. Auto-fetches
 * from IndexedDB on load, auto-persists changes in background,
 * and subscribes to planet account changes.
 *
 * Supports encrypted on-chain state: fetches EncryptedCelestialBody
 * accounts and decrypts them locally using the planet_hash as key material.
 */

import { createSignal, createMemo, type Accessor } from "solid-js";
import { ReactiveMap } from "@solid-primitives/map";
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
  discovery: DiscoveredPlanet;
  encrypted: EncryptedCelestialBodyAccount | null;
  decrypted: PlanetState | null;
  hashHex: string;
}

function serializeCiphertexts(cts: Uint8Array[]): number[] {
  const result: number[] = [];
  for (const ct of cts) {
    result.push(...Array.from(ct));
  }
  return result;
}

function deserializeCiphertexts(flat: number[], chunkSize: number): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let i = 0; i < flat.length; i += chunkSize) {
    result.push(new Uint8Array(flat.slice(i, i + chunkSize)));
  }
  return result;
}

export interface PlanetsStoreAPI {
  planets: ReactiveMap<string, PlanetEntry>;
  count: Accessor<number>;
  all: Accessor<PlanetEntry[]>;
  ownedBy: Accessor<(ownerId: bigint) => PlanetEntry[]>;
  init: (gameId: bigint) => Promise<void>;
  addPlanet: (discovered: DiscoveredPlanet) => Promise<void>;
  addPlanets: (discovered: DiscoveredPlanet[]) => Promise<void>;
  getPlanet: (hashHex: string) => PlanetEntry | undefined;
  getPlanetByHash: (hash: Uint8Array) => PlanetEntry | undefined;
  removePlanet: (hashHex: string) => void;
  refreshAll: () => Promise<void>;
  destroy: () => void;
}

export function createPlanetsStore(
  client: EncryptedForestClient,
  mxePublicKey: Uint8Array
): PlanetsStoreAPI {
  const planets = new ReactiveMap<string, PlanetEntry>();
  let gameId: bigint | null = null;
  let unsubscribeAll: (() => void) | null = null;

  const count = createMemo(() => planets.size);
  const all = createMemo(() => [...planets.values()]);
  const ownedBy = createMemo(() => {
    return (ownerId: bigint): PlanetEntry[] => {
      return all().filter((p) => {
        if (!p.decrypted || p.decrypted.dynamic.ownerExists === 0) return false;
        return p.decrypted.dynamic.ownerId === ownerId;
      });
    };
  });

  function cleanupSubscriptions(): void {
    if (unsubscribeAll) {
      unsubscribeAll();
      unsubscribeAll = null;
    }
  }

  async function persistEntry(entry: PlanetEntry): Promise<void> {
    if (gameId === null) return;

    const persisted: PersistedPlanet = {
      hashHex: entry.hashHex,
      x: entry.discovery.x.toString(),
      y: entry.discovery.y.toString(),
      gameId: gameId.toString(),
      hash: Array.from(entry.discovery.hash),
      keySeed: Array.from(entry.discovery.keySeed),
      bodyType: entry.discovery.properties.bodyType,
      size: entry.discovery.properties.size,
      comets: entry.discovery.properties.comets,
      lastFetched: Date.now(),
    };

    if (entry.encrypted) {
      persisted.stateEncPubkey = Array.from(entry.encrypted.stateEncPubkey);
      persisted.stateEncNonce = Array.from(entry.encrypted.stateEncNonce);
      persisted.stateEncCiphertexts = serializeCiphertexts(entry.encrypted.stateEncCiphertexts);
    }

    await persistPlanet(persisted);
  }

  async function fetchOnChainState(entry: PlanetEntry): Promise<void> {
    if (gameId === null) return;

    try {
      const encAccount = await fetchEncryptedCelestialBody(
        client.program,
        gameId,
        entry.discovery.hash,
        client.programId
      );

      let decrypted: PlanetState | null = null;
      try {
        decrypted = decryptPlanetState(entry.discovery.hash, mxePublicKey, encAccount);
      } catch {
        // Decryption may fail if key material is wrong or data is corrupted
      }

      const updated: PlanetEntry = {
        ...entry,
        encrypted: encAccount,
        decrypted,
      };
      planets.set(entry.hashHex, updated);
      persistEntry(updated);
    } catch {
      // Planet may not exist on chain yet
    }
  }

  async function fetchAllOnChainStates(): Promise<void> {
    const entries = [...planets.values()];
    await Promise.allSettled(entries.map((entry) => fetchOnChainState(entry)));
  }

  async function subscribeToAll(): Promise<void> {
    if (gameId === null) return;

    cleanupSubscriptions();

    const hashes = [...planets.values()].map((e) => e.discovery.hash);
    if (hashes.length === 0) return;

    unsubscribeAll = client.subscribeToMultiplePlanets(
      gameId,
      hashes,
      (planetHash, _accountInfo) => {
        const hex = hashToHex(planetHash);
        const entry = planets.get(hex);
        if (!entry || gameId === null) return;
        fetchOnChainState(entry).catch(() => {});
      }
    );
  }

  async function init(gId: bigint): Promise<void> {
    gameId = gId;
    cleanupSubscriptions();

    const persisted = await getAllPersistedPlanets();
    const gameIdStr = gId.toString();

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

      if (p.stateEncNonce && p.stateEncCiphertexts) {
        try {
          const cachedEncrypted: EncryptedCelestialBodyAccount = {
            planetHash: new Uint8Array(p.hash),
            lastUpdatedSlot: 0n,
            lastFlushedSlot: 0n,
            stateEncPubkey: p.stateEncPubkey ? new Uint8Array(p.stateEncPubkey) : mxePublicKey,
            stateEncNonce: new Uint8Array(p.stateEncNonce),
            stateEncCiphertexts: deserializeCiphertexts(p.stateEncCiphertexts, 32),
          };
          entry.encrypted = cachedEncrypted;
          entry.decrypted = decryptPlanetState(entry.discovery.hash, mxePublicKey, cachedEncrypted);
        } catch {
          // Cached encrypted data may be stale
        }
      }

      planets.set(p.hashHex, entry);
    }

    await subscribeToAll();
  }

  async function addPlanet(discovered: DiscoveredPlanet): Promise<void> {
    const hex = hashToHex(discovered.hash);
    if (planets.has(hex)) return;

    const entry: PlanetEntry = {
      discovery: discovered,
      encrypted: null,
      decrypted: null,
      hashHex: hex,
    };

    planets.set(hex, entry);
    await persistEntry(entry);
    await fetchOnChainState(entry);
    await subscribeToAll();
  }

  async function addPlanets(discovered: DiscoveredPlanet[]): Promise<void> {
    let added = false;
    for (const d of discovered) {
      const hex = hashToHex(d.hash);
      if (planets.has(hex)) continue;

      const entry: PlanetEntry = {
        discovery: d,
        encrypted: null,
        decrypted: null,
        hashHex: hex,
      };
      planets.set(hex, entry);
      persistEntry(entry); // fire and forget
      added = true;
    }

    if (added) {
      await fetchAllOnChainStates();
      await subscribeToAll();
    }
  }

  function getPlanet(hashHex: string): PlanetEntry | undefined {
    return planets.get(hashHex);
  }

  function getPlanetByHash(hash: Uint8Array): PlanetEntry | undefined {
    return planets.get(hashToHex(hash));
  }

  function removePlanet(hashHex: string): void {
    planets.delete(hashHex);
  }

  async function refreshAll(): Promise<void> {
    await fetchAllOnChainStates();
  }

  function destroy(): void {
    cleanupSubscriptions();
    planets.clear();
    gameId = null;
  }

  return {
    planets,
    count,
    all,
    ownedBy,
    init,
    addPlanet,
    addPlanets,
    getPlanet,
    getPlanetByHash,
    removePlanet,
    refreshAll,
    destroy,
  };
}
