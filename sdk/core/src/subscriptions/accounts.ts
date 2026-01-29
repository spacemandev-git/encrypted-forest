/**
 * RPC websocket subscriptions for account changes.
 *
 * Uses @solana/web3.js connection.onAccountChange() to subscribe
 * to real-time account updates.
 */

import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  deriveGamePDA,
  derivePlayerPDA,
  deriveCelestialBodyPDA,
  derivePendingMovesPDA,
} from "../utils/pda.js";

/**
 * Subscription handle. Call remove() to unsubscribe.
 */
export interface Subscription {
  id: number;
  remove: () => void;
}

/**
 * Subscribe to changes on a Game account.
 */
export function subscribeToGame(
  connection: Connection,
  gameId: bigint,
  callback: (accountInfo: any) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  const [gamePDA] = deriveGamePDA(
    gameId,
    programId ?? new PublicKey("4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c")
  );
  const id = connection.onAccountChange(gamePDA, callback, commitment);
  return {
    id,
    remove: () => connection.removeAccountChangeListener(id),
  };
}

/**
 * Subscribe to changes on a Player account.
 */
export function subscribeToPlayer(
  connection: Connection,
  gameId: bigint,
  playerPubkey: PublicKey,
  callback: (accountInfo: any) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  const [playerPDA] = derivePlayerPDA(
    gameId,
    playerPubkey,
    programId ?? new PublicKey("4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c")
  );
  const id = connection.onAccountChange(playerPDA, callback, commitment);
  return {
    id,
    remove: () => connection.removeAccountChangeListener(id),
  };
}

/**
 * Subscribe to changes on a CelestialBody account.
 */
export function subscribeToCelestialBody(
  connection: Connection,
  gameId: bigint,
  planetHash: Uint8Array,
  callback: (accountInfo: any) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  const [planetPDA] = deriveCelestialBodyPDA(
    gameId,
    planetHash,
    programId ?? new PublicKey("4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c")
  );
  const id = connection.onAccountChange(planetPDA, callback, commitment);
  return {
    id,
    remove: () => connection.removeAccountChangeListener(id),
  };
}

/**
 * Subscribe to changes on a PendingMoves account.
 */
export function subscribeToPendingMoves(
  connection: Connection,
  gameId: bigint,
  planetHash: Uint8Array,
  callback: (accountInfo: any) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  const [pendingPDA] = derivePendingMovesPDA(
    gameId,
    planetHash,
    programId ?? new PublicKey("4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c")
  );
  const id = connection.onAccountChange(pendingPDA, callback, commitment);
  return {
    id,
    remove: () => connection.removeAccountChangeListener(id),
  };
}

/**
 * Subscribe to all account changes for a set of known planet hashes.
 * Returns a cleanup function that removes all subscriptions.
 */
export function subscribeToMultiplePlanets(
  connection: Connection,
  gameId: bigint,
  planetHashes: Uint8Array[],
  callback: (planetHash: Uint8Array, accountInfo: any) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): () => void {
  const subs: Subscription[] = [];

  for (const hash of planetHashes) {
    const sub = subscribeToCelestialBody(
      connection,
      gameId,
      hash,
      (info) => callback(hash, info),
      programId,
      commitment
    );
    subs.push(sub);
  }

  return () => {
    for (const sub of subs) {
      sub.remove();
    }
  };
}
