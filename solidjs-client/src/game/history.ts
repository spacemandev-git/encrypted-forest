/**
 * Game history persistence — stores recently joined/created games in IndexedDB
 * so the player can quickly rejoin from the UI.
 */

import { openDB, type IDBPDatabase } from "idb";

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const DB_NAME = "ef-game-history";
const DB_VERSION = 1;
const STORE_NAME = "games";

export interface RecentGame {
  /** Composite key: `${gameId}:${walletPubkey}` */
  id: string;
  gameId: string;
  walletPubkey: string;
  label: string;
  joinedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("walletPubkey", "walletPubkey", { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function saveRecentGame(
  gameId: bigint,
  walletPubkey: string,
  label?: string,
): Promise<void> {
  const db = await getDB();
  const gidStr = gameId.toString();
  const id = `${gidStr}:${walletPubkey}`;

  const entry: RecentGame = {
    id,
    gameId: gidStr,
    walletPubkey,
    label: label ?? `Game ${gidStr}`,
    joinedAt: Date.now(),
  };

  await db.put(STORE_NAME, entry);
}

export async function getRecentGames(
  walletPubkey: string,
): Promise<RecentGame[]> {
  const db = await getDB();
  const all: RecentGame[] = await db.getAllFromIndex(
    STORE_NAME,
    "walletPubkey",
    walletPubkey,
  );
  // Sort newest first
  all.sort((a, b) => b.joinedAt - a.joinedAt);
  return all;
}

export async function removeRecentGame(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}
