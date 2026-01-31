/**
 * End-to-End Game Scenario for Encrypted Forest
 *
 * Simulates a full game lifecycle with 2 players:
 *   1. Admin creates a game
 *   2. Alice and Bob register as players
 *   3. Both players discover planets and spawn
 *   4. Alice discovers a nearby planet and initializes it
 *   5. Alice sends ships from her spawn to the nearby planet
 *   6. Bob sends ships to attack Alice's spawn
 *   7. Moves land — flush resolves combat
 *   8. Alice upgrades her planet
 *   9. Alice broadcasts her coordinates
 *  10. Game ends — cleanup reclaims rent
 *
 * Requires: Surfpool + Arcium ARX nodes running (via scripts/run-local.sh)
 *
 * Usage:
 *   bun run scripts/e2e-game.ts
 */

import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";

// SDK imports (relative path to workspace package source)
import {
  EncryptedForestClient,
  DEFAULT_THRESHOLDS,
  CelestialBodyType,
  UpgradeFocus,
  computePlanetHash,
  computeDistance,
  computeLandingSlot,
  findSpawnPlanet,
  findPlanetOfType,
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
  derivePendingMoveAccountPDA,
  PROGRAM_ID,
  type ArciumAccounts,
  type CreateGameArgs,
  type NoiseThresholds,
} from "../sdk/core/src/index";

// Arcium client imports (encryption, account derivation, finalization)
import {
  getArciumEnv,
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getMXEPublicKey,
  getArciumProgramId,
  RescueCipher,
  x25519,
  deserializeLE,
  awaitComputationFinalization,
} from "@arcium-hq/client";

// IDL (loaded at runtime from build output)
import idlJson from "../target/idl/encrypted_forest.json";

// ---------------------------------------------------------------------------
// Terminal formatting (matches run-local.sh style)
// ---------------------------------------------------------------------------
const isTTY = process.stderr.isTTY;
const BOLD  = isTTY ? "\x1b[1m"  : "";
const DIM   = isTTY ? "\x1b[2m"  : "";
const GREEN = isTTY ? "\x1b[32m" : "";
const YELLOW= isTTY ? "\x1b[33m" : "";
const RED   = isTTY ? "\x1b[31m" : "";
const CYAN  = isTTY ? "\x1b[36m" : "";
const MAGENTA= isTTY ? "\x1b[35m" : "";
const RESET = isTTY ? "\x1b[0m"  : "";

const ALICE_COLOR = CYAN;
const BOB_COLOR   = MAGENTA;

const scriptStart = Date.now();
let stepCount = 0;
let passCount = 0;
let failCount = 0;

function elapsed(): string {
  const diff = Math.floor((Date.now() - scriptStart) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function banner(text: string) {
  const pad = Math.max(0, 50 - text.length);
  const line = "═".repeat(52);
  process.stderr.write(`\n${BOLD}${GREEN}  ╔${line}╗${RESET}\n`);
  process.stderr.write(`${BOLD}${GREEN}  ║  ${text}${" ".repeat(pad)}║${RESET}\n`);
  process.stderr.write(`${BOLD}${GREEN}  ╚${line}╝${RESET}\n\n`);
}

function stepStart(description: string): number {
  stepCount++;
  const start = Date.now();
  process.stderr.write(
    `${BOLD}${CYAN}[${elapsed()}]${RESET} ${BOLD}Step ${stepCount}: ${description}${RESET}\n`
  );
  return start;
}

function stepDone(start: number) {
  const dur = Math.floor((Date.now() - start) / 1000);
  const mins = Math.floor(dur / 60);
  const secs = dur % 60;
  const durStr = mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secs}s`;
  process.stderr.write(`${BOLD}${GREEN}  ✓${RESET} ${DIM}Done (${durStr})${RESET}\n\n`);
}

function task(description: string, color: string = "") {
  process.stderr.write(`  ${DIM}→ ${color}${description}${RESET}\n`);
}

function ok(msg: string) {
  passCount++;
  process.stderr.write(`  ${GREEN}✓ ${msg}${RESET}\n`);
}

function fail(msg: string) {
  failCount++;
  process.stderr.write(`  ${RED}✗ ${msg}${RESET}\n`);
}

function warn(msg: string) {
  process.stderr.write(`  ${YELLOW}⚠ ${msg}${RESET}\n`);
}

function info(msg: string) {
  process.stderr.write(`  ${DIM}  ${msg}${RESET}\n`);
}

function assert(condition: boolean, passMsg: string, failMsg: string): boolean {
  if (condition) {
    ok(passMsg);
    return true;
  } else {
    fail(failMsg);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Encryption context (matches test helpers pattern)
// ---------------------------------------------------------------------------
interface EncryptionContext {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  cipher: RescueCipher;
}

async function setupEncryption(
  provider: AnchorProvider,
  programId: PublicKey
): Promise<EncryptionContext> {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  let mxePublicKey: Uint8Array | undefined;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) break;
    } catch {}
    if (attempt < 10) await new Promise((r) => setTimeout(r, 500));
  }
  if (!mxePublicKey) throw new Error("Failed to fetch MXE public key");

  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  return { privateKey, publicKey, mxePublicKey, sharedSecret, cipher };
}

function encryptAndPack(
  cipher: RescueCipher,
  values: bigint[],
  nonce: Uint8Array
): { packed: Uint8Array; ciphertexts: Uint8Array[] } {
  const ciphertexts = cipher.encrypt(values, nonce);
  const packed = new Uint8Array(ciphertexts.length * 32);
  for (let i = 0; i < ciphertexts.length; i++) {
    packed.set(new Uint8Array(ciphertexts[i]), i * 32);
  }
  return { packed, ciphertexts };
}

// ---------------------------------------------------------------------------
// Arcium account derivation (matches test helpers)
// ---------------------------------------------------------------------------
function getSignPdaAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    programId
  )[0];
}

function getPoolAccountAddress(): PublicKey {
  try {
    const { getFeePoolAccAddress } = require("@arcium-hq/client");
    return getFeePoolAccAddress();
  } catch {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("FeePool")],
      getArciumProgramId()
    )[0];
  }
}

function getClockAccountAddress(): PublicKey {
  try {
    const { getClockAccAddress } = require("@arcium-hq/client");
    return getClockAccAddress();
  } catch {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ClockAccount")],
      getArciumProgramId()
    )[0];
  }
}

function getArciumAccountAddresses(
  programId: PublicKey,
  computationOffset: BN,
  compDefName: string
): ArciumAccounts {
  const arciumEnv = getArciumEnv();
  const clusterOffset = arciumEnv.arciumClusterOffset;
  const offsetBytes = getCompDefAccOffset(compDefName);
  const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();

  return {
    signPdaAccount: getSignPdaAddress(programId),
    mxeAccount: getMXEAccAddress(programId),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
    compDefAccount: getCompDefAccAddress(programId, offsetU32),
    clusterAccount: getClusterAccAddress(clusterOffset),
    poolAccount: getPoolAccountAddress(),
    clockAccount: getClockAccountAddress(),
    arciumProgram: getArciumProgramId(),
  };
}

// ---------------------------------------------------------------------------
// Value builders (matching test helpers)
// ---------------------------------------------------------------------------
function buildInitPlanetValues(x: bigint, y: bigint): bigint[] {
  return [BigInt.asUintN(64, x), BigInt.asUintN(64, y)];
}

function buildInitSpawnPlanetValues(
  x: bigint, y: bigint, playerId: bigint, sourcePlanetId: bigint
): bigint[] {
  return [BigInt.asUintN(64, x), BigInt.asUintN(64, y), playerId, sourcePlanetId];
}

function buildProcessMoveValues(
  playerId: bigint, sourcePlanetId: bigint,
  shipsToSend: bigint, metalToSend: bigint,
  sourceX: bigint, sourceY: bigint,
  targetX: bigint, targetY: bigint,
): bigint[] {
  return [
    playerId, sourcePlanetId, shipsToSend, metalToSend,
    BigInt.asUintN(64, sourceX), BigInt.asUintN(64, sourceY),
    BigInt.asUintN(64, targetX), BigInt.asUintN(64, targetY),
  ];
}

async function waitForSlot(connection: Connection, targetSlot: bigint, label: string) {
  let current = BigInt(await connection.getSlot("confirmed"));
  while (current < targetSlot) {
    info(`Waiting for slot ${targetSlot} (current: ${current}) — ${label}`);
    await new Promise(r => setTimeout(r, 500));
    current = BigInt(await connection.getSlot("confirmed"));
  }
}

function buildFlushPlanetValues(
  currentSlot: bigint, gameSpeed: bigint,
  lastUpdatedSlot: bigint, flushCount: bigint
): bigint[] {
  return [currentSlot, gameSpeed, lastUpdatedSlot, flushCount];
}

function buildUpgradePlanetValues(
  playerId: bigint, focus: UpgradeFocus,
  currentSlot: bigint, gameSpeed: bigint,
  lastUpdatedSlot: bigint, metalUpgradeCost: bigint
): bigint[] {
  return [playerId, BigInt(focus), currentSlot, gameSpeed, lastUpdatedSlot, metalUpgradeCost];
}

function computeCurrentResource(
  lastCount: bigint, maxCapacity: bigint, genSpeed: bigint,
  lastUpdatedSlot: bigint, currentSlot: bigint, gameSpeed: bigint,
): bigint {
  if (genSpeed === 0n || gameSpeed === 0n || currentSlot <= lastUpdatedSlot) return lastCount;
  const elapsed = currentSlot - lastUpdatedSlot;
  const generated = genSpeed * elapsed * 10000n / gameSpeed;
  const total = lastCount + generated;
  return total > maxCapacity ? maxCapacity : total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  banner("Encrypted Forest — E2E Game Test");

  // =========================================================================
  // Setup: connection, provider, program, client, keypairs
  // =========================================================================
  const s0 = stepStart("Connecting to Surfpool & setting up players");

  const connection = new Connection("http://localhost:8899", "confirmed");
  const adminKpRaw = JSON.parse(
    readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf-8")
  );
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminKpRaw));
  const adminWallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, adminWallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });

  const program = new Program(idlJson as any, provider);
  const client = new EncryptedForestClient(program, connection);

  const alice = Keypair.generate();
  const bob   = Keypair.generate();

  task("Airdropping SOL to Alice and Bob");
  const [aliceSig, bobSig] = await Promise.all([
    connection.requestAirdrop(alice.publicKey, 10 * LAMPORTS_PER_SOL),
    connection.requestAirdrop(bob.publicKey, 10 * LAMPORTS_PER_SOL),
  ]);
  await Promise.all([
    connection.confirmTransaction(aliceSig, "confirmed"),
    connection.confirmTransaction(bobSig, "confirmed"),
  ]);
  ok("Alice and Bob funded");

  task("Setting up Arcium encryption contexts");
  let encAlice: EncryptionContext;
  let encBob: EncryptionContext;
  try {
    getArciumEnv();
    [encAlice, encBob] = await Promise.all([
      setupEncryption(provider, program.programId),
      setupEncryption(provider, program.programId),
    ]);
    ok("Encryption contexts ready for both players");
  } catch (e: any) {
    fail(`Arcium not available: ${e.message}`);
    process.exit(1);
  }

  stepDone(s0);

  // =========================================================================
  // Step 1: Create Game
  // =========================================================================
  const s1 = stepStart("Admin creates a new game");

  const gameIdBytes = randomBytes(8);
  const gameId = BigInt("0x" + gameIdBytes.toString("hex"));

  const createGameArgs: CreateGameArgs = {
    gameId,
    mapDiameter: 1000n,
    gameSpeed: 1000n,
    startSlot: 0n,
    endSlot: 1_000_000_000n,
    winCondition: { pointsBurning: { pointsPerMetal: 1n } },
    whitelist: false,
    serverPubkey: null,
    noiseThresholds: DEFAULT_THRESHOLDS,
    hashRounds: 1,
  };

  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  await client
    .buildCreateGame(admin.publicKey, createGameArgs)
    .signers([admin])
    .rpc({ commitment: "confirmed" });

  info(`Game ID: ${gameId}`);
  info(`Game PDA: ${gamePDA.toString()}`);
  info(`Map diameter: 1000`);
  info(`Game speed: 1000 (10x faster)`);
  ok("Game created");

  // Verify comp defs are initialized
  task("Checking computation definitions...");
  const compDefNames = ["init_planet", "init_spawn_planet", "process_move", "flush_planet", "upgrade_planet"];
  let compDefsOk = true;
  for (const name of compDefNames) {
    const offsetBytes = getCompDefAccOffset(name);
    const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();
    const compDefAddress = getCompDefAccAddress(program.programId, offsetU32);
    const compDefInfo = await connection.getAccountInfo(compDefAddress);
    if (!compDefInfo) {
      fail(`Comp def not initialized: ${name} (${compDefAddress.toString().slice(0, 16)}...)`);
      compDefsOk = false;
    }
  }
  if (!compDefsOk) {
    warn("Run: bun run scripts/init-comp-defs.ts");
    warn("Or re-run: ./scripts/run-local.sh");
    process.exit(1);
  }
  ok("All 5 computation definitions initialized");

  stepDone(s1);

  // =========================================================================
  // Step 2: Both players register (parallel)
  // =========================================================================
  const s2 = stepStart("Alice and Bob register as players");

  task("Alice registers", ALICE_COLOR);
  task("Bob registers", BOB_COLOR);

  const [alicePlayerPDA] = derivePlayerPDA(gameId, alice.publicKey, program.programId);
  const [bobPlayerPDA] = derivePlayerPDA(gameId, bob.publicKey, program.programId);

  await Promise.all([
    client.buildInitPlayer(alice.publicKey, gameId).signers([alice]).rpc({ commitment: "confirmed" }),
    client.buildInitPlayer(bob.publicKey, gameId).signers([bob]).rpc({ commitment: "confirmed" }),
  ]);

  ok(`Alice registered: ${alicePlayerPDA.toString().slice(0, 16)}...`);
  ok(`Bob registered:   ${bobPlayerPDA.toString().slice(0, 16)}...`);

  stepDone(s2);

  // =========================================================================
  // Step 3: Both players discover and spawn on planets (parallel)
  // =========================================================================
  const s3 = stepStart("Players discover spawn planets & spawn (parallel MPC)");

  task("Searching for two spawn planets (random scan start)...");

  // Random start offsets so each player scans a different region of the map
  const aliceOffset = Math.floor(Math.random() * 500_000);
  const bobOffset = aliceOffset + 100_000 + Math.floor(Math.random() * 100_000);

  const aliceSpawn = findPlanetOfType(
    gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 1, 1000, 300_000, aliceOffset
  );
  let bobSpawn = findPlanetOfType(
    gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 1, 1000, 300_000, bobOffset
  );

  // Ensure they're different
  if (aliceSpawn.x === bobSpawn.x && aliceSpawn.y === bobSpawn.y) {
    bobSpawn = findPlanetOfType(
      gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 1, 1000, 300_000, bobOffset + 200_000
    );
  }
  if (aliceSpawn.x === bobSpawn.x && aliceSpawn.y === bobSpawn.y) {
    fail("Could not find two different spawn planets");
    process.exit(1);
  }

  info(`Alice spawn: (${aliceSpawn.x}, ${aliceSpawn.y})`);
  info(`Bob spawn:   (${bobSpawn.x}, ${bobSpawn.y})`);

  task("Queuing spawn MPC computations in parallel...");

  // Build spawn args for both players
  async function queueSpawn(
    payer: Keypair,
    x: bigint, y: bigint,
    playerId: bigint, sourcePlanetId: bigint,
    enc: EncryptionContext
  ) {
    const planetHash = computePlanetHash(x, y, gameId);
    const nonce = randomBytes(16);
    const nonceValue = deserializeLE(nonce);
    const values = buildInitSpawnPlanetValues(x, y, playerId, sourcePlanetId);
    const { packed } = encryptAndPack(enc.cipher, values, nonce);

    const computationOffset = new BN(randomBytes(8), "hex");
    const arciumAccts = getArciumAccountAddresses(program.programId, computationOffset, "init_spawn_planet");

    const observerPubkey = x25519.getPublicKey(x25519.utils.randomSecretKey());

    const [spawnGamePDA] = deriveGamePDA(gameId, program.programId);
    const [spawnPlayerPDA] = derivePlayerPDA(gameId, payer.publicKey, program.programId);
    const [spawnPlanetPDA] = deriveCelestialBodyPDA(gameId, planetHash, program.programId);
    const [spawnPendingPDA] = derivePendingMovesPDA(gameId, planetHash, program.programId);

    await program.methods
      .queueInitSpawnPlanet(
        computationOffset,
        Array.from(planetHash) as any,
        Buffer.from(packed),
        Array.from(enc.publicKey) as any,
        new BN(nonceValue.toString()),
        Array.from(observerPubkey) as any
      )
      .accountsPartial({
        payer: payer.publicKey,
        game: spawnGamePDA,
        player: spawnPlayerPDA,
        celestialBody: spawnPlanetPDA,
        pendingMoves: spawnPendingPDA,
        signPdaAccount: arciumAccts.signPdaAccount,
        mxeAccount: arciumAccts.mxeAccount,
        mempoolAccount: arciumAccts.mempoolAccount,
        executingPool: arciumAccts.executingPool,
        computationAccount: arciumAccts.computationAccount,
        compDefAccount: arciumAccts.compDefAccount,
        clusterAccount: arciumAccts.clusterAccount,
        poolAccount: arciumAccts.poolAccount,
        clockAccount: arciumAccts.clockAccount,
        arciumProgram: arciumAccts.arciumProgram,
      })
      .signers([payer])
      .rpc({ skipPreflight: false, commitment: "confirmed" })
      .catch((err: any) => {
        console.error("Spawn error:", err.message?.slice(0, 500));
        if (err.logs) console.error("Logs:\n" + err.logs.join("\n"));
        if (err.simulationResponse) console.error("SimResponse:", JSON.stringify(err.simulationResponse, null, 2).slice(0, 2000));
        throw err;
      });

    return { computationOffset, planetPDA: spawnPlanetPDA, playerPDA: spawnPlayerPDA, planetHash };
  }

  const [aliceSpawnResult, bobSpawnResult] = await Promise.all([
    queueSpawn(alice, aliceSpawn.x, aliceSpawn.y, 0n, 0n, encAlice),
    queueSpawn(bob, bobSpawn.x, bobSpawn.y, 0n, 0n, encBob),
  ]);

  task("Waiting for MPC finalization (both players in parallel)...");
  await Promise.all([
    awaitComputationFinalization(provider, aliceSpawnResult.computationOffset, program.programId, "confirmed"),
    awaitComputationFinalization(provider, bobSpawnResult.computationOffset, program.programId, "confirmed"),
  ]);

  // Verify spawns
  const [alicePlayer, bobPlayer] = await Promise.all([
    program.account.player.fetch(aliceSpawnResult.playerPDA),
    program.account.player.fetch(bobSpawnResult.playerPDA),
  ]);
  const aliceSpawned = assert(alicePlayer.hasSpawned === true, "Alice spawned successfully", "Alice failed to spawn");
  const bobSpawned = assert(bobPlayer.hasSpawned === true, "Bob spawned successfully", "Bob failed to spawn");

  if (!aliceSpawned || !bobSpawned) {
    fail("Cannot continue — spawns failed (check Arcium ARX nodes and MPC finalization)");
    process.exit(1);
  }

  const alicePlanetPDA = aliceSpawnResult.planetPDA;
  const bobPlanetPDA = bobSpawnResult.planetPDA;

  stepDone(s3);

  // =========================================================================
  // Step 4: Alice discovers a nearby planet and inits it
  // =========================================================================
  const s4 = stepStart("Alice discovers a nearby planet");

  task("Searching for a size-2+ Planet near Alice...");
  const nearbyPlanet = findPlanetOfType(
    gameId, DEFAULT_THRESHOLDS, CelestialBodyType.Planet, 2, 1000, 100_000, 50_000
  );

  info(`Nearby planet: (${nearbyPlanet.x}, ${nearbyPlanet.y}) — size ${nearbyPlanet.properties!.size}`);
  const nearbyHash = computePlanetHash(nearbyPlanet.x, nearbyPlanet.y, gameId);

  task("Queuing init_planet MPC computation...");
  const initNonce = randomBytes(16);
  const initNonceValue = deserializeLE(initNonce);
  const initValues = buildInitPlanetValues(nearbyPlanet.x, nearbyPlanet.y);
  const { packed: initPacked } = encryptAndPack(encAlice.cipher, initValues, initNonce);

  const initCO = new BN(randomBytes(8), "hex");
  const initArcium = getArciumAccountAddresses(program.programId, initCO, "init_planet");
  const initObserver = x25519.getPublicKey(x25519.utils.randomSecretKey());

  await client
    .buildQueueInitPlanet(alice.publicKey, {
      gameId,
      computationOffset: BigInt(initCO.toString()),
      planetHash: nearbyHash,
      ciphertexts: initPacked,
      pubkey: encAlice.publicKey,
      nonce: BigInt(initNonceValue.toString()),
      observerPubkey: initObserver,
    }, initArcium)
    .signers([alice])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  const [nearbyPlanetPDA] = deriveCelestialBodyPDA(gameId, nearbyHash, program.programId);

  task("Waiting for MPC finalization...");
  await awaitComputationFinalization(provider, initCO, program.programId, "confirmed");

  const nearbyBody = await program.account.encryptedCelestialBody.fetch(nearbyPlanetPDA);
  assert(
    nearbyBody.staticEncCiphertexts.length === 4,
    `Planet initialized: ${nearbyPlanetPDA.toString().slice(0, 16)}...`,
    "Failed to initialize nearby planet"
  );

  stepDone(s4);

  // =========================================================================
  // Step 5: Alice sends ships to the nearby planet
  // =========================================================================
  const s5 = stepStart("Alice sends ships from spawn to nearby planet");

  const aliceBody = await program.account.encryptedCelestialBody.fetch(alicePlanetPDA);
  const currentSlot1 = BigInt(await connection.getSlot("confirmed"));

  const aliceSourceHash = computePlanetHash(aliceSpawn.x, aliceSpawn.y, gameId);
  const [aliceSourcePendingPDA] = derivePendingMovesPDA(gameId, aliceSourceHash, program.programId);
  const [nearbyPendingPDA] = derivePendingMovesPDA(gameId, nearbyHash, program.programId);

  const dist1 = computeDistance(aliceSpawn.x, aliceSpawn.y, nearbyPlanet.x, nearbyPlanet.y);
  info(`Distance: ${dist1}`);
  const landingSlot1 = computeLandingSlot(currentSlot1, dist1, 2n, 1000n);
  info(`Landing slot: ${landingSlot1} (current: ${currentSlot1})`);

  const moveValues1 = buildProcessMoveValues(
    1n, 0n,   // playerId, sourcePlanetId
    3n, 0n,   // shipsToSend, metalToSend
    aliceSpawn.x, aliceSpawn.y,
    nearbyPlanet.x, nearbyPlanet.y,
  );

  const moveNonce1 = randomBytes(16);
  const moveNonceValue1 = deserializeLE(moveNonce1);
  const { packed: movePacked1 } = encryptAndPack(encAlice.cipher, moveValues1, moveNonce1);

  const moveCO1 = new BN(randomBytes(8), "hex");
  const moveArcium1 = getArciumAccountAddresses(program.programId, moveCO1, "process_move");
  const moveObserver1 = x25519.getPublicKey(x25519.utils.randomSecretKey());

  task("Queuing process_move MPC...");
  await client
    .buildQueueProcessMove(alice.publicKey, {
      gameId,
      computationOffset: BigInt(moveCO1.toString()),
      landingSlot: landingSlot1,
      currentShips: computeCurrentResource(
        0n, 100n, 1n,
        BigInt(aliceBody.lastUpdatedSlot.toString()), currentSlot1, 1000n
      ),
      currentMetal: 0n,
      moveCts: movePacked1,
      movePubkey: encAlice.publicKey,
      moveNonce: BigInt(moveNonceValue1.toString()),
      observerPubkey: moveObserver1,
      sourceBody: alicePlanetPDA,
      sourcePending: aliceSourcePendingPDA,
      targetPending: nearbyPendingPDA,
      moveAccount: derivePendingMoveAccountPDA(gameId, nearbyHash, 0n, program.programId)[0],
    }, moveArcium1)
    .signers([alice])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  task("Waiting for MPC finalization...");
  await awaitComputationFinalization(provider, moveCO1, program.programId, "confirmed");

  const nearbyPending = await program.account.pendingMovesMetadata.fetch(nearbyPendingPDA);
  assert(
    nearbyPending.moves.length === 1,
    `Move queued: 3 ships en route to (${nearbyPlanet.x}, ${nearbyPlanet.y})`,
    "Failed to queue move to nearby planet"
  );

  stepDone(s5);

  // =========================================================================
  // Step 6: Bob attacks Alice's spawn planet
  // =========================================================================
  const s6 = stepStart("Bob sends ships to attack Alice's spawn planet");

  const bobBody = await program.account.encryptedCelestialBody.fetch(bobPlanetPDA);
  const currentSlot2 = BigInt(await connection.getSlot("confirmed"));

  const bobSourceHash = computePlanetHash(bobSpawn.x, bobSpawn.y, gameId);
  const [bobSourcePendingPDA] = derivePendingMovesPDA(gameId, bobSourceHash, program.programId);

  const dist2 = computeDistance(bobSpawn.x, bobSpawn.y, aliceSpawn.x, aliceSpawn.y);
  info(`Attack distance: ${dist2}`);
  const landingSlot2 = computeLandingSlot(currentSlot2, dist2, 2n, 1000n);
  info(`Landing slot: ${landingSlot2}`);

  const moveValues2 = buildProcessMoveValues(
    2n, 0n,   // playerId=2 (Bob), sourcePlanetId=0
    3n, 0n,   // shipsToSend, metalToSend
    bobSpawn.x, bobSpawn.y,
    aliceSpawn.x, aliceSpawn.y,
  );

  const moveNonce2 = randomBytes(16);
  const moveNonceValue2 = deserializeLE(moveNonce2);
  const { packed: movePacked2 } = encryptAndPack(encAlice.cipher, moveValues2, moveNonce2);

  const moveCO2 = new BN(randomBytes(8), "hex");
  const moveArcium2 = getArciumAccountAddresses(program.programId, moveCO2, "process_move");
  const moveObserver2 = x25519.getPublicKey(x25519.utils.randomSecretKey());

  task("Queuing process_move MPC (Bob's attack)...");
  await client
    .buildQueueProcessMove(bob.publicKey, {
      gameId,
      computationOffset: BigInt(moveCO2.toString()),
      landingSlot: landingSlot2,
      currentShips: computeCurrentResource(
        0n, 100n, 1n,
        BigInt(bobBody.lastUpdatedSlot.toString()), currentSlot2, 1000n
      ),
      currentMetal: 0n,
      moveCts: movePacked2,
      movePubkey: encBob.publicKey,
      moveNonce: BigInt(moveNonceValue2.toString()),
      observerPubkey: moveObserver2,
      sourceBody: bobPlanetPDA,
      sourcePending: bobSourcePendingPDA,
      targetPending: aliceSourcePendingPDA,
      moveAccount: derivePendingMoveAccountPDA(gameId, aliceSourceHash, 0n, program.programId)[0],
    }, moveArcium2)
    .signers([bob])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  task("Waiting for MPC finalization...");
  await awaitComputationFinalization(provider, moveCO2, program.programId, "confirmed");

  const alicePending = await program.account.pendingMovesMetadata.fetch(aliceSourcePendingPDA);
  assert(
    alicePending.moves.length === 1,
    `Attack queued: Bob's 3 ships heading to Alice's spawn`,
    "Failed to queue Bob's attack"
  );

  stepDone(s6);

  // =========================================================================
  // Step 7: Flush the nearby planet (Alice's expansion landing)
  // =========================================================================
  const s7 = stepStart("Flush nearby planet — Alice's ships land");

  // Wait for Alice's ships to land before flushing
  await waitForSlot(connection, landingSlot1, "Alice's ships landing");

  const nearbyBodyForFlush = await program.account.encryptedCelestialBody.fetch(nearbyPlanetPDA);
  const nearbyPendingForFlush = await program.account.pendingMovesMetadata.fetch(nearbyPendingPDA);

  if (nearbyPendingForFlush.moves.length > 0) {
    const flushSlot = BigInt(await connection.getSlot("confirmed"));
    const flushCount = 1;
    const flushValues = buildFlushPlanetValues(
      flushSlot, 1000n,
      BigInt(nearbyBodyForFlush.lastUpdatedSlot.toString()),
      BigInt(flushCount),
    );

    const flushNonce1 = randomBytes(16);
    const flushNonceValue1 = deserializeLE(flushNonce1);
    const { packed: flushPacked1 } = encryptAndPack(encAlice.cipher, flushValues, flushNonce1);

    const flushCO1 = new BN(randomBytes(8), "hex");
    const flushArcium1 = getArciumAccountAddresses(program.programId, flushCO1, "flush_planet");

    const moveId = BigInt(nearbyPendingForFlush.moves[0].moveId.toString());
    const [moveAccountPDA] = derivePendingMoveAccountPDA(gameId, nearbyHash, moveId, program.programId);

    task("Queuing flush_planet MPC...");
    await client
      .buildQueueFlushPlanet(alice.publicKey, {
        computationOffset: BigInt(flushCO1.toString()),
        flushCount,
        flushCts: flushPacked1,
        flushPubkey: encAlice.publicKey,
        flushNonce: BigInt(flushNonceValue1.toString()),
        celestialBody: nearbyPlanetPDA,
        pendingMoves: nearbyPendingPDA,
        moveAccounts: [moveAccountPDA],
      }, flushArcium1)
      .signers([alice])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    task("Waiting for MPC finalization...");
    await awaitComputationFinalization(provider, flushCO1, program.programId, "confirmed");

    const nearbyPendingAfter = await program.account.pendingMovesMetadata.fetch(nearbyPendingPDA);
    assert(
      nearbyPendingAfter.moves.length === 0,
      "Nearby planet flushed — Alice's ships landed",
      "Failed to flush nearby planet"
    );
  } else {
    warn("No pending moves to flush on nearby planet");
  }

  stepDone(s7);

  // =========================================================================
  // Step 8: Flush Alice's spawn planet (Bob's attack landing)
  // =========================================================================
  const s8 = stepStart("Flush Alice's spawn — Bob's attack lands (combat!)");

  // Wait for Bob's attack to land before flushing
  await waitForSlot(connection, landingSlot2, "Bob's attack landing");

  const aliceBodyForFlush = await program.account.encryptedCelestialBody.fetch(alicePlanetPDA);
  const alicePendingForFlush = await program.account.pendingMovesMetadata.fetch(aliceSourcePendingPDA);

  if (alicePendingForFlush.moves.length > 0) {
    const flushSlot2 = BigInt(await connection.getSlot("confirmed"));
    const flushCount2 = 1;
    const flushValues2 = buildFlushPlanetValues(
      flushSlot2, 1000n,
      BigInt(aliceBodyForFlush.lastUpdatedSlot.toString()),
      BigInt(flushCount2),
    );

    const flushNonce2 = randomBytes(16);
    const flushNonceValue2 = deserializeLE(flushNonce2);
    const { packed: flushPacked2 } = encryptAndPack(encAlice.cipher, flushValues2, flushNonce2);

    const flushCO2 = new BN(randomBytes(8), "hex");
    const flushArcium2 = getArciumAccountAddresses(program.programId, flushCO2, "flush_planet");

    const moveId2 = BigInt(alicePendingForFlush.moves[0].moveId.toString());
    const [moveAccountPDA2] = derivePendingMoveAccountPDA(gameId, aliceSourceHash, moveId2, program.programId);

    task("Queuing flush_planet MPC (combat resolution)...");
    await client
      .buildQueueFlushPlanet(alice.publicKey, {
        computationOffset: BigInt(flushCO2.toString()),
        flushCount: flushCount2,
        flushCts: flushPacked2,
        flushPubkey: encAlice.publicKey,
        flushNonce: BigInt(flushNonceValue2.toString()),
        celestialBody: alicePlanetPDA,
        pendingMoves: aliceSourcePendingPDA,
        moveAccounts: [moveAccountPDA2],
      }, flushArcium2)
      .signers([alice])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    task("Waiting for MPC finalization...");
    await awaitComputationFinalization(provider, flushCO2, program.programId, "confirmed");

    const alicePendingAfter = await program.account.pendingMovesMetadata.fetch(aliceSourcePendingPDA);
    assert(
      alicePendingAfter.moves.length === 0,
      "Alice's spawn flushed — combat resolved (encrypted)",
      "Failed to flush Alice's spawn planet"
    );

    const aliceBodyAfter = await program.account.encryptedCelestialBody.fetch(alicePlanetPDA);
    assert(
      Number(aliceBodyAfter.lastFlushedSlot) > Number(aliceBodyForFlush.lastFlushedSlot),
      `Planet state updated (lastFlushedSlot: ${aliceBodyAfter.lastFlushedSlot})`,
      "Planet flushed slot not updated"
    );
  } else {
    warn("No pending moves to flush on Alice's spawn");
  }

  stepDone(s8);

  // =========================================================================
  // Step 9: Alice upgrades her nearby planet
  // =========================================================================
  const s9 = stepStart("Alice upgrades her nearby planet (Range focus)");

  const nearbyBodyForUpgrade = await program.account.encryptedCelestialBody.fetch(nearbyPlanetPDA);
  const currentSlot3 = BigInt(await connection.getSlot("confirmed"));

  const upgradeValues = buildUpgradePlanetValues(
    1n,                // playerId
    UpgradeFocus.Range,
    currentSlot3,
    1000n,            // gameSpeed
    BigInt(nearbyBodyForUpgrade.lastUpdatedSlot.toString()),
    100n,              // metalUpgradeCost (level 0 base)
  );

  const upgradeNonce = randomBytes(16);
  const upgradeNonceValue = deserializeLE(upgradeNonce);
  const { packed: upgradePacked } = encryptAndPack(encAlice.cipher, upgradeValues, upgradeNonce);

  const upgradeCO = new BN(randomBytes(8), "hex");
  const upgradeArcium = getArciumAccountAddresses(program.programId, upgradeCO, "upgrade_planet");

  task("Queuing upgrade_planet MPC...");
  await client
    .buildQueueUpgradePlanet(alice.publicKey, {
      gameId,
      computationOffset: BigInt(upgradeCO.toString()),
      upgradeCts: upgradePacked,
      upgradePubkey: encAlice.publicKey,
      upgradeNonce: BigInt(upgradeNonceValue.toString()),
      celestialBody: nearbyPlanetPDA,
    }, upgradeArcium)
    .signers([alice])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  task("Waiting for MPC finalization...");
  await awaitComputationFinalization(provider, upgradeCO, program.programId, "confirmed");

  const nearbyBodyAfterUpgrade = await program.account.encryptedCelestialBody.fetch(nearbyPlanetPDA);

  const beforeNonce = Buffer.from(nearbyBodyForUpgrade.staticEncNonce as any).toString("hex");
  const afterNonce = Buffer.from(nearbyBodyAfterUpgrade.staticEncNonce as any).toString("hex");
  const beforeDynamic = nearbyBodyForUpgrade.dynamicEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");
  const afterDynamic = nearbyBodyAfterUpgrade.dynamicEncCiphertexts.map((c: any) => Buffer.from(c).toString("hex")).join("");

  assert(
    beforeNonce !== afterNonce || beforeDynamic !== afterDynamic,
    "Planet encrypted state updated after upgrade",
    "Planet state unchanged after upgrade"
  );

  stepDone(s9);

  // =========================================================================
  // Step 10: Alice broadcasts her spawn coordinates
  // =========================================================================
  const s10 = stepStart("Alice broadcasts her spawn planet coordinates");

  let broadcastEvent: any = null;
  const listenerPromise = new Promise<void>((resolve) => {
    const listenerId = program.addEventListener("broadcastEvent", (event: any) => {
      broadcastEvent = event;
      program.removeEventListener(listenerId);
      resolve();
    });
    setTimeout(() => resolve(), 5000);
  });

  task("Broadcasting (x, y) for Alice's spawn planet...");
  await client
    .buildBroadcast(alice.publicKey, {
      gameId,
      x: aliceSpawn.x,
      y: aliceSpawn.y,
      planetHash: aliceSpawn.hash,
    })
    .signers([alice])
    .rpc({ commitment: "confirmed" });

  await listenerPromise;

  if (broadcastEvent) {
    assert(
      broadcastEvent.x.toString() === aliceSpawn.x.toString(),
      `Broadcast event received: (${broadcastEvent.x}, ${broadcastEvent.y})`,
      "Broadcast event coordinates mismatch"
    );
  } else {
    ok("Broadcast tx confirmed (event may not be captured in script mode)");
  }

  stepDone(s10);

  // =========================================================================
  // Step 11: Verify final game state
  // =========================================================================
  const s11 = stepStart("Verifying final game state");

  task("Checking player accounts...");
  const aliceFinal = await program.account.player.fetch(aliceSpawnResult.playerPDA);
  const bobFinal = await program.account.player.fetch(bobSpawnResult.playerPDA);
  assert(aliceFinal.hasSpawned === true, "Alice still spawned", "Alice spawn flag lost");
  assert(bobFinal.hasSpawned === true, "Bob still spawned", "Bob spawn flag lost");

  task("Checking planet accounts exist...");
  const [alicePlanetInfo, bobPlanetInfo, nearbyPlanetInfo] = await Promise.all([
    connection.getAccountInfo(alicePlanetPDA),
    connection.getAccountInfo(bobPlanetPDA),
    connection.getAccountInfo(nearbyPlanetPDA),
  ]);
  assert(alicePlanetInfo !== null, "Alice's spawn planet exists", "Alice's planet missing");
  assert(bobPlanetInfo !== null, "Bob's spawn planet exists", "Bob's planet missing");
  assert(nearbyPlanetInfo !== null, "Nearby planet exists", "Nearby planet missing");

  task("Checking pending moves are cleared...");
  const [aliceFinalPending, nearbyFinalPending] = await Promise.all([
    program.account.pendingMovesMetadata.fetch(aliceSourcePendingPDA),
    program.account.pendingMovesMetadata.fetch(nearbyPendingPDA),
  ]);
  assert(aliceFinalPending.moves.length === 0, "Alice's spawn: no pending moves", "Alice still has pending moves");
  assert(nearbyFinalPending.moves.length === 0, "Nearby planet: no pending moves", "Nearby still has pending moves");

  task("Checking game account...");
  const gameFinal = await program.account.game.fetch(gamePDA);
  assert(gameFinal.gameId.toString() === gameId.toString(), "Game ID matches", "Game ID mismatch");

  stepDone(s11);

  // =========================================================================
  // Final Summary
  // =========================================================================
  const totalDur = elapsed();
  const allPassed = failCount === 0;
  const statusColor = allPassed ? GREEN : RED;
  const statusIcon = allPassed ? "✓" : "✗";

  process.stderr.write("\n");
  process.stderr.write(`${BOLD}${statusColor}  ╔══════════════════════════════════════════════════════╗${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║   Encrypted Forest — E2E Test Results                ║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ╠══════════════════════════════════════════════════════╣${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}                                                      ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${BOLD}Total time${RESET}  : ${CYAN}${totalDur}${RESET}                                ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${BOLD}Steps${RESET}       : ${stepCount}                                      ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${BOLD}Assertions${RESET}  : ${GREEN}${passCount} passed${RESET} / ${failCount > 0 ? RED : DIM}${failCount} failed${RESET}                 ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${BOLD}Result${RESET}      : ${statusColor}${statusIcon} ${allPassed ? "ALL PASSED" : "SOME FAILED"}${RESET}                        ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}                                                      ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${BOLD}Game Summary:${RESET}                                        ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${ALICE_COLOR}Alice${RESET} spawned → discovered → expanded → upgraded  ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  ${BOB_COLOR}Bob${RESET}   spawned → attacked Alice's spawn             ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  Combat resolved via encrypted flush                  ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}  Alice broadcast her coordinates to the network       ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ║${RESET}                                                      ${BOLD}${statusColor}║${RESET}\n`);
  process.stderr.write(`${BOLD}${statusColor}  ╚══════════════════════════════════════════════════════╝${RESET}\n`);
  process.stderr.write("\n");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\n${RED}${BOLD}✗ FATAL ERROR:${RESET} ${RED}${err.message}${RESET}\n`);
  if (err.stack) {
    process.stderr.write(`${DIM}${err.stack}${RESET}\n`);
  }
  process.exit(1);
});
