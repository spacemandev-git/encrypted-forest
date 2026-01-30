/**
 * IndexedDB persistence layer for Encrypted Forest client.
 *
 * Stores discovered planets and decrypted events locally.
 * This is a cache -- chain data is the source of truth.
 * On conflict, chain data always wins.
 *
 * Copied from sdk/client — no framework dependencies.
 */

import { openDB, type IDBPDatabase } from "idb";

// ---------------------------------------------------------------------------
// DB Schema
// ---------------------------------------------------------------------------

const DB_NAME = "encrypted-forest";
const DB_VERSION = 1;

export interface PersistedPlanet {
  hashHex: string;
  x: string;
  y: string;
  gameId: string;
  hash: number[];
  keySeed: number[];
  bodyType: number;
  size: number;
  comets: number[];
  lastFetched: number;
  staticEncPubkey?: number[];
  staticEncNonce?: number[];
  staticEncCiphertexts?: number[];
  dynamicEncPubkey?: number[];
  dynamicEncNonce?: number[];
  dynamicEncCiphertexts?: number[];
}

export interface PersistedEvent {
  id?: number;
  planetHashHex: string;
  eventType: string;
  data: string;
  slot: string;
  timestamp: number;
}

export interface PlayerPreferences {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// DB initialization
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("discoveredPlanets")) {
          db.createObjectStore("discoveredPlanets", { keyPath: "hashHex" });
        }

        if (!db.objectStoreNames.contains("decryptedEvents")) {
          const eventStore = db.createObjectStore("decryptedEvents", {
            keyPath: "id",
            autoIncrement: true,
          });
          eventStore.createIndex("byPlanetHash", "planetHashHex");
          eventStore.createIndex("bySlot", "slot");
        }

        if (!db.objectStoreNames.contains("preferences")) {
          db.createObjectStore("preferences", { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains("scanProgress")) {
          db.createObjectStore("scanProgress", { keyPath: "gameId" });
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Utility: hash to hex
// ---------------------------------------------------------------------------

export function hashToHex(hash: Uint8Array): string {
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToHash(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Discovered Planets CRUD
// ---------------------------------------------------------------------------

export async function persistPlanet(planet: PersistedPlanet): Promise<void> {
  const db = await getDB();
  await db.put("discoveredPlanets", planet);
}

export async function persistPlanets(
  planets: PersistedPlanet[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("discoveredPlanets", "readwrite");
  for (const planet of planets) {
    tx.store.put(planet);
  }
  await tx.done;
}

export async function getPersistedPlanet(
  hashHex: string
): Promise<PersistedPlanet | undefined> {
  const db = await getDB();
  return db.get("discoveredPlanets", hashHex);
}

export async function getAllPersistedPlanets(): Promise<PersistedPlanet[]> {
  const db = await getDB();
  return db.getAll("discoveredPlanets");
}

export async function deletePersistedPlanet(hashHex: string): Promise<void> {
  const db = await getDB();
  await db.delete("discoveredPlanets", hashHex);
}

export async function clearPersistedPlanets(): Promise<void> {
  const db = await getDB();
  await db.clear("discoveredPlanets");
}

// ---------------------------------------------------------------------------
// Decrypted Events CRUD
// ---------------------------------------------------------------------------

export async function persistEvent(event: PersistedEvent): Promise<number> {
  const db = await getDB();
  return (await db.add("decryptedEvents", event)) as number;
}

export async function getEventsByPlanet(
  planetHashHex: string
): Promise<PersistedEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex("decryptedEvents", "byPlanetHash", planetHashHex);
}

export async function getAllEvents(): Promise<PersistedEvent[]> {
  const db = await getDB();
  return db.getAll("decryptedEvents");
}

export async function clearEvents(): Promise<void> {
  const db = await getDB();
  await db.clear("decryptedEvents");
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function setPreference(
  key: string,
  value: string
): Promise<void> {
  const db = await getDB();
  await db.put("preferences", { key, value });
}

export async function getPreference(
  key: string
): Promise<string | undefined> {
  const db = await getDB();
  const result = await db.get("preferences", key);
  return result?.value;
}

// ---------------------------------------------------------------------------
// Scan Progress
// ---------------------------------------------------------------------------

export interface ScanProgressEntry {
  gameId: string;
  scannedRegions: Array<{
    startX: string;
    startY: string;
    endX: string;
    endY: string;
  }>;
  lastScanTimestamp: number;
}

export async function saveScanProgress(
  entry: ScanProgressEntry
): Promise<void> {
  const db = await getDB();
  await db.put("scanProgress", entry);
}

export async function getScanProgress(
  gameId: string
): Promise<ScanProgressEntry | undefined> {
  const db = await getDB();
  return db.get("scanProgress", gameId);
}
