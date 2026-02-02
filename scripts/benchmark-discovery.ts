/**
 * Benchmark: Planet Discovery Hash Performance
 *
 * Measures how long it takes to scan coordinates and discover planets
 * using SHA3-256 for property determination (matching MPC circuit).
 *
 * Supports variable difficulty via iterated hashing rounds:
 *   hash_0 = sha3_256(x || y || game_id || padding)
 *   hash_n = sha3_256(hash_{n-1})
 *   property_hash = hash_rounds
 *
 * On-chain verification cost estimate:
 *   - SHA3-256 in Arcis MPC has fixed cost per round
 *   - Max rounds in MPC circuit: 200 (MAX_HASH_ROUNDS)
 *   - Start with 1 round and measure circuit weight before increasing
 *
 * Map coordinates are i64 in Rust, so max radius is 9,223,372,036,854,775,807
 * (2^63 - 1). Even a radius of 10 billion only scratches the surface — the
 * coordinate space is effectively infinite for gameplay purposes.
 *
 * Supports multithreaded scanning via Bun Workers. Default runs at 1, 4, and
 * 8 cores to show scaling. Use --cores N to run with a specific thread count.
 *
 * Usage:
 *   bun run scripts/benchmark-discovery.ts [--size N] [--rounds N] [--cores N]
 */

import { sha3_256 } from "@noble/hashes/sha3.js";
import type { WorkerResult, WorkerTask } from "./benchmark-worker.js";
import { availableParallelism } from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface BenchConfig {
  /** Map radius — scans from (-radius, -radius) to (radius, radius). Total coords = (2*radius+1)^2 */
  mapRadius: number;
  /** Number of iterated BLAKE3 rounds. 1 = single hash (current behavior). */
  rounds: number;
  /** Game ID used in the hash input. */
  gameId: bigint;
  /** Threshold for byte[0] — values >= this mean a planet exists. */
  deadSpaceThreshold: number;
  /** Number of worker threads. null = run comparison at 1/4/8. */
  cores: number | null;
}

const defaults: BenchConfig = {
  mapRadius: 50,
  rounds: 1, // matches DEFAULT_HASH_ROUNDS in game config
  gameId: 1n,
  deadSpaceThreshold: 204, // ~80% dead space (204/256)
  cores: null,
};

const I64_MAX = 9_223_372_036_854_775_807n;
const WORKER_URL = new URL("./benchmark-worker.ts", import.meta.url);

// ---------------------------------------------------------------------------
// Single-threaded hash (used for sweep mode + single-core benchmark)
// ---------------------------------------------------------------------------

function computePropertyHashBench(
  x: bigint,
  y: bigint,
  gameId: bigint,
  rounds: number
): Uint8Array {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true);
  view.setBigInt64(8, y, true);
  view.setBigUint64(16, gameId, true);
  // bytes 24..31 are zero (padding)

  let hash = sha3_256(new Uint8Array(buf));
  for (let r = 1; r < rounds; r++) {
    hash = sha3_256(hash);
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Multithreaded scan via Workers
// ---------------------------------------------------------------------------

function runWorkersAsync(
  numCores: number,
  mapRadius: number,
  rounds: number,
  gameId: bigint,
  deadSpaceThreshold: number
): Promise<{ planetsFound: number; coordsProcessed: number; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const yStart = -mapRadius;
    const yEnd = mapRadius;
    const totalRows = yEnd - yStart + 1;
    const rowsPerWorker = Math.ceil(totalRows / numCores);

    let planetsFound = 0;
    let coordsProcessed = 0;
    let completed = 0;
    const workers: Worker[] = [];

    const startTime = performance.now();

    for (let w = 0; w < numCores; w++) {
      const workerYStart = yStart + w * rowsPerWorker;
      const workerYEnd = Math.min(workerYStart + rowsPerWorker - 1, yEnd);

      if (workerYStart > yEnd) {
        // More cores than rows — skip this worker
        completed++;
        if (completed === numCores) {
          resolve({ planetsFound, coordsProcessed, elapsedMs: performance.now() - startTime });
        }
        continue;
      }

      const task: WorkerTask = {
        yStart: workerYStart,
        yEnd: workerYEnd,
        xStart: -mapRadius,
        xEnd: mapRadius,
        rounds,
        gameId: gameId.toString(),
        deadSpaceThreshold,
      };

      const worker = new Worker(WORKER_URL);
      workers.push(worker);

      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        planetsFound += event.data.planetsFound;
        coordsProcessed += event.data.coordsProcessed;
        completed++;
        worker.terminate();

        if (completed === numCores) {
          const elapsedMs = performance.now() - startTime;
          resolve({ planetsFound, coordsProcessed, elapsedMs });
        }
      };

      worker.onerror = (err) => {
        workers.forEach((w) => w.terminate());
        reject(err);
      };

      worker.postMessage(task);
    }
  });
}

// ---------------------------------------------------------------------------
// Single-threaded scan (for cores=1, avoids worker overhead)
// ---------------------------------------------------------------------------

function runSingleThreaded(
  mapRadius: number,
  rounds: number,
  gameId: bigint,
  deadSpaceThreshold: number
): { planetsFound: number; coordsProcessed: number; elapsedMs: number } {
  let planetsFound = 0;
  let coordsProcessed = 0;

  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  const input = new Uint8Array(buf);
  view.setBigUint64(16, gameId, true);
  // bytes 24..31 are zero (padding)

  const startTime = performance.now();

  for (let yi = -mapRadius; yi <= mapRadius; yi++) {
    view.setBigInt64(8, BigInt(yi), true);
    for (let xi = -mapRadius; xi <= mapRadius; xi++) {
      view.setBigInt64(0, BigInt(xi), true);

      let hash = sha3_256(input);
      for (let r = 1; r < rounds; r++) {
        hash = sha3_256(hash);
      }

      coordsProcessed++;
      if (hash[0] >= deadSpaceThreshold) {
        planetsFound++;
      }
    }
  }

  const elapsedMs = performance.now() - startTime;
  return { planetsFound, coordsProcessed, elapsedMs };
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function fmtTime(ms: number): string {
  const sec = ms / 1000;
  if (sec < 1) return `${ms.toFixed(1)} ms`;
  if (sec < 60) return `${sec.toFixed(2)} s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} hours`;
  return `${(sec / 86400).toFixed(1)} days`;
}

function fmtNum(n: number): string {
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------------------------------------------------------------------------
// Print header
// ---------------------------------------------------------------------------

function printHeader(config: BenchConfig) {
  const { mapRadius, rounds, gameId, deadSpaceThreshold } = config;
  const diameter = 2 * mapRadius + 1;
  const totalCoords = diameter * diameter;
  const pct =
    Number((BigInt(mapRadius) * 10_000_000_000n) / I64_MAX) / 100_000_000;

  console.log("=== Encrypted Forest Discovery Benchmark ===\n");
  console.log(
    `Map radius:          ${mapRadius} (${diameter}x${diameter} = ${totalCoords.toLocaleString()} coordinates)`
  );
  console.log(`Rust i64 max radius: 9,223,372,036,854,775,807 (2^63 - 1)`);
  console.log(
    `Using:               ${pct > 0.0001 ? pct.toFixed(8) + "%" : "<0.00000001%"} of coordinate space`
  );
  console.log(`Hash rounds:         ${rounds}`);
  console.log(`Game ID:             ${gameId}`);
  console.log(
    `Dead space threshold: ${deadSpaceThreshold}/256 (${((deadSpaceThreshold / 256) * 100).toFixed(1)}% dead space)`
  );
  console.log(`System cores:        ${availableParallelism()}`);
  console.log();

  // On-chain cost estimate
  const cuPerHash = 2000;
  const cuPerVerification = cuPerHash * rounds;
  const maxCU = 1_400_000;
  const accountOverhead = 50_000;
  const availableCU = maxCU - accountOverhead;
  const fitsInTx = cuPerVerification <= availableCU;

  console.log(`--- MPC circuit estimate ---`);
  console.log(`Max hash rounds in MPC: 200 (MAX_HASH_ROUNDS)`);
  console.log(`Configured rounds:      ${rounds}`);
  console.log(`Note: MPC always evaluates MAX_HASH_ROUNDS iterations;`);
  console.log(`      hash_rounds controls which result is used.`);
  console.log();
}

// ---------------------------------------------------------------------------
// Print results for one core count
// ---------------------------------------------------------------------------

function printResults(
  label: string,
  totalCoords: number,
  rounds: number,
  result: { planetsFound: number; coordsProcessed: number; elapsedMs: number },
  baselineMs?: number
) {
  const { planetsFound, coordsProcessed, elapsedMs } = result;
  const elapsedSec = elapsedMs / 1000;
  const coordsPerSec = coordsProcessed / elapsedSec;
  const msPerCoord = elapsedMs / coordsProcessed;
  const sha3Calls = coordsProcessed * rounds;
  const sha3PerSec = sha3Calls / elapsedSec;
  const speedup = baselineMs ? baselineMs / elapsedMs : undefined;

  console.log(`--- ${label} ---`);
  console.log(
    `Planets found:       ${planetsFound.toLocaleString()} (${((planetsFound / totalCoords) * 100).toFixed(2)}%)`
  );
  console.log(`Time elapsed:        ${fmtTime(elapsedMs)}`);
  console.log(`Coords/sec:          ${fmtNum(coordsPerSec)}`);
  console.log(`ms/coord:            ${msPerCoord.toFixed(6)}`);
  console.log(
    `SHA3 calls/sec:    ${fmtNum(sha3PerSec)} (${sha3Calls.toLocaleString()} total)`
  );
  if (speedup !== undefined) {
    console.log(`Speedup vs 1 core:   ${speedup.toFixed(2)}x`);
  }
  console.log();

  return msPerCoord;
}

// ---------------------------------------------------------------------------
// Print projections
// ---------------------------------------------------------------------------

function printProjections(
  msPerCoord: number,
  planetRatio: number,
  label: string
) {
  console.log(`--- Projections (${label}) ---`);
  const projections = [
    100, 500, 1_000, 5_000, 10_000, 100_000, 1_000_000, 1_000_000_000,
  ];
  for (const r of projections) {
    const d = 2 * r + 1;
    const n = d * d;
    const projMs = n * msPerCoord;
    const projPlanets = Math.round(n * planetRatio);
    console.log(
      `  radius=${String(r).padStart(10)}: ${n.toLocaleString().padStart(22)} coords -> ~${projPlanets.toLocaleString().padStart(19)} planets in ${fmtTime(projMs)}`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Main benchmark (single or multi-core)
// ---------------------------------------------------------------------------

async function runBenchmark(config: BenchConfig) {
  const { mapRadius, rounds, gameId, deadSpaceThreshold, cores } = config;
  const diameter = 2 * mapRadius + 1;
  const totalCoords = diameter * diameter;

  printHeader(config);

  // Determine which core counts to run
  const sysCores = availableParallelism();
  const coreCounts: number[] =
    cores !== null
      ? [cores]
      : [1, Math.min(4, sysCores), Math.min(8, sysCores)].filter(
          (v, i, a) => a.indexOf(v) === i // dedupe if system has < 8 cores
        );

  let baselineMs: number | undefined;
  let lastMsPerCoord = 0;
  let lastPlanetRatio = 0;

  for (const numCores of coreCounts) {
    const label = `${numCores} core${numCores > 1 ? "s" : ""}`;
    let result: {
      planetsFound: number;
      coordsProcessed: number;
      elapsedMs: number;
    };

    if (numCores === 1) {
      result = runSingleThreaded(
        mapRadius,
        rounds,
        gameId,
        deadSpaceThreshold
      );
    } else {
      result = await runWorkersAsync(
        numCores,
        mapRadius,
        rounds,
        gameId,
        deadSpaceThreshold
      );
    }

    lastMsPerCoord = printResults(
      label,
      totalCoords,
      rounds,
      result,
      baselineMs
    );
    lastPlanetRatio = result.planetsFound / totalCoords;

    if (baselineMs === undefined) {
      baselineMs = result.elapsedMs;
    }
  }

  // Print projections using the fastest run
  const fastestLabel =
    coreCounts.length > 1
      ? `${coreCounts[coreCounts.length - 1]} cores`
      : `${coreCounts[0]} core${coreCounts[0] > 1 ? "s" : ""}`;
  printProjections(lastMsPerCoord, lastPlanetRatio, fastestLabel);
}

// ---------------------------------------------------------------------------
// Difficulty sweep mode
// ---------------------------------------------------------------------------

function runDifficultySweep(config: BenchConfig) {
  const roundsList = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
  const sampleSize = 10_000;
  const gameId = config.gameId;

  console.log("=== Difficulty Sweep ===\n");
  console.log(
    `Sample size: ${sampleSize.toLocaleString()} coordinates per round count`
  );
  console.log(`Game ID: ${gameId}\n`);
  console.log(
    `${"Rounds".padStart(8)} | ${"Time (ms)".padStart(10)} | ${"ms/coord".padStart(10)} | ${"SHA3/s".padStart(12)} | ${"Est CU".padStart(10)} | Fits TX?`
  );
  console.log("-".repeat(78));

  const cuPerHash = 2000;
  const maxAvailable = 1_350_000;

  for (const rounds of roundsList) {
    const start = performance.now();
    for (let i = 0; i < sampleSize; i++) {
      computePropertyHashBench(
        BigInt(i),
        BigInt(i >> 8),
        gameId,
        rounds
      );
    }
    const elapsed = performance.now() - start;
    const msPerCoord = elapsed / sampleSize;
    const sha3PerSec = (sampleSize * rounds) / (elapsed / 1000);
    const estCU = cuPerHash * rounds;
    const fits = estCU <= maxAvailable;

    console.log(
      `${String(rounds).padStart(8)} | ${elapsed.toFixed(2).padStart(10)} | ${msPerCoord.toFixed(6).padStart(10)} | ${fmtNum(sha3PerSec).padStart(12)} | ${estCU.toLocaleString().padStart(10)} | ${fits ? "YES" : "NO "} (${((estCU / maxAvailable) * 100).toFixed(0)}%)`
    );
  }

  console.log();
  console.log(
    `Max safe rounds for on-chain verification: ~${Math.floor(maxAvailable / cuPerHash)}`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): { config: BenchConfig; sweep: boolean } {
  const args = process.argv.slice(2);
  const config = { ...defaults };
  let sweep = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--size":
      case "-s":
        config.mapRadius = parseInt(args[++i], 10);
        break;
      case "--rounds":
      case "-r":
        config.rounds = parseInt(args[++i], 10);
        break;
      case "--gameId":
      case "-g":
        config.gameId = BigInt(args[++i]);
        break;
      case "--threshold":
      case "-t":
        config.deadSpaceThreshold = parseInt(args[++i], 10);
        break;
      case "--cores":
      case "-c":
        config.cores = parseInt(args[++i], 10);
        break;
      case "--sweep":
        sweep = true;
        break;
      case "--help":
      case "-h":
        console.log(`Usage: bun run scripts/benchmark-discovery.ts [options]

Options:
  -s, --size <N>       Map radius (default: ${defaults.mapRadius})
                       Scans (2N+1)^2 coordinates
  -r, --rounds <N>     Hash difficulty rounds (default: ${defaults.rounds})
  -g, --gameId <N>     Game ID (default: ${defaults.gameId})
  -t, --threshold <N>  Dead space threshold 0-255 (default: ${defaults.deadSpaceThreshold})
  -c, --cores <N>      Worker thread count (default: compare 1/4/8)
  --sweep              Run difficulty sweep instead of single benchmark
  -h, --help           Show this help

Examples:
  bun run scripts/benchmark-discovery.ts                   # Compare 1/4/8 cores, 101x101
  bun run scripts/benchmark-discovery.ts -s 500 -r 10      # 1001x1001, 10 rounds
  bun run scripts/benchmark-discovery.ts -c 16 -s 1000     # 16 cores, 2001x2001
  bun run scripts/benchmark-discovery.ts --sweep            # Sweep 1-1000 rounds
`);
        process.exit(0);
    }
  }

  return { config, sweep };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { config, sweep } = parseArgs();

if (sweep) {
  runDifficultySweep(config);
} else {
  await runBenchmark(config);
}
