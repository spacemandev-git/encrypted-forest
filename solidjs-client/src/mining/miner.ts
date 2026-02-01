/**
 * Hash Miner — orchestrates multiple Web Workers to scan coordinates
 * in configurable patterns with adjustable chunk size and worker count.
 *
 * Persists explored coordinates and discoveries to IndexedDB so map
 * state survives page refreshes.
 */

import { createSignal, type Accessor } from "solid-js";
import type { NoiseThresholds } from "@encrypted-forest/core";
import type { MineRequest, MineResult } from "./worker.js";
import { getPatternGenerator, type ScanPattern } from "./patterns.js";
import {
  loadMinerData,
  saveMinerData,
  type SerializedDiscovery,
  type PersistedMinerData,
} from "./persistence.js";

export interface MinerConfig {
  /** Number of Web Workers (simulates "cores") */
  workerCount: number;
  /** Coordinates per chunk sent to each worker */
  chunkSize: number;
  /** Scan pattern to use */
  pattern: ScanPattern;
  /** Center X coordinate */
  centerX: number;
  /** Center Y coordinate */
  centerY: number;
  /** Maximum radius to mine */
  maxRadius: number;
}

export interface DiscoveredBody {
  x: bigint;
  y: bigint;
  hash: Uint8Array;
  bodyType: number;
  size: number;
  comets: number[];
}

export interface MinerStats {
  totalHashed: number;
  totalDiscovered: number;
  hashesPerSecond: number;
  elapsed: number;
  running: boolean;
  pattern: ScanPattern;
  workerCount: number;
  chunkSize: number;
}

export interface MinerAPI {
  stats: Accessor<MinerStats>;
  discoveries: Accessor<DiscoveredBody[]>;
  /** All coordinates that have been scanned (including empty space). Keys: "x,y" */
  exploredCoords: ReadonlySet<string>;
  /** Mark a coordinate as explored (e.g. spawn planet) */
  addExploredCoord: (x: number, y: number) => void;
  /** Load persisted map data for a game+wallet scope */
  loadScope: (scopeKey: string) => Promise<void>;
  start: (gameId: bigint, thresholds: NoiseThresholds, hashRounds: number) => void;
  stop: () => void;
  updateConfig: (partial: Partial<MinerConfig>) => void;
  config: Accessor<MinerConfig>;
}

const DEFAULT_CONFIG: MinerConfig = {
  workerCount: navigator.hardwareConcurrency || 4,
  chunkSize: 256,
  pattern: "spiral",
  centerX: 0,
  centerY: 0,
  maxRadius: 500,
};

/** How often to flush to IndexedDB while mining (ms) */
const PERSIST_INTERVAL = 3000;

function serializeDiscovery(d: DiscoveredBody): SerializedDiscovery {
  return {
    x: d.x.toString(),
    y: d.y.toString(),
    hash: Array.from(d.hash),
    bodyType: d.bodyType,
    size: d.size,
    comets: d.comets,
  };
}

function deserializeDiscovery(s: SerializedDiscovery): DiscoveredBody {
  return {
    x: BigInt(s.x),
    y: BigInt(s.y),
    hash: new Uint8Array(s.hash),
    bodyType: s.bodyType,
    size: s.size,
    comets: s.comets,
  };
}

export function createMiner(): MinerAPI {
  const [config, setConfig] = createSignal<MinerConfig>({ ...DEFAULT_CONFIG });
  const [stats, setStats] = createSignal<MinerStats>({
    totalHashed: 0,
    totalDiscovered: 0,
    hashesPerSecond: 0,
    elapsed: 0,
    running: false,
    pattern: DEFAULT_CONFIG.pattern,
    workerCount: DEFAULT_CONFIG.workerCount,
    chunkSize: DEFAULT_CONFIG.chunkSize,
  });
  const [discoveries, setDiscoveries] = createSignal<DiscoveredBody[]>([]);

  let workers: Worker[] = [];
  let running = false;
  let startTime = 0;
  let totalHashed = 0;
  let totalDiscovered = 0;
  let allDiscoveries: DiscoveredBody[] = [];
  let patternGen: Generator<[number, number]> | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;
  let persistInterval: ReturnType<typeof setInterval> | null = null;
  let pendingChunks = 0;
  let currentScopeKey: string | null = null;
  let dirty = false;

  // Track which coords have been hashed across miner sessions
  const hashedCoords = new Set<string>();

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  async function flushToDB(): Promise<void> {
    if (!currentScopeKey || !dirty) return;
    dirty = false;
    const data: PersistedMinerData = {
      scopeKey: currentScopeKey,
      exploredCoords: Array.from(hashedCoords),
      discoveries: allDiscoveries.map(serializeDiscovery),
      updatedAt: Date.now(),
    };
    await saveMinerData(data).catch((err) => {
      console.warn("Failed to persist miner data:", err);
    });
  }

  async function loadScope(scopeKey: string): Promise<void> {
    // Flush any previous scope data first
    if (currentScopeKey && currentScopeKey !== scopeKey) {
      await flushToDB();
    }

    // Clear in-memory state
    hashedCoords.clear();
    allDiscoveries = [];
    totalHashed = 0;
    totalDiscovered = 0;
    dirty = false;

    currentScopeKey = scopeKey;

    // Load from IndexedDB
    const persisted = await loadMinerData(scopeKey);
    if (persisted) {
      for (const coord of persisted.exploredCoords) {
        hashedCoords.add(coord);
      }
      allDiscoveries = persisted.discoveries.map(deserializeDiscovery);
      totalHashed = hashedCoords.size;
      totalDiscovered = allDiscoveries.length;
    }

    // Update reactive signals with loaded data
    setDiscoveries([...allDiscoveries]);
    const cfg = config();
    setStats({
      totalHashed,
      totalDiscovered,
      hashesPerSecond: 0,
      elapsed: 0,
      running: false,
      pattern: cfg.pattern,
      workerCount: cfg.workerCount,
      chunkSize: cfg.chunkSize,
    });
  }

  // -------------------------------------------------------------------------
  // Worker management
  // -------------------------------------------------------------------------

  function spawnWorkers(count: number): Worker[] {
    const ws: Worker[] = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      ws.push(w);
    }
    return ws;
  }

  function feedWorker(
    worker: Worker,
    gameId: bigint,
    thresholds: NoiseThresholds,
    hashRounds: number
  ): boolean {
    if (!patternGen || !running) return false;

    const cfg = config();
    const chunk: [number, number][] = [];

    while (chunk.length < cfg.chunkSize) {
      const next = patternGen.next();
      if (next.done) {
        if (chunk.length === 0) return false;
        break;
      }
      const [x, y] = next.value;
      const key = `${x},${y}`;
      if (!hashedCoords.has(key)) {
        hashedCoords.add(key);
        chunk.push([x, y]);
      }
    }

    if (chunk.length === 0) return false;

    pendingChunks++;

    const req: MineRequest = {
      type: "mine",
      coords: chunk,
      gameId: gameId.toString(),
      thresholds,
      hashRounds,
    };

    worker.postMessage(req);
    return true;
  }

  function start(gameId: bigint, thresholds: NoiseThresholds, hashRounds: number): void {
    if (running) stop();

    const cfg = config();
    running = true;
    startTime = performance.now();
    pendingChunks = 0;

    // Keep existing persisted data — only reset per-session rate counters
    const sessionStartHashed = totalHashed;

    patternGen = getPatternGenerator(cfg.pattern, cfg.centerX, cfg.centerY, cfg.maxRadius);
    workers = spawnWorkers(cfg.workerCount);

    // Set up message handlers
    for (const w of workers) {
      w.onmessage = (e: MessageEvent<MineResult>) => {
        if (e.data.type !== "result") return;

        pendingChunks--;
        totalHashed += e.data.hashed;
        totalDiscovered += e.data.discovered.length;
        dirty = true;

        for (const d of e.data.discovered) {
          allDiscoveries.push({
            x: BigInt(d.x),
            y: BigInt(d.y),
            hash: new Uint8Array(d.hash),
            bodyType: d.bodyType,
            size: d.size,
            comets: d.comets,
          });
        }

        if (e.data.discovered.length > 0) {
          setDiscoveries([...allDiscoveries]);
        }

        // Feed the worker another chunk
        if (running) {
          const fed = feedWorker(w, gameId, thresholds, hashRounds);
          if (!fed && pendingChunks === 0) {
            // All done
            stop();
          }
        }
      };
    }

    // Initial feed — give each worker a chunk
    for (const w of workers) {
      feedWorker(w, gameId, thresholds, hashRounds);
    }

    // Stats update interval
    statsInterval = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      const sessionHashed = totalHashed - sessionStartHashed;
      const hps = elapsed > 0 ? sessionHashed / elapsed : 0;
      const cfg = config();
      setStats({
        totalHashed,
        totalDiscovered,
        hashesPerSecond: Math.round(hps),
        elapsed,
        running,
        pattern: cfg.pattern,
        workerCount: cfg.workerCount,
        chunkSize: cfg.chunkSize,
      });
    }, 250);

    // Periodic persistence flush
    persistInterval = setInterval(() => {
      flushToDB();
    }, PERSIST_INTERVAL);
  }

  function stop(): void {
    running = false;
    for (const w of workers) {
      w.terminate();
    }
    workers = [];
    patternGen = null;

    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    if (persistInterval) {
      clearInterval(persistInterval);
      persistInterval = null;
    }

    // Final stats update
    const elapsed = startTime > 0 ? (performance.now() - startTime) / 1000 : 0;
    const hps = elapsed > 0 ? totalHashed / elapsed : 0;
    const cfg = config();
    setStats({
      totalHashed,
      totalDiscovered,
      hashesPerSecond: Math.round(hps),
      elapsed,
      running: false,
      pattern: cfg.pattern,
      workerCount: cfg.workerCount,
      chunkSize: cfg.chunkSize,
    });

    // Flush to DB on stop
    flushToDB();
  }

  function addExploredCoord(x: number, y: number): void {
    hashedCoords.add(`${x},${y}`);
    dirty = true;
  }

  function updateConfig(partial: Partial<MinerConfig>): void {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  return {
    stats,
    discoveries,
    exploredCoords: hashedCoords as ReadonlySet<string>,
    addExploredCoord,
    loadScope,
    start,
    stop,
    updateConfig,
    config,
  };
}
