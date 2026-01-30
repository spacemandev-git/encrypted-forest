/**
 * Reactive fog of war / exploration store (SolidJS).
 *
 * Manages exploration state: which coordinates have been scanned,
 * which regions explored, and provides methods for scanning.
 * Uses core SDK noise functions for client-side scanning.
 */

import { createSignal, createMemo, type Accessor } from "solid-js";
import { ReactiveSet } from "@solid-primitives/set";
import type { EncryptedForestClient, DiscoveredPlanet } from "@encrypted-forest/core";
import type { NoiseThresholds } from "@encrypted-forest/core";
import type { PlanetsStoreAPI } from "./planets.js";
import {
  saveScanProgress,
  getScanProgress,
  type ScanProgressEntry,
} from "../persistence/db.js";

function coordKey(x: bigint, y: bigint): string {
  return `${x},${y}`;
}

export interface FogOfWarStoreAPI {
  exploredCoords: ReactiveSet<string>;
  scanning: Accessor<boolean>;
  exploredCount: Accessor<number>;
  lastScanResults: Accessor<DiscoveredPlanet[]>;
  init: (gameId: bigint, thresholds: NoiseThresholds) => Promise<void>;
  scanCoordinate: (x: bigint, y: bigint) => DiscoveredPlanet | null;
  scanRange: (startX: bigint, startY: bigint, endX: bigint, endY: bigint) => Promise<DiscoveredPlanet[]>;
  isExplored: (x: bigint, y: bigint) => boolean;
  findSpawnPlanet: (mapDiameter?: number, maxAttempts?: number) => DiscoveredPlanet | null;
  revealPlanet: (x: bigint, y: bigint, expectedHash?: Uint8Array) => DiscoveredPlanet | null;
  clear: () => void;
  destroy: () => void;
}

export function createFogOfWarStore(
  client: EncryptedForestClient,
  planetsStore: PlanetsStoreAPI
): FogOfWarStoreAPI {
  const exploredCoords = new ReactiveSet<string>();
  const [scanning, setScanning] = createSignal(false);
  const [lastScanResults, setLastScanResults] = createSignal<DiscoveredPlanet[]>([]);

  let _gameId: bigint | null = null;
  let _thresholds: NoiseThresholds | null = null;

  const exploredCount = createMemo(() => exploredCoords.size);

  async function init(gameId: bigint, thresholds: NoiseThresholds): Promise<void> {
    _gameId = gameId;
    _thresholds = thresholds;

    const progress = await getScanProgress(gameId.toString());
    if (progress) {
      for (const region of progress.scannedRegions) {
        const sx = BigInt(region.startX);
        const sy = BigInt(region.startY);
        const ex = BigInt(region.endX);
        const ey = BigInt(region.endY);
        for (let y = sy; y <= ey; y++) {
          for (let x = sx; x <= ex; x++) {
            exploredCoords.add(coordKey(x, y));
          }
        }
      }
    }
  }

  function scanCoordinate(x: bigint, y: bigint): DiscoveredPlanet | null {
    if (!_gameId || !_thresholds) {
      throw new Error("FogOfWarStore not initialized");
    }

    exploredCoords.add(coordKey(x, y));

    const result = client.discoverCoordinate(x, y, _gameId, _thresholds);

    if (result) {
      planetsStore.addPlanet(result);
    }

    return result;
  }

  async function scanRange(
    startX: bigint,
    startY: bigint,
    endX: bigint,
    endY: bigint
  ): Promise<DiscoveredPlanet[]> {
    if (!_gameId || !_thresholds) {
      throw new Error("FogOfWarStore not initialized");
    }

    setScanning(true);

    try {
      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          exploredCoords.add(coordKey(x, y));
        }
      }

      const results = client.discoverRange(startX, startY, endX, endY, _gameId, _thresholds);
      setLastScanResults(results);

      if (results.length > 0) {
        await planetsStore.addPlanets(results);
      }

      await saveScanRegion(startX, startY, endX, endY);
      return results;
    } finally {
      setScanning(false);
    }
  }

  function isExplored(x: bigint, y: bigint): boolean {
    return exploredCoords.has(coordKey(x, y));
  }

  function findSpawnPlanet(
    mapDiameter?: number,
    maxAttempts?: number
  ): DiscoveredPlanet | null {
    if (!_gameId || !_thresholds) {
      throw new Error("FogOfWarStore not initialized");
    }

    try {
      const scanned = client.findSpawnPlanet(_gameId, _thresholds, mapDiameter, maxAttempts);
      exploredCoords.add(coordKey(scanned.x, scanned.y));

      if (scanned.properties) {
        const discovered = client.discoverCoordinate(scanned.x, scanned.y, _gameId, _thresholds);
        if (discovered) {
          planetsStore.addPlanet(discovered);
          return discovered;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function revealPlanet(
    x: bigint,
    y: bigint,
    expectedHash?: Uint8Array
  ): DiscoveredPlanet | null {
    if (!_gameId || !_thresholds) return null;

    exploredCoords.add(coordKey(x, y));

    const result = client.revealPlanet(x, y, _gameId, _thresholds, expectedHash);

    if (result) {
      planetsStore.addPlanet(result);
    }

    return result;
  }

  function clear(): void {
    exploredCoords.clear();
    setLastScanResults([]);
  }

  function destroy(): void {
    clear();
    _gameId = null;
    _thresholds = null;
  }

  async function saveScanRegion(
    startX: bigint,
    startY: bigint,
    endX: bigint,
    endY: bigint
  ): Promise<void> {
    if (!_gameId) return;

    const gameIdStr = _gameId.toString();
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

  return {
    exploredCoords,
    scanning,
    exploredCount,
    lastScanResults,
    init,
    scanCoordinate,
    scanRange,
    isExplored,
    findSpawnPlanet,
    revealPlanet,
    clear,
    destroy,
  };
}
