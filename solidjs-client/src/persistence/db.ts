/**
 * Reactive persistence layer using SignalDB with IndexedDB backing.
 *
 * All data is scoped per gameId + walletPubkey so that different
 * wallets in different games have isolated storage.
 *
 * SignalDB provides reactive collections that integrate with SolidJS
 * signals via @signaldb/solid, so UI updates automatically on data change.
 */

import { Collection } from "@signaldb/core";
import solidReactivityAdapter from "@signaldb/solid";
import createIndexedDBAdapter from "@signaldb/indexeddb";

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export interface PersistedPlanet {
  id: string; // `${scope}:${hashHex}`
  scope: string; // `${gameId}:${walletPubkey}`
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
  id: string; // auto-generated
  scope: string;
  planetHashHex: string;
  eventType: string;
  data: string;
  slot: string;
  timestamp: number;
}

export interface ScanProgressDoc {
  id: string; // scope key
  scope: string;
  scannedRegions: Array<{
    startX: string;
    startY: string;
    endX: string;
    endY: string;
  }>;
  lastScanTimestamp: number;
}

export interface PreferenceDoc {
  id: string; // key
  value: string;
}

// ---------------------------------------------------------------------------
// Scope helper
// ---------------------------------------------------------------------------

export function makeScopeKey(gameId: string, walletPubkey: string): string {
  return `${gameId}:${walletPubkey}`;
}

// ---------------------------------------------------------------------------
// Reactive collections (singleton)
// ---------------------------------------------------------------------------

export const planetsCollection = new Collection<PersistedPlanet>({
  reactivity: solidReactivityAdapter,
  persistence: createIndexedDBAdapter("ef-planets"),
});

export const eventsCollection = new Collection<PersistedEvent>({
  reactivity: solidReactivityAdapter,
  persistence: createIndexedDBAdapter("ef-events"),
});

export const scanProgressCollection = new Collection<ScanProgressDoc>({
  reactivity: solidReactivityAdapter,
  persistence: createIndexedDBAdapter("ef-scanProgress"),
});

export const preferencesCollection = new Collection<PreferenceDoc>({
  reactivity: solidReactivityAdapter,
  persistence: createIndexedDBAdapter("ef-preferences"),
});

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
// Discovered Planets (scoped)
// ---------------------------------------------------------------------------

export function persistPlanet(
  scope: string,
  planet: Omit<PersistedPlanet, "id" | "scope">
): void {
  const id = `${scope}:${planet.hashHex}`;
  const existing = planetsCollection.findOne({ id });
  if (existing) {
    planetsCollection.updateOne({ id }, { $set: { ...planet, scope } });
  } else {
    planetsCollection.insert({ ...planet, id, scope });
  }
}

export function persistPlanets(
  scope: string,
  planets: Omit<PersistedPlanet, "id" | "scope">[]
): void {
  for (const planet of planets) {
    persistPlanet(scope, planet);
  }
}

export function getPersistedPlanet(
  scope: string,
  hashHex: string
): PersistedPlanet | undefined {
  return planetsCollection.findOne({ id: `${scope}:${hashHex}` }) ?? undefined;
}

export function getAllPersistedPlanets(scope: string): PersistedPlanet[] {
  return planetsCollection.find({ scope }).fetch();
}

export function deletePersistedPlanet(scope: string, hashHex: string): void {
  planetsCollection.removeOne({ id: `${scope}:${hashHex}` });
}

export function clearPersistedPlanets(scope: string): void {
  planetsCollection.removeMany({ scope });
}

// ---------------------------------------------------------------------------
// Decrypted Events (scoped)
// ---------------------------------------------------------------------------

let eventCounter = 0;

export function persistEvent(
  scope: string,
  event: Omit<PersistedEvent, "id" | "scope">
): string {
  const id = `${scope}:evt:${Date.now()}:${eventCounter++}`;
  eventsCollection.insert({ ...event, id, scope });
  return id;
}

export function getEventsByPlanet(
  planetHashHex: string
): PersistedEvent[] {
  return eventsCollection.find({ planetHashHex }).fetch();
}

export function getAllEvents(scope: string): PersistedEvent[] {
  return eventsCollection.find({ scope }).fetch();
}

export function clearEvents(scope: string): void {
  eventsCollection.removeMany({ scope });
}

// ---------------------------------------------------------------------------
// Preferences (global, not scoped)
// ---------------------------------------------------------------------------

export function setPreference(key: string, value: string): void {
  const existing = preferencesCollection.findOne({ id: key });
  if (existing) {
    preferencesCollection.updateOne({ id: key }, { $set: { value } });
  } else {
    preferencesCollection.insert({ id: key, value });
  }
}

export function getPreference(key: string): string | undefined {
  return preferencesCollection.findOne({ id: key })?.value;
}

// ---------------------------------------------------------------------------
// Scan Progress (scoped)
// ---------------------------------------------------------------------------

export function saveScanProgress(
  scope: string,
  scannedRegions: ScanProgressDoc["scannedRegions"]
): void {
  const existing = scanProgressCollection.findOne({ id: scope });
  if (existing) {
    scanProgressCollection.updateOne(
      { id: scope },
      { $set: { scannedRegions, lastScanTimestamp: Date.now() } }
    );
  } else {
    scanProgressCollection.insert({
      id: scope,
      scope,
      scannedRegions,
      lastScanTimestamp: Date.now(),
    });
  }
}

export function getScanProgress(
  scope: string
): ScanProgressDoc | undefined {
  return scanProgressCollection.findOne({ id: scope }) ?? undefined;
}
