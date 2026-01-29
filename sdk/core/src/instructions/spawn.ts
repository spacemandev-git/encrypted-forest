/**
 * Instruction builder: spawn
 *
 * Queues an Arcium verify_spawn_coordinates computation.
 * The callback finalizes the spawn by marking the player as spawned.
 *
 * After spawn, the player must call create_planet + claim_spawn_planet
 * to initialize their starting planet.
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";

export interface SpawnArgs {
  gameId: bigint;
  computationOffset: bigint;
  /** Encrypted x coordinate (i64 as u64) */
  ciphertextX: Uint8Array;
  /** Encrypted y coordinate (i64 as u64) */
  ciphertextY: Uint8Array;
  /** Encrypted game_id */
  ciphertextGameId: Uint8Array;
  /** Encrypted dead_space_threshold */
  ciphertextDeadSpaceThreshold: Uint8Array;
  /** Encrypted planet_threshold */
  ciphertextPlanetThreshold: Uint8Array;
  /** Encrypted size_threshold_1 */
  ciphertextSizeThreshold1: Uint8Array;
  /** x25519 public key for encryption */
  pubkey: Uint8Array;
  /** Nonce for encryption */
  nonce: bigint;
}

/**
 * Build a transaction builder for the spawn instruction.
 * Requires Arcium MXE accounts to be provided.
 * Call .rpc() or .transaction() on the result.
 */
export function buildSpawnIx(
  program: Program,
  payer: PublicKey,
  args: SpawnArgs,
  arciumAccounts: {
    signPdaAccount: PublicKey;
    mxeAccount: PublicKey;
    mempoolAccount: PublicKey;
    executingPool: PublicKey;
    computationAccount: PublicKey;
    compDefAccount: PublicKey;
    clusterAccount: PublicKey;
    poolAccount: PublicKey;
    clockAccount: PublicKey;
    arciumProgram: PublicKey;
  }
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(args.gameId, payer, program.programId);

  return program.methods
    .spawn(
      new BN(args.computationOffset.toString()),
      Array.from(args.ciphertextX) as any,
      Array.from(args.ciphertextY) as any,
      Array.from(args.ciphertextGameId) as any,
      Array.from(args.ciphertextDeadSpaceThreshold) as any,
      Array.from(args.ciphertextPlanetThreshold) as any,
      Array.from(args.ciphertextSizeThreshold1) as any,
      Array.from(args.pubkey) as any,
      new BN(args.nonce.toString())
    )
    .accounts({
      payer,
      game: gamePDA,
      player: playerPDA,
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

/**
 * Build a transaction builder for create_planet instruction.
 * Called after spawn to create the celestial body account at known coordinates.
 */
export function buildCreatePlanetIx(
  program: Program,
  payer: PublicKey,
  gameId: bigint,
  x: bigint,
  y: bigint,
  planetHash: Uint8Array
) {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [planetPDA] = deriveCelestialBodyPDA(gameId, planetHash, program.programId);
  const [pendingMovesPDA] = derivePendingMovesPDA(gameId, planetHash, program.programId);

  return program.methods
    .createPlanet(
      new BN(gameId.toString()),
      new BN(x.toString()),
      new BN(y.toString()),
      Array.from(planetHash) as any
    )
    .accounts({
      payer,
      game: gamePDA,
      celestialBody: planetPDA,
      pendingMoves: pendingMovesPDA,
      systemProgram: SystemProgram.programId,
    });
}

/**
 * Build a transaction builder for claim_spawn_planet instruction.
 * Called after create_planet to claim ownership of the spawn planet.
 */
export function buildClaimSpawnPlanetIx(
  program: Program,
  owner: PublicKey,
  gameId: bigint,
  planetHash: Uint8Array
) {
  const [gamePDA] = deriveGamePDA(gameId, program.programId);
  const [playerPDA] = derivePlayerPDA(gameId, owner, program.programId);
  const [planetPDA] = deriveCelestialBodyPDA(gameId, planetHash, program.programId);

  return program.methods
    .claimSpawnPlanet(
      new BN(gameId.toString()),
      Array.from(planetHash) as any
    )
    .accounts({
      owner,
      game: gamePDA,
      player: playerPDA,
      celestialBody: planetPDA,
    });
}
