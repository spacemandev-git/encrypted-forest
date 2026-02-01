/**
 * Miner data persistence — stores explored coordinates and discovered planets
 * in IndexedDB, scoped by gameId:walletPubkey.
 */

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "ef-miner-cache";
const DB_VERSION = 1;
const STORE_NAME = "scopes";

export interface SerializedDiscovery {
  x: string;
  y: string;
  hash: number[];
  bodyType: number;
  size: number;
  comets: number[];
}

export interface PersistedMinerData {
  scopeKey: string;
  exploredCoords: string[];
  discoveries: SerializedDiscovery[];
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "scopeKey" });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadMinerData(
  scopeKey: string,
): Promise<PersistedMinerData | null> {
  const db = await getDB();
  const data = await db.get(STORE_NAME, scopeKey);
  return data ?? null;
}

export async function saveMinerData(data: PersistedMinerData): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, data);
}
