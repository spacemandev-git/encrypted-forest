/**
 * Benchmark: Planet Discovery Hash Performance
 *
 * Measures how long it takes to scan coordinates and discover planets
 * using the same BLAKE3 hashing algorithm as the on-chain program.
 *
 * Supports variable difficulty via iterated hashing rounds:
 *   hash_0 = blake3(x || y || game_id)
 *   hash_n = blake3(hash_{n-1})
 *   planet_hash = hash_rounds
 *
 * On-chain verification cost estimate:
 *   - BLAKE3 on Solana BPF ≈ 1,500–3,000 CU per hash (24–32 byte input)
 *   - Max compute budget per tx: 1,400,000 CU
 *   - Practical max rounds ≈ 400–800 (leaving room for account reads + logic)
 *   - Conservative safe max: ~300 rounds
 *
 * Usage:
 *   bun run scripts/benchmark-discovery.ts [--size N] [--rounds N] [--gameId N]
 */

import { blake3 } from "@noble/hashes/blake3.js";

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
}

const defaults: BenchConfig = {
  mapRadius: 50,
  rounds: 1,
  gameId: 1n,
  deadSpaceThreshold: 204, // ~80% dead space (204/256)
};

// ---------------------------------------------------------------------------
// Core hash function (matches on-chain compute_planet_hash + iterated rounds)
// ---------------------------------------------------------------------------

function computePlanetHashWithDifficulty(
  x: bigint,
  y: bigint,
  gameId: bigint,
  rounds: number
): Uint8Array {
  // Initial hash: blake3(x:i64 LE || y:i64 LE || gameId:u64 LE)
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  view.setBigInt64(0, x, true);
  view.setBigInt64(8, y, true);
  view.setBigUint64(16, gameId, true);

  let hash = blake3(new Uint8Array(buf));

  // Iterated rounds: hash_n = blake3(hash_{n-1})
  for (let r = 1; r < rounds; r++) {
    hash = blake3(hash);
  }

  return hash;
}

// ---------------------------------------------------------------------------
// Scan and benchmark
// ---------------------------------------------------------------------------

function runBenchmark(config: BenchConfig) {
  const { mapRadius, rounds, gameId, deadSpaceThreshold } = config;
  const diameter = 2 * mapRadius + 1;
  const totalCoords = diameter * diameter;

  console.log("=== Encrypted Forest Discovery Benchmark ===\n");
  console.log(`Map radius:          ${mapRadius} (${diameter}x${diameter} = ${totalCoords.toLocaleString()} coordinates)`);
  console.log(`Hash rounds:         ${rounds}`);
  console.log(`Game ID:             ${gameId}`);
  console.log(`Dead space threshold: ${deadSpaceThreshold}/256 (${((deadSpaceThreshold / 256) * 100).toFixed(1)}% dead space)\n`);

  // Estimate on-chain cost
  const cuPerHash = 2000; // conservative estimate for BLAKE3 on BPF
  const cuPerVerification = cuPerHash * rounds;
  const maxCU = 1_400_000;
  const accountOverhead = 50_000; // account reads, deserialization, etc.
  const availableCU = maxCU - accountOverhead;
  const fitsInTx = cuPerVerification <= availableCU;

  console.log(`--- On-chain verification estimate ---`);
  console.log(`CU per hash:         ~${cuPerHash}`);
  console.log(`CU for ${rounds} round(s):   ~${cuPerVerification.toLocaleString()}`);
  console.log(`Max CU per tx:       ${maxCU.toLocaleString()} (${accountOverhead.toLocaleString()} overhead)`);
  console.log(`Fits in single tx:   ${fitsInTx ? "YES" : "NO"} (${((cuPerVerification / availableCU) * 100).toFixed(1)}% of budget)`);
  if (!fitsInTx) {
    console.log(`  ⚠ Reduce rounds to ≤${Math.floor(availableCU / cuPerHash)} to fit in a single transaction`);
  }
  console.log();

  // Run the scan
  let planetsFound = 0;
  let totalHashes = 0;

  const startTime = performance.now();

  for (let yi = -mapRadius; yi <= mapRadius; yi++) {
    for (let xi = -mapRadius; xi <= mapRadius; xi++) {
      const hash = computePlanetHashWithDifficulty(
        BigInt(xi),
        BigInt(yi),
        gameId,
        rounds
      );
      totalHashes++;

      if (hash[0] >= deadSpaceThreshold) {
        planetsFound++;
      }
    }
  }

  const endTime = performance.now();
  const elapsedMs = endTime - startTime;
  const elapsedSec = elapsedMs / 1000;
  const hashesPerSec = totalHashes / elapsedSec;
  const coordsPerSec = totalCoords / elapsedSec;
  const msPerCoord = elapsedMs / totalCoords;
  const blake3Calls = totalHashes * rounds;
  const blake3PerSec = blake3Calls / elapsedSec;

  console.log(`--- Results ---`);
  console.log(`Total coordinates:   ${totalCoords.toLocaleString()}`);
  console.log(`Planets found:       ${planetsFound.toLocaleString()} (${((planetsFound / totalCoords) * 100).toFixed(2)}%)`);
  console.log(`Time elapsed:        ${elapsedMs.toFixed(2)} ms (${elapsedSec.toFixed(3)} s)`);
  console.log(`Coords/sec:          ${coordsPerSec.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
  console.log(`ms/coord:            ${msPerCoord.toFixed(6)}`);
  console.log(`BLAKE3 calls total:  ${blake3Calls.toLocaleString()} (${rounds} per coord)`);
  console.log(`BLAKE3 calls/sec:    ${blake3PerSec.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
  console.log();

  // Project to larger map sizes
  console.log(`--- Projections (at current speed) ---`);
  const projections = [100, 500, 1000, 5000, 10000];
  for (const r of projections) {
    const d = 2 * r + 1;
    const n = d * d;
    const projMs = n * msPerCoord;
    const projSec = projMs / 1000;
    const projPlanets = Math.round(n * (planetsFound / totalCoords));
    let timeStr: string;
    if (projSec < 1) {
      timeStr = `${projMs.toFixed(1)} ms`;
    } else if (projSec < 60) {
      timeStr = `${projSec.toFixed(2)} s`;
    } else if (projSec < 3600) {
      timeStr = `${(projSec / 60).toFixed(1)} min`;
    } else if (projSec < 86400) {
      timeStr = `${(projSec / 3600).toFixed(1)} hours`;
    } else {
      timeStr = `${(projSec / 86400).toFixed(1)} days`;
    }
    console.log(`  radius=${String(r).padStart(5)}: ${n.toLocaleString().padStart(13)} coords → ~${projPlanets.toLocaleString().padStart(10)} planets in ${timeStr}`);
  }
}

// ---------------------------------------------------------------------------
// Difficulty sweep mode
// ---------------------------------------------------------------------------

function runDifficultySweep(config: BenchConfig) {
  const roundsList = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
  const sampleSize = 10_000;
  const gameId = config.gameId;

  console.log("=== Difficulty Sweep ===\n");
  console.log(`Sample size: ${sampleSize.toLocaleString()} coordinates per round count`);
  console.log(`Game ID: ${gameId}\n`);
  console.log(`${"Rounds".padStart(8)} | ${"Time (ms)".padStart(10)} | ${"ms/coord".padStart(10)} | ${"BLAKE3/s".padStart(12)} | ${"Est CU".padStart(10)} | Fits TX?`);
  console.log("-".repeat(78));

  const cuPerHash = 2000;
  const maxAvailable = 1_350_000;

  for (const rounds of roundsList) {
    const start = performance.now();
    for (let i = 0; i < sampleSize; i++) {
      computePlanetHashWithDifficulty(BigInt(i), BigInt(i >> 8), gameId, rounds);
    }
    const elapsed = performance.now() - start;
    const msPerCoord = elapsed / sampleSize;
    const blake3PerSec = (sampleSize * rounds) / (elapsed / 1000);
    const estCU = cuPerHash * rounds;
    const fits = estCU <= maxAvailable;

    console.log(
      `${String(rounds).padStart(8)} | ${elapsed.toFixed(2).padStart(10)} | ${msPerCoord.toFixed(6).padStart(10)} | ${blake3PerSec.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",").padStart(12)} | ${estCU.toLocaleString().padStart(10)} | ${fits ? "YES" : "NO "} (${((estCU / maxAvailable) * 100).toFixed(0)}%)`
    );
  }

  console.log();
  console.log(`Max safe rounds for on-chain verification: ~${Math.floor(maxAvailable / cuPerHash)}`);
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
  --sweep              Run difficulty sweep instead of single benchmark
  -h, --help           Show this help

Examples:
  bun run scripts/benchmark-discovery.ts                   # Default: 101x101, 1 round
  bun run scripts/benchmark-discovery.ts -s 500 -r 10      # 1001x1001, 10 rounds
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
  runBenchmark(config);
}
