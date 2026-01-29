/**
 * Instruction builder: queue_init_spawn_planet
 *
 * Queues an Arcium init_spawn_planet computation to initialize a planet
 * and claim it as the player's spawn point.
 *
 * Encrypted input: Enc<Shared, SpawnInput> = 4 ciphertexts (x, y, player_id, source_planet_id)
 * Plaintext params from Game account are passed by the on-chain program.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueInitSpawnPlanetArgs {
  gameId: bigint;
  computationOffset: bigint;
  planetHash: Uint8Array;
  /** 4 ciphertexts packed as Vec<u8> (4 * 32 = 128 bytes): x, y, player_id, source_planet_id */
  ciphertexts: Uint8Array;
  /** x25519 public key for Enc<Shared, SpawnInput> */
  pubkey: Uint8Array;
  /** Nonce for encryption (u128) */
  nonce: bigint;
  /** Observer x25519 public key */
  observerPubkey: Uint8Array;
}

/**
 * Build a transaction builder for the queue_init_spawn_planet instruction.
 */
export function buildQueueInitSpawnPlanetIx(
  program: Program,
  payer: PublicKey,
  args: QueueInitSpawnPlanetArgs,
  arciumAccounts: ArciumAccounts
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(args.gameId, payer, program.programId);
  const [celestialBodyPDA] = deriveCelestialBodyPDA(
    args.gameId,
    args.planetHash,
    program.programId
  );
  const [pendingMovesPDA] = derivePendingMovesPDA(
    args.gameId,
    args.planetHash,
    program.programId
  );

  return program.methods
    .queueInitSpawnPlanet(
      new BN(args.computationOffset.toString()),
      Array.from(args.planetHash) as any,
      Buffer.from(args.ciphertexts),
      Array.from(args.pubkey) as any,
      new BN(args.nonce.toString()),
      Array.from(args.observerPubkey) as any
    )
    .accounts({
      payer,
      game: gamePDA,
      player: playerPDA,
      celestialBody: celestialBodyPDA,
      pendingMoves: pendingMovesPDA,
      signPdaAccount: arciumAccounts.signPdaAccount,
      mxeAccount: arciumAccounts.mxeAccount,
      mempoolAccount: arciumAccounts.mempoolAccount,
      executingPool: arciumAccounts.executingPool,
      computationAccount: arciumAccounts.computationAccount,
      compDefAccount: arciumAccounts.compDefAccount,
      clusterAccount: arciumAccounts.clusterAccount,
      poolAccount: arciumAccounts.poolAccount,
      clockAccount: arciumAccounts.clockAccount,
      systemProgram: SystemProgram.programId,
      arciumProgram: arciumAccounts.arciumProgram,
    });
}
