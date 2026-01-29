/**
 * Instruction builder: queue_upgrade_planet
 *
 * Queues an Arcium upgrade_planet computation to level up a Planet-type
 * celestial body. Spends metal and applies stat upgrades based on the
 * chosen focus (Range or LaunchVelocity).
 *
 * Planet state (static + dynamic) is read by MPC nodes directly from
 * celestial_body via .account() -- NOT passed as ciphertexts.
 *
 * Encrypted input: Enc<Shared, UpgradePlanetInput> = 6 ciphertexts:
 *   player_id, focus, current_slot, game_speed, last_updated_slot, metal_upgrade_cost
 */

import { type Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { deriveGamePDA } from "../utils/pda.js";
import type { ArciumAccounts } from "./arciumAccounts.js";

export interface QueueUpgradePlanetArgs {
  gameId: bigint;
  computationOffset: bigint;
  /** 6 ciphertexts packed as Vec<u8> (6 * 32 = 192 bytes) */
  upgradeCts: Uint8Array;
  /** x25519 pubkey for Enc<Shared, UpgradePlanetInput> */
  upgradePubkey: Uint8Array;
  /** Nonce for the upgrade encryption (u128) */
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
