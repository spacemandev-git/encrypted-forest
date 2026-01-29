/**
 * Instruction builder: queue_upgrade_planet
 *
 * Queues an Arcium upgrade_planet computation to level up a Planet-type
 * celestial body. Spends metal and applies stat upgrades based on the
 * chosen focus (Range or LaunchVelocity).
 *
 * state_cts (19 * 32 = 608 bytes): Current encrypted planet state.
 * upgrade_cts (8 * 32 = 256 bytes):
 *   0-3: player_key parts (u64 x4)
 *   4: focus (u8)
 *   5: current_slot (u64)
 *   6: game_speed (u64)
 *   7: last_updated_slot (u64)
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { deriveGamePDA } from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueUpgradePlanetArgs {
  gameId: bigint;
  computationOffset: bigint;
  /** Planet encrypted state (19 * 32 bytes) */
  stateCts: Uint8Array;
  /** x25519 pubkey used to encrypt the state ciphertexts */
  statePubkey: Uint8Array;
  /** Nonce used for the state ciphertexts (u128) */
  stateNonce: bigint;
  /** Upgrade input ciphertexts (8 * 32 bytes) */
  upgradeCts: Uint8Array;
  /** x25519 pubkey used to encrypt the upgrade ciphertexts */
  upgradePubkey: Uint8Array;
  /** Nonce used for the upgrade ciphertexts (u128) */
  upgradeNonce: bigint;
  /** Celestial body account address */
  celestialBody: PublicKey;
}

/**
 * Build a transaction builder for the queue_upgrade_planet instruction.
 */
export function buildQueueUpgradePlanetIx(
  program: Program,
  payer: PublicKey,
  args: QueueUpgradePlanetArgs,
  arciumAccounts: ArciumAccounts
) {
  const [gamePDA] = deriveGamePDA(args.gameId, program.programId);

  return program.methods
    .queueUpgradePlanet(
      new BN(args.computationOffset.toString()),
      Buffer.from(args.stateCts),
      Array.from(args.statePubkey) as any,
      new BN(args.stateNonce.toString()),
      Buffer.from(args.upgradeCts),
      Array.from(args.upgradePubkey) as any,
      new BN(args.upgradeNonce.toString())
    )
    .accounts({
      payer,
      game: gamePDA,
      celestialBody: args.celestialBody,
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
