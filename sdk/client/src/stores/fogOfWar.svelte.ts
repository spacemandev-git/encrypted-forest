/**
 * Reactive fog of war / exploration store.
 *
 * Manages exploration state: which coordinates have been scanned,
 * which regions explored, and provides methods for scanning.
 * Uses core SDK noise functions for client-side scanning.
 */

import { SvelteSet } from "svelte/reactivity";
import type { EncryptedForestClient, DiscoveredPlanet } from "@encrypted-forest/core";
import type { NoiseThresholds } from "@encrypted-forest/core";
import type { PlanetsStore } from "./planets.svelte.js";
import {
  saveScanProgress,
  getScanProgress,
  type ScanProgressEntry,
} from "../persistence/db.js";

/**
 * Key for a coordinate: "x,y"
 */
function coordKey(x: bigint, y: bigint): string {
  return `${x},${y}`;
}

export class FogOfWarStore {
  #client: EncryptedForestClient;
  #planetsStore: PlanetsStore;
  #gameId: bigint | null = null;
  #thresholds: NoiseThresholds | null = null;

  /** Set of explored coordinate keys ("x,y") */
  exploredCoords = new SvelteSet<string>();

  /** Whether a scan is in progress */
  scanning = $state(false);

  /** Number of coordinates explored */
  exploredCount = $derived(this.exploredCoords.size);

  /** Last scan result */
  lastScanResults = $state<DiscoveredPlanet[]>([]);

  constructor(client: EncryptedForestClient, planetsStore: PlanetsStore) {
    this.#client = client;
    this.#planetsStore = planetsStore;
  }

  /**
   * Initialize with game parameters.
   */
  async init(
    gameId: bigint,
    thresholds: NoiseThresholds
  ): Promise<void> {
    this.#gameId = gameId;
    this.#thresholds = thresholds;

    // Load scan progress from IndexedDB
    const progress = await getScanProgress(gameId.toString());
    if (progress) {
      // Mark previously explored regions
      for (const region of progress.scannedRegions) {
        const sx = BigInt(region.startX);
        const sy = BigInt(region.startY);
        const ex = BigInt(region.endX);
        const ey = BigInt(region.endY);
        for (let y = sy; y <= ey; y++) {
          for (let x = sx; x <= ex; x++) {
            this.exploredCoords.add(coordKey(x, y));
          }
        }
      }
    }
  }

  /**
   * Scan a single coordinate.
   * Returns the discovered planet if one exists, null otherwise.
   */
  scanCoordinate(x: bigint, y: bigint): DiscoveredPlanet | null {
    if (!this.#gameId || !this.#thresholds) {
      throw new Error("FogOfWarStore not initialized");
    }

    this.exploredCoords.add(coordKey(x, y));

    const result = this.#client.discoverCoordinate(
      x,
      y,
      this.#gameId,
      this.#thresholds
    );

    if (result) {
      // Auto-add to planets store (fire and forget)
      this.#planetsStore.addPlanet(result);
    }

    return result;
  }

  /**
   * Scan a rectangular range of coordinates.
   * Returns all discovered planets in the range.
   */
  async scanRange(
    startX: bigint,
    startY: bigint,
    endX: bigint,
    endY: bigint
  ): Promise<DiscoveredPlanet[]> {
    if (!this.#gameId || !this.#thresholds) {
      throw new Error("FogOfWarStore not initialized");
    }

    this.scanning = true;

    try {
      // Mark all coordinates as explored
      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          this.exploredCoords.add(coordKey(x, y));
        }
      }

      // Discover planets
      const results = this.#client.discoverRange(
        startX,
        startY,
        endX,
        endY,
        this.#gameId,
        this.#thresholds
      );

      this.lastScanResults = results;

      // Auto-add to planets store
      if (results.length > 0) {
        await this.#planetsStore.addPlanets(results);
      }

      // Persist scan progress
      await this.#saveScanRegion(startX, startY, endX, endY);

      return results;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Check if a coordinate has been explored.
   */
  isExplored(x: bigint, y: bigint): boolean {
    return this.exploredCoords.has(coordKey(x, y));
  }

  /**
   * Find a valid spawn planet by scanning.
   */
  findSpawnPlanet(
    mapDiameter?: number,
    maxAttempts?: number
  ): DiscoveredPlanet | null {
    if (!this.#gameId || !this.#thresholds) {
      throw new Error("FogOfWarStore not initialized");
    }

    try {
      const scanned = this.#client.findSpawnPlanet(
        this.#gameId,
        this.#thresholds,
        mapDiameter,
        maxAttempts
      );

      this.exploredCoords.add(coordKey(scanned.x, scanned.y));

      if (scanned.properties) {
        const discovered = this.#client.discoverCoordinate(
          scanned.x,
          scanned.y,
          this.#gameId,
          this.#thresholds
        );
        if (discovered) {
          this.#planetsStore.addPlanet(discovered);
          return discovered;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Handle a broadcast event by revealing the planet coordinates.
   */
  revealPlanet(
    x: bigint,
    y: bigint,
    expectedHash?: Uint8Array
  ): DiscoveredPlanet | null {
    if (!this.#gameId || !this.#thresholds) return null;

    this.exploredCoords.add(coordKey(x, y));

    const result = this.#client.revealPlanet(
      x,
      y,
      this.#gameId,
      this.#thresholds,
      expectedHash
    );

    if (result) {
      this.#planetsStore.addPlanet(result);
    }

    return result;
  }

  /**
   * Clear all exploration state.
   */
  clear(): void {
    this.exploredCoords.clear();
    this.lastScanResults = [];
  }

  /**
   * Clean up.
   */
  destroy(): void {
    this.clear();
    this.#gameId = null;
    this.#thresholds = null;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  async #saveScanRegion(
    startX: bigint,
    startY: bigint,
    endX: bigint,
    endY: bigint
  ): Promise<void> {
    if (!this.#gameId) return;

    const gameIdStr = this.#gameId.toString();
    const existing = await getScanProgress(gameIdStr);

    const regions = existing?.scannedRegions ?? [];
    regions.push({
      startX: startX.toString(),
      startY: startY.toString(),
      endX: endX.toString(),
      endY: endY.toString(),
    });

    const entry: ScanProgressEntry = {
      gameId: gameIdStr,
      scannedRegions: regions,
      lastScanTimestamp: Date.now(),
    };

    await saveScanProgress(entry);
  }
}

/**
 * Create a reactive fog of war store.
 */
export function createFogOfWarStore(
  client: EncryptedForestClient,
  planetsStore: PlanetsStore
): FogOfWarStore {
  return new FogOfWarStore(client, planetsStore);
}
