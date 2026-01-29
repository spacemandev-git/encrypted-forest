/**
 * RPC websocket subscriptions for program logs and events.
 *
 * Uses @solana/web3.js connection.onLogs() to subscribe to
 * program log events (InitPlanetEvent, InitSpawnPlanetEvent,
 * ProcessMoveEvent, FlushPlanetEvent, UpgradePlanetEvent, BroadcastEvent).
 */

import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import type { Subscription } from "./accounts.js";

/**
 * Subscribe to all logs from the Encrypted Forest program.
 *
 * Logs include emitted events (InitPlanetEvent, InitSpawnPlanetEvent,
 * ProcessMoveEvent, FlushPlanetEvent, UpgradePlanetEvent, BroadcastEvent).
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
        (log) =>
          log.includes("Program data:") || log.includes("BroadcastEvent")
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
 * Subscribe specifically to init planet events.
 */
export function subscribeToInitPlanetEvents(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  return subscribeToGameLogs(
    connection,
    (logInfo) => {
      const hasEvent = logInfo.logs.some(
        (log) =>
          log.includes("Program data:") || log.includes("InitPlanetEvent")
      );
      if (hasEvent) {
        callback(logInfo);
      }
    },
    programId,
    commitment
  );
}

/**
 * Subscribe specifically to process move events.
 */
export function subscribeToProcessMoveEvents(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  return subscribeToGameLogs(
    connection,
    (logInfo) => {
      const hasEvent = logInfo.logs.some(
        (log) =>
          log.includes("Program data:") || log.includes("ProcessMoveEvent")
      );
      if (hasEvent) {
        callback(logInfo);
      }
    },
    programId,
    commitment
  );
}

/**
 * Subscribe specifically to flush planet events.
 */
export function subscribeToFlushPlanetEvents(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  return subscribeToGameLogs(
    connection,
    (logInfo) => {
      const hasEvent = logInfo.logs.some(
        (log) =>
          log.includes("Program data:") || log.includes("FlushPlanetEvent")
      );
      if (hasEvent) {
        callback(logInfo);
      }
    },
    programId,
    commitment
  );
}

/**
 * Subscribe specifically to upgrade planet events.
 */
export function subscribeToUpgradePlanetEvents(
  connection: Connection,
  callback: (logs: { signature: string; logs: string[] }) => void,
  programId?: PublicKey,
  commitment: Commitment = "confirmed"
): Subscription {
  return subscribeToGameLogs(
    connection,
    (logInfo) => {
      const hasEvent = logInfo.logs.some(
        (log) =>
          log.includes("Program data:") || log.includes("UpgradePlanetEvent")
      );
      if (hasEvent) {
        callback(logInfo);
      }
    },
    programId,
    commitment
  );
}
