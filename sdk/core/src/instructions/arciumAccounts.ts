/**
 * Shared Arcium account interface used by all queue instructions.
 */

import { PublicKey } from "@solana/web3.js";

/**
 * All Arcium MXE accounts required by queue_* instructions.
 */
export interface ArciumAccounts {
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
