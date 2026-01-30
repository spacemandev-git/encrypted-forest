/**
 * Initialize all 5 computation definitions for the Encrypted Forest program.
 *
 * Must run after program deployment and MXE initialization.
 * Idempotent — safe to re-run (skips already-initialized comp defs).
 *
 * Requires:
 *   - ARCIUM_CLUSTER_OFFSET env var (default: 0 for localnet)
 *   - CIRCUIT_BASE_URL env var (e.g. https://s3.spacerisk.io/spacerisk)
 *   - Program deployed to the address in the IDL
 *   - MXE initialized for the program
 *
 * Usage:
 *   bun run scripts/init-comp-defs.ts
 */

import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgramId,
} from "@arcium-hq/client";

import idlJson from "../target/idl/encrypted_forest.json";

const PROJECT_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";
// MXE authority keypair — must match the keypair used during arcium init-mxe
const WALLET_PATH = process.env.ADMIN_KEYPAIR || `${PROJECT_ROOT}/admin.json`;
const CIRCUIT_BASE_URL = process.env.CIRCUIT_BASE_URL || "https://s3.spacerisk.io/spacerisk";

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const adminRaw = JSON.parse(readFileSync(WALLET_PATH, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminRaw));
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });

  const program = new Program(idlJson as any, provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const arciumProgram = getArciumProgramId();

  const compDefNames = [
    "init_planet",
    "init_spawn_planet",
    "process_move",
    "flush_planet",
    "upgrade_planet",
  ];

  const methodNames = [
    "initCompDefInitPlanet",
    "initCompDefInitSpawnPlanet",
    "initCompDefProcessMove",
    "initCompDefFlushPlanet",
    "initCompDefUpgradePlanet",
  ] as const;

  console.log(`Program ID: ${program.programId.toString()}`);
  console.log(`Circuit base URL: ${CIRCUIT_BASE_URL}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log("");

  for (let i = 0; i < compDefNames.length; i++) {
    const offsetBytes = getCompDefAccOffset(compDefNames[i]);
    const offsetU32 = Buffer.from(offsetBytes).readUInt32LE();
    const compDefAddress = getCompDefAccAddress(program.programId, offsetU32);

    try {
      await (program.methods as any)
        [methodNames[i]](CIRCUIT_BASE_URL)
        .accounts({
          payer: admin.publicKey,
          mxeAccount,
          compDefAccount: compDefAddress,
          arciumProgram,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc({ commitment: "confirmed" });
      console.log(`  ✓ Initialized: ${compDefNames[i]}`);
    } catch (e: any) {
      const msg = e.message?.substring(0, 120) || "unknown error";
      console.log(`  - Skipped ${compDefNames[i]} (${msg})`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
