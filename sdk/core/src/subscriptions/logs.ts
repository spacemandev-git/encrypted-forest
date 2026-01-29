/**
 * RPC websocket subscriptions for program logs and events.
 *
 * Uses @solana/web3.js connection.onLogs() to subscribe to
 * program log events (MoveEvent, UpgradeEvent, BroadcastEvent, etc.)
 */

import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import type { Subscription } from "./accounts.js";

/**
 * Subscribe to all logs from the Encrypted Forest program.
 *
 * Logs include emitted events (MoveEvent, UpgradeEvent, BroadcastEvent,
 * SpawnResultEvent, PlanetKeyEvent, CombatResultEvent).
 */
export function subscribeToGameLogs(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId: PublicKey = new PublicKey(
    "4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c"
  ),
  commitment: Commitment = "confirmed"
): Subscription {
  const id = connection.onLogs(
    programId,
    (logInfo) => {
      if (logInfo.err) return;
      callback({
        signature: logInfo.signature,
        logs: logInfo.logs,
      });
    },
    commitment
  );

  return {
    id,
    remove: () => connection.removeOnLogsListener(id),
  };
}

/**
 * Subscribe specifically to broadcast events.
 * Filters logs for BroadcastEvent emissions.
 */
export function subscribeToBroadcasts(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  return subscribeToGameLogs(
    connection,
    (logInfo) => {
      // Anchor events are base64-encoded in logs prefixed with "Program data:"
      const hasBroadcast = logInfo.logs.some(
        (log) => log.includes("Program data:") || log.includes("BroadcastEvent")
      );
      if (hasBroadcast) {
        callback(logInfo);
      }
    },
    programId,
    commitment
  );
}

/**
 * Subscribe specifically to move events.
 */
export function subscribeToMoveEvents(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  return subscribeToGameLogs(
    connection,
    (logInfo) => {
      const hasMove = logInfo.logs.some(
        (log) => log.includes("Program data:") || log.includes("MoveEvent")
      );
      if (hasMove) {
        callback(logInfo);
      }
    },
    programId,
    commitment
  );
}
