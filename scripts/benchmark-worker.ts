/**
 * Worker thread for benchmark-discovery.ts
 * Receives a chunk of the coordinate space and hashes it.
 */

import { blake3 } from "@noble/hashes/blake3.js";

export interface WorkerTask {
  /** Rows this worker should process (inclusive y range) */
  yStart: number;
  yEnd: number;
  /** Full x range */
  xStart: number;
  xEnd: number;
  rounds: number;
  gameId: string; // bigint serialized as string
  deadSpaceThreshold: number;
}

export interface WorkerResult {
  planetsFound: number;
  coordsProcessed: number;
}

declare var self: Worker;

self.onmessage = (event: MessageEvent<WorkerTask>) => {
  const { yStart, yEnd, xStart, xEnd, rounds, gameId, deadSpaceThreshold } =
    event.data;
  const gid = BigInt(gameId);

  let planetsFound = 0;
  let coordsProcessed = 0;

  // Pre-allocate the input buffer once
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  const input = new Uint8Array(buf);
  view.setBigUint64(16, gid, true); // game_id doesn't change

  for (let yi = yStart; yi <= yEnd; yi++) {
    view.setBigInt64(8, BigInt(yi), true); // y changes per row
    for (let xi = xStart; xi <= xEnd; xi++) {
      view.setBigInt64(0, BigInt(xi), true);

      let hash = blake3(input);
      for (let r = 1; r < rounds; r++) {
        hash = blake3(hash);
      }

      coordsProcessed++;
      if (hash[0] >= deadSpaceThreshold) {
        planetsFound++;
      }
    }
  }

  const result: WorkerResult = { planetsFound, coordsProcessed };
  self.postMessage(result);
};
