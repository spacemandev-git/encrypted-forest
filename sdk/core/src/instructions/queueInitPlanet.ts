/**
 * Instruction builder: queue_init_planet
 *
 * Queues an Arcium init_planet computation to initialize a new planet
 * with encrypted state. Creates the EncryptedCelestialBody and
 * PendingMovesMetadata accounts.
 *
 * Encrypted input: Enc<Shared, CoordInput> = 2 ciphertexts (x, y)
 * Plaintext params from Game account are passed by the on-chain program.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveGamePDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueInitPlanetArgs {
  gameId: bigint;
  computationOffset: bigint;
  planetHash: Uint8Array;
  /** 2 ciphertexts packed as Vec<u8> (2 * 32 = 64 bytes): x, y */
  ciphertexts: Uint8Array;
  /** x25519 public key for Enc<Shared, CoordInput> */
  pubkey: Uint8Array;
  /** Nonce for encryption (u128) */
  nonce: bigint;
  /** Observer x25519 public key */
  observerPubkey: Uint8Array;
}

/**
 * Build a transaction builder for the queue_init_planet instruction.
 */
export function buildQueueInitPlanetIx(
  program: Program,
  payer: PublicKey,
  args: QueueInitPlanetArgs,
  arciumAccounts: ArciumAccounts
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
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
    .queueInitPlanet(
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
