# Indexer Specification

> **For Subagents**: This spec is designed for modular implementation. Complete each task in order within its phase. Write tests after each task. Each task is scoped to fit within agent context limits.

## Overview

The indexer is a Bun-based backend service that:
1. Listens to on-chain events from the Solana program
2. Stores events in a database
3. Provides WebSocket streaming to connected clients
4. Supports catch-up queries for clients joining late

## Prerequisites

- Bun runtime installed
- PostgreSQL or SQLite for storage
- Understanding of Solana RPC subscriptions

---

## Phase 1: Project Setup

### Task 1.1: Initialize Bun Project
**Estimated Context**: Small

```bash
cd indexer/
bun init
```

**Project Structure**:
```
indexer/
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Configuration
│   ├── db/
│   │   ├── schema.ts     # Database schema
│   │   ├── client.ts     # Database client
│   │   └── migrations/
│   ├── chain/
│   │   ├── listener.ts   # Chain event listener
│   │   └── parser.ts     # Event parsing
│   ├── ws/
│   │   ├── server.ts     # WebSocket server
│   │   └── handlers.ts   # Message handlers
│   └── types/
│       └── index.ts
├── tests/
├── package.json
└── tsconfig.json
```

**Dependencies**:
```bash
bun add @solana/web3.js
bun add drizzle-orm better-sqlite3  # or postgres
bun add -d drizzle-kit @types/better-sqlite3
```

**Deliverables**:
- Bun project initialized
- Dependencies installed
- Folder structure created

**Tests**: `bun run src/index.ts` starts without errors

---

### Task 1.2: Configuration Module
**Estimated Context**: Small

Create `src/config.ts`:

```typescript
export const config = {
  // Solana
  rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com',
  rpcWsEndpoint: process.env.RPC_WS_ENDPOINT || 'wss://api.devnet.solana.com',
  programId: process.env.PROGRAM_ID || '',
  
  // Server
  port: parseInt(process.env.PORT || '3001'),
  host: process.env.HOST || '0.0.0.0',
  
  // Database
  dbPath: process.env.DB_PATH || './data/indexer.db',
  
  // Indexer settings
  startSlot: parseInt(process.env.START_SLOT || '0'),
  batchSize: parseInt(process.env.BATCH_SIZE || '100'),
};

// Validation
if (!config.programId) {
  throw new Error('PROGRAM_ID environment variable required');
}
```

Create `.env.example`:
```
RPC_ENDPOINT=https://api.devnet.solana.com
RPC_WS_ENDPOINT=wss://api.devnet.solana.com
PROGRAM_ID=your_program_id
PORT=3001
DB_PATH=./data/indexer.db
START_SLOT=0
```

**Deliverables**:
- Configuration with environment variables
- Validation for required values
- `.env.example` template

**Tests**: Config loads and validates correctly

---

### Task 1.3: TypeScript Types
**Estimated Context**: Small

Create `src/types/index.ts`:

```typescript
// Event types from chain program
export type EventType = 
  | 'game_created'
  | 'planet_created'
  | 'player_spawned'
  | 'attack_launched'
  | 'planet_captured';

export interface ChainEvent {
  type: EventType;
  slot: number;
  signature: string;
  blockTime: number;
  data: EventData;
}

export type EventData =
  | GameCreatedData
  | PlanetCreatedData
  | PlayerSpawnedData
  | AttackLaunchedData
  | PlanetCapturedData;

export interface GameCreatedData {
  game: string;
  admin: string;
  mapDiameter: number;
  startTime: number;
  endTime: number;
}

export interface PlanetCreatedData {
  game: string;
  planet: string;
  coordHash: string;  // hex encoded
  level: number;
}

export interface PlayerSpawnedData {
  game: string;
  player: string;
  planet: string;
}

export interface AttackLaunchedData {
  game: string;
  attacker: string;
  fromPlanet: string;
  toPlanet: string;
  shipsSent: number;
  encryptedResult: string;  // hex encoded
}

export interface PlanetCapturedData {
  game: string;
  planet: string;
  newOwner: string;
  encryptedState: string;  // hex encoded
}

// WebSocket message types
export interface WsMessage {
  type: string;
  payload: unknown;
}

export interface SubscribeMessage {
  type: 'subscribe';
  payload: {
    coordHashes: string[];  // Planets to subscribe to
  };
}

export interface CatchUpMessage {
  type: 'catch_up';
  payload: {
    fromSlot: number;
    coordHashes: string[];
  };
}

export interface EventsMessage {
  type: 'events';
  payload: {
    events: ChainEvent[];
  };
}
```

**Deliverables**:
- Complete TypeScript types for events
- WebSocket message types
- Matches chain program events

**Tests**: Types compile without errors

---

## Phase 2: Database Layer

### Task 2.1: Database Schema
**Estimated Context**: Medium

Create `src/db/schema.ts`:

```typescript
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

// Track indexer progress
export const indexerState = sqliteTable('indexer_state', {
  id: integer('id').primaryKey(),
  lastProcessedSlot: integer('last_processed_slot').notNull(),
  lastProcessedSignature: text('last_processed_signature'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// All events stored for replay
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  slot: integer('slot').notNull(),
  signature: text('signature').notNull().unique(),
  blockTime: integer('block_time').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Index for fast queries by slot
// Index for fast queries by type

// Games table
export const games = sqliteTable('games', {
  id: text('id').primaryKey(),  // pubkey
  admin: text('admin').notNull(),
  mapDiameter: integer('map_diameter').notNull(),
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Planets table (current state)
export const planets = sqliteTable('planets', {
  id: text('id').primaryKey(),  // pubkey
  gameId: text('game_id').notNull().references(() => games.id),
  coordHash: text('coord_hash').notNull(),
  level: integer('level').notNull(),
  owner: text('owner'),  // null = neutral
  ships: integer('ships').notNull(),
  lastUpdateSlot: integer('last_update_slot').notNull(),
});

// Players table
export const players = sqliteTable('players', {
  id: text('id').primaryKey(),  // pubkey
  gameId: text('game_id').notNull().references(() => games.id),
  authority: text('authority').notNull(),
  planetsOwned: integer('planets_owned').notNull(),
});
```

**Deliverables**:
- Database schema with Drizzle ORM
- Indexes for efficient queries
- Relations between tables

**Tests**: Schema migration runs successfully

---

### Task 2.2: Database Client
**Estimated Context**: Medium

Create `src/db/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { config } from '../config';
import { eq, gte, and, inArray } from 'drizzle-orm';

export function createDb() {
  const sqlite = new Database(config.dbPath);
  return drizzle(sqlite, { schema });
}

export type DB = ReturnType<typeof createDb>;

// Repository functions
export class EventRepository {
  constructor(private db: DB) {}
  
  async insertEvent(event: ChainEvent): Promise<void> {
    await this.db.insert(schema.events).values({
      type: event.type,
      slot: event.slot,
      signature: event.signature,
      blockTime: event.blockTime,
      data: event.data,
      createdAt: new Date(),
    }).onConflictDoNothing();
  }
  
  async getEventsSince(
    fromSlot: number, 
    coordHashes?: string[]
  ): Promise<ChainEvent[]> {
    // Query events >= fromSlot
    // Optionally filter by coord hashes
  }
  
  async getLastProcessedSlot(): Promise<number> {
    const state = await this.db.query.indexerState.findFirst();
    return state?.lastProcessedSlot ?? config.startSlot;
  }
  
  async updateLastProcessedSlot(slot: number, signature: string): Promise<void> {
    // Upsert indexer state
  }
}

export class PlanetRepository {
  constructor(private db: DB) {}
  
  async upsertPlanet(planet: PlanetData): Promise<void> { }
  async getPlanet(id: string): Promise<PlanetData | null> { }
  async getPlanetsByCoordHashes(hashes: string[]): Promise<PlanetData[]> { }
  async updateOwner(planetId: string, owner: string | null): Promise<void> { }
  async updateShips(planetId: string, ships: number, slot: number): Promise<void> { }
}

export class GameRepository {
  constructor(private db: DB) {}
  
  async insertGame(game: GameData): Promise<void> { }
  async getGame(id: string): Promise<GameData | null> { }
}

export class PlayerRepository {
  constructor(private db: DB) {}
  
  async insertPlayer(player: PlayerData): Promise<void> { }
  async getPlayer(id: string): Promise<PlayerData | null> { }
  async updatePlanetsOwned(playerId: string, count: number): Promise<void> { }
}
```

**Deliverables**:
- Database client initialization
- Repository classes for each entity
- Query methods with filtering

**Tests**:
- ✅ Insert and query events
- ✅ Upsert planets
- ✅ Filter events by slot and coord hashes
- ✅ Indexer state persistence

---

### Task 2.3: Database Migrations
**Estimated Context**: Small

Create `drizzle.config.ts`:

```typescript
import type { Config } from 'drizzle-kit';
import { config } from './src/config';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  driver: 'better-sqlite',
  dbCredentials: {
    url: config.dbPath,
  },
} satisfies Config;
```

Add scripts to `package.json`:
```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate:sqlite",
    "db:migrate": "drizzle-kit push:sqlite",
    "db:studio": "drizzle-kit studio"
  }
}
```

**Deliverables**:
- Drizzle Kit configuration
- Migration scripts
- Database inspection tool

**Tests**: Migration runs cleanly

---

## Phase 3: Chain Event Listener

### Task 3.1: Event Parser
**Estimated Context**: Medium

Create `src/chain/parser.ts`:

```typescript
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import { IDL } from './idl';  // Copy from chain program build

const coder = new BorshCoder(IDL as Idl);

export function parseEvent(
  logMessage: string
): { type: EventType; data: EventData } | null {
  // Anchor events are base64 encoded in logs
  // Format: "Program data: <base64>"
  
  const dataMatch = logMessage.match(/^Program data: (.+)$/);
  if (!dataMatch) return null;
  
  try {
    const data = Buffer.from(dataMatch[1], 'base64');
    const event = coder.events.decode(data.toString('base64'));
    
    if (!event) return null;
    
    return {
      type: eventNameToType(event.name),
      data: transformEventData(event.name, event.data),
    };
  } catch {
    return null;
  }
}

function eventNameToType(name: string): EventType {
  const mapping: Record<string, EventType> = {
    'GameCreated': 'game_created',
    'PlanetCreated': 'planet_created',
    'PlayerSpawned': 'player_spawned',
    'AttackLaunched': 'attack_launched',
    'PlanetCaptured': 'planet_captured',
  };
  return mapping[name];
}

function transformEventData(name: string, data: any): EventData {
  // Transform Anchor types to our types
  // Convert PublicKeys to strings
  // Convert Buffers to hex strings
}
```

**Deliverables**:
- Event parsing from Anchor logs
- Type transformations
- Error handling

**Tests**:
- ✅ Parse each event type
- ✅ Handle malformed logs gracefully

---

### Task 3.2: Transaction Fetcher
**Estimated Context**: Medium

Create `src/chain/fetcher.ts`:

```typescript
import { Connection, PublicKey, ConfirmedSignatureInfo } from '@solana/web3.js';
import { config } from '../config';

export class TransactionFetcher {
  #connection: Connection;
  #programId: PublicKey;
  
  constructor() {
    this.#connection = new Connection(config.rpcEndpoint);
    this.#programId = new PublicKey(config.programId);
  }
  
  async fetchSignaturesSince(
    lastSignature?: string,
    limit = 100
  ): Promise<ConfirmedSignatureInfo[]> {
    return this.#connection.getSignaturesForAddress(
      this.#programId,
      {
        before: lastSignature,
        limit,
      }
    );
  }
  
  async fetchTransaction(signature: string) {
    return this.#connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
  }
  
  async fetchTransactionLogs(signature: string): Promise<string[]> {
    const tx = await this.fetchTransaction(signature);
    return tx?.meta?.logMessages ?? [];
  }
}
```

**Deliverables**:
- Transaction signature fetching
- Transaction detail fetching
- Log extraction

**Tests**:
- ✅ Fetch signatures (with mock)
- ✅ Extract logs from transaction

---

### Task 3.3: Chain Listener (Polling)
**Estimated Context**: Medium

Create `src/chain/listener.ts`:

```typescript
import { EventEmitter } from 'events';
import { TransactionFetcher } from './fetcher';
import { parseEvent } from './parser';
import { EventRepository } from '../db/client';
import { config } from '../config';
import type { ChainEvent } from '../types';

export class ChainListener extends EventEmitter {
  #fetcher: TransactionFetcher;
  #eventRepo: EventRepository;
  #isRunning = false;
  #pollInterval = 2000;  // 2 seconds
  
  constructor(eventRepo: EventRepository) {
    super();
    this.#fetcher = new TransactionFetcher();
    this.#eventRepo = eventRepo;
  }
  
  async start(): Promise<void> {
    this.#isRunning = true;
    this.#poll();
  }
  
  stop(): void {
    this.#isRunning = false;
  }
  
  async #poll(): Promise<void> {
    while (this.#isRunning) {
      try {
        await this.#processNewTransactions();
      } catch (error) {
        console.error('Polling error:', error);
      }
      await this.#sleep(this.#pollInterval);
    }
  }
  
  async #processNewTransactions(): Promise<void> {
    const lastSlot = await this.#eventRepo.getLastProcessedSlot();
    const signatures = await this.#fetcher.fetchSignaturesSince();
    
    // Process in chronological order (oldest first)
    for (const sig of signatures.reverse()) {
      if (sig.slot <= lastSlot) continue;
      
      const logs = await this.#fetcher.fetchTransactionLogs(sig.signature);
      const events = this.#extractEvents(logs, sig);
      
      for (const event of events) {
        await this.#eventRepo.insertEvent(event);
        this.emit('event', event);
      }
      
      await this.#eventRepo.updateLastProcessedSlot(sig.slot, sig.signature);
    }
  }
  
  #extractEvents(logs: string[], sigInfo: ConfirmedSignatureInfo): ChainEvent[] {
    const events: ChainEvent[] = [];
    
    for (const log of logs) {
      const parsed = parseEvent(log);
      if (parsed) {
        events.push({
          type: parsed.type,
          slot: sigInfo.slot,
          signature: sigInfo.signature,
          blockTime: sigInfo.blockTime ?? 0,
          data: parsed.data,
        });
      }
    }
    
    return events;
  }
  
  #sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Deliverables**:
- Polling-based chain listener
- Event extraction and persistence
- Resumable from last processed slot
- Event emission for downstream consumers

**Tests**:
- ✅ Processes new transactions
- ✅ Resumes from last slot
- ✅ Emits events correctly

---

### Task 3.4: State Updater
**Estimated Context**: Medium

Create `src/chain/stateUpdater.ts`:

```typescript
import type { ChainEvent, EventData } from '../types';
import { 
  GameRepository, 
  PlanetRepository, 
  PlayerRepository 
} from '../db/client';

export class StateUpdater {
  constructor(
    private gameRepo: GameRepository,
    private planetRepo: PlanetRepository,
    private playerRepo: PlayerRepository,
  ) {}
  
  async handleEvent(event: ChainEvent): Promise<void> {
    switch (event.type) {
      case 'game_created':
        await this.#handleGameCreated(event.data as GameCreatedData);
        break;
      case 'planet_created':
        await this.#handlePlanetCreated(event.data as PlanetCreatedData);
        break;
      case 'player_spawned':
        await this.#handlePlayerSpawned(event.data as PlayerSpawnedData);
        break;
      case 'attack_launched':
        await this.#handleAttackLaunched(event.data as AttackLaunchedData);
        break;
      case 'planet_captured':
        await this.#handlePlanetCaptured(event.data as PlanetCapturedData);
        break;
    }
  }
  
  async #handleGameCreated(data: GameCreatedData): Promise<void> {
    await this.gameRepo.insertGame({
      id: data.game,
      admin: data.admin,
      mapDiameter: data.mapDiameter,
      startTime: data.startTime,
      endTime: data.endTime,
    });
  }
  
  async #handlePlanetCreated(data: PlanetCreatedData): Promise<void> {
    await this.planetRepo.upsertPlanet({
      id: data.planet,
      gameId: data.game,
      coordHash: data.coordHash,
      level: data.level,
      owner: null,
      ships: getNeutralShips(data.level),
      lastUpdateSlot: 0,
    });
  }
  
  async #handlePlayerSpawned(data: PlayerSpawnedData): Promise<void> {
    await this.playerRepo.insertPlayer({
      id: data.player,
      gameId: data.game,
      authority: data.player,  // Will need to extract from event
      planetsOwned: 1,
    });
    
    await this.planetRepo.updateOwner(data.planet, data.player);
  }
  
  async #handleAttackLaunched(data: AttackLaunchedData): Promise<void> {
    // Update ship counts based on attack
    // Note: actual state is encrypted, this stores the event
  }
  
  async #handlePlanetCaptured(data: PlanetCapturedData): Promise<void> {
    await this.planetRepo.updateOwner(data.planet, data.newOwner);
    // Update planets_owned counts for old and new owner
  }
}

function getNeutralShips(level: number): number {
  // Match chain program logic
  return level * 10;
}
```

**Deliverables**:
- Event handlers for state updates
- Database state synchronization
- Matches chain program logic

**Tests**:
- ✅ Each event type updates state correctly
- ✅ Planet ownership transfers
- ✅ Player stats update

---

## Phase 4: WebSocket Server

### Task 4.1: WebSocket Server Setup
**Estimated Context**: Medium

Create `src/ws/server.ts`:

```typescript
import { config } from '../config';

interface Client {
  ws: ServerWebSocket<ClientData>;
  subscriptions: Set<string>;  // coord hashes
}

interface ClientData {
  id: string;
}

export class WsServer {
  #clients: Map<string, Client> = new Map();
  #server: ReturnType<typeof Bun.serve> | null = null;
  
  constructor(private onMessage: (client: Client, msg: WsMessage) => void) {}
  
  start(): void {
    this.#server = Bun.serve({
      port: config.port,
      hostname: config.host,
      
      fetch(req, server) {
        // Upgrade HTTP to WebSocket
        const url = new URL(req.url);
        
        if (url.pathname === '/ws') {
          const id = crypto.randomUUID();
          const success = server.upgrade(req, { data: { id } });
          return success
            ? undefined
            : new Response('WebSocket upgrade failed', { status: 500 });
        }
        
        // Health check endpoint
        if (url.pathname === '/health') {
          return new Response('OK');
        }
        
        return new Response('Not found', { status: 404 });
      },
      
      websocket: {
        open: (ws) => {
          const client: Client = {
            ws,
            subscriptions: new Set(),
          };
          this.#clients.set(ws.data.id, client);
          console.log(`Client connected: ${ws.data.id}`);
        },
        
        message: (ws, message) => {
          const client = this.#clients.get(ws.data.id);
          if (!client) return;
          
          try {
            const msg = JSON.parse(message.toString()) as WsMessage;
            this.onMessage(client, msg);
          } catch (error) {
            console.error('Invalid message:', error);
          }
        },
        
        close: (ws) => {
          this.#clients.delete(ws.data.id);
          console.log(`Client disconnected: ${ws.data.id}`);
        },
      },
    });
    
    console.log(`WebSocket server listening on ${config.host}:${config.port}`);
  }
  
  stop(): void {
    this.#server?.stop();
  }
  
  broadcast(event: ChainEvent): void {
    // Send to clients subscribed to this event's planet
    for (const client of this.#clients.values()) {
      if (this.#shouldReceive(client, event)) {
        this.#send(client, { type: 'event', payload: event });
      }
    }
  }
  
  #shouldReceive(client: Client, event: ChainEvent): boolean {
    // Check if event relates to any subscribed planet
    const coordHash = this.#getEventCoordHash(event);
    return !coordHash || client.subscriptions.has(coordHash);
  }
  
  #getEventCoordHash(event: ChainEvent): string | null {
    // Extract coord hash from event data if applicable
    if ('coordHash' in event.data) {
      return (event.data as any).coordHash;
    }
    return null;
  }
  
  #send(client: Client, msg: WsMessage): void {
    client.ws.send(JSON.stringify(msg));
  }
  
  sendTo(clientId: string, msg: WsMessage): void {
    const client = this.#clients.get(clientId);
    if (client) {
      this.#send(client, msg);
    }
  }
  
  getClient(clientId: string): Client | undefined {
    return this.#clients.get(clientId);
  }
}
```

**Deliverables**:
- Bun native WebSocket server
- Client connection management
- Subscription tracking
- Broadcast with filtering

**Tests**:
- ✅ Client connects/disconnects
- ✅ Messages are parsed
- ✅ Broadcast reaches subscribed clients

---

### Task 4.2: Message Handlers
**Estimated Context**: Medium

Create `src/ws/handlers.ts`:

```typescript
import type { WsMessage, SubscribeMessage, CatchUpMessage, Client } from '../types';
import { EventRepository } from '../db/client';

export class MessageHandler {
  constructor(
    private eventRepo: EventRepository,
    private sendTo: (client: Client, msg: WsMessage) => void,
  ) {}
  
  async handle(client: Client, msg: WsMessage): Promise<void> {
    switch (msg.type) {
      case 'subscribe':
        await this.#handleSubscribe(client, msg as SubscribeMessage);
        break;
      case 'unsubscribe':
        await this.#handleUnsubscribe(client, msg);
        break;
      case 'catch_up':
        await this.#handleCatchUp(client, msg as CatchUpMessage);
        break;
      case 'ping':
        this.sendTo(client, { type: 'pong', payload: {} });
        break;
      default:
        console.warn('Unknown message type:', msg.type);
    }
  }
  
  async #handleSubscribe(client: Client, msg: SubscribeMessage): Promise<void> {
    const { coordHashes } = msg.payload;
    
    for (const hash of coordHashes) {
      client.subscriptions.add(hash);
    }
    
    this.sendTo(client, {
      type: 'subscribed',
      payload: { coordHashes },
    });
  }
  
  async #handleUnsubscribe(client: Client, msg: WsMessage): Promise<void> {
    const { coordHashes } = msg.payload as { coordHashes: string[] };
    
    for (const hash of coordHashes) {
      client.subscriptions.delete(hash);
    }
  }
  
  async #handleCatchUp(client: Client, msg: CatchUpMessage): Promise<void> {
    const { fromSlot, coordHashes } = msg.payload;
    
    // Fetch events since slot, filtered by coord hashes
    const events = await this.eventRepo.getEventsSince(fromSlot, coordHashes);
    
    // Send in batches to avoid huge messages
    const batchSize = 100;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      this.sendTo(client, {
        type: 'catch_up_batch',
        payload: {
          events: batch,
          hasMore: i + batchSize < events.length,
        },
      });
    }
    
    this.sendTo(client, {
      type: 'catch_up_complete',
      payload: { eventCount: events.length },
    });
  }
}
```

**Deliverables**:
- Subscribe/unsubscribe handlers
- Catch-up query handler
- Batched response for large catch-ups
- Ping/pong for keepalive

**Tests**:
- ✅ Subscription updates client state
- ✅ Catch-up returns correct events
- ✅ Batching works for large result sets

---

### Task 4.3: HTTP API (Optional)
**Estimated Context**: Small

Add HTTP endpoints to `src/ws/server.ts`:

```typescript
// In fetch handler, add:
if (url.pathname === '/api/events') {
  const fromSlot = parseInt(url.searchParams.get('fromSlot') || '0');
  const coordHashes = url.searchParams.get('coordHashes')?.split(',');
  
  const events = await eventRepo.getEventsSince(fromSlot, coordHashes);
  
  return new Response(JSON.stringify(events), {
    headers: { 'Content-Type': 'application/json' },
  });
}

if (url.pathname === '/api/planets') {
  const coordHashes = url.searchParams.get('coordHashes')?.split(',');
  
  if (!coordHashes) {
    return new Response('coordHashes required', { status: 400 });
  }
  
  const planets = await planetRepo.getPlanetsByCoordHashes(coordHashes);
  
  return new Response(JSON.stringify(planets), {
    headers: { 'Content-Type': 'application/json' },
  });
}

if (url.pathname === '/api/games/:id') {
  const gameId = url.pathname.split('/')[3];
  const game = await gameRepo.getGame(gameId);
  
  if (!game) {
    return new Response('Game not found', { status: 404 });
  }
  
  return new Response(JSON.stringify(game), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

**Deliverables**:
- REST endpoints for initial data fetch
- Events query endpoint
- Planets query endpoint
- Games query endpoint

**Tests**:
- ✅ Each endpoint returns correct data
- ✅ Error handling for invalid requests

---

## Phase 5: Main Application

### Task 5.1: Application Bootstrap
**Estimated Context**: Medium

Create `src/index.ts`:

```typescript
import { createDb, EventRepository, PlanetRepository, GameRepository, PlayerRepository } from './db/client';
import { ChainListener } from './chain/listener';
import { StateUpdater } from './chain/stateUpdater';
import { WsServer } from './ws/server';
import { MessageHandler } from './ws/handlers';
import { config } from './config';

async function main() {
  console.log('Starting Encrypted Forest Indexer...');
  
  // Initialize database
  const db = createDb();
  const eventRepo = new EventRepository(db);
  const planetRepo = new PlanetRepository(db);
  const gameRepo = new GameRepository(db);
  const playerRepo = new PlayerRepository(db);
  
  // Initialize state updater
  const stateUpdater = new StateUpdater(gameRepo, planetRepo, playerRepo);
  
  // Initialize WebSocket server
  const wsServer = new WsServer((client, msg) => {
    messageHandler.handle(client, msg);
  });
  
  const messageHandler = new MessageHandler(
    eventRepo,
    (client, msg) => wsServer.sendTo(client.ws.data.id, msg),
  );
  
  // Initialize chain listener
  const chainListener = new ChainListener(eventRepo);
  
  // Wire up event flow
  chainListener.on('event', async (event) => {
    // Update local state
    await stateUpdater.handleEvent(event);
    
    // Broadcast to connected clients
    wsServer.broadcast(event);
  });
  
  // Start services
  wsServer.start();
  await chainListener.start();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    chainListener.stop();
    wsServer.stop();
    process.exit(0);
  });
  
  console.log(`Indexer running on port ${config.port}`);
}

main().catch(console.error);
```

**Deliverables**:
- Application entry point
- Service initialization and wiring
- Event flow setup
- Graceful shutdown

**Tests**: Application starts and connects to chain

---

### Task 5.2: Logging & Monitoring
**Estimated Context**: Small

Create `src/utils/logger.ts`:

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};

function log(level: LogLevel, ...args: unknown[]) {
  if (levels[level] < levels[LOG_LEVEL]) return;
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  console[level](prefix, ...args);
}

// Metrics (simple counters)
export const metrics = {
  eventsProcessed: 0,
  clientsConnected: 0,
  messagesReceived: 0,
  
  increment(key: keyof typeof metrics) {
    this[key]++;
  },
  
  decrement(key: keyof typeof metrics) {
    this[key]--;
  },
  
  getAll() {
    return {
      eventsProcessed: this.eventsProcessed,
      clientsConnected: this.clientsConnected,
      messagesReceived: this.messagesReceived,
    };
  },
};
```

Add `/api/metrics` endpoint:
```typescript
if (url.pathname === '/api/metrics') {
  return new Response(JSON.stringify(metrics.getAll()), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

**Deliverables**:
- Structured logging
- Basic metrics counters
- Metrics endpoint

**Tests**: Logging at correct levels, metrics increment

---

## Phase 6: Testing & Deployment

### Task 6.1: Unit Tests
**Estimated Context**: Medium

Create `tests/unit/`:

```typescript
// tests/unit/parser.test.ts
import { describe, test, expect } from 'bun:test';
import { parseEvent } from '../../src/chain/parser';

describe('Event Parser', () => {
  test('parses GameCreated event', () => {
    const log = 'Program data: <base64 encoded event>';
    const result = parseEvent(log);
    expect(result?.type).toBe('game_created');
  });
  
  // Test each event type
});

// tests/unit/db.test.ts
describe('Database', () => {
  test('inserts and queries events', async () => {
    // Test with in-memory SQLite
  });
});
```

**Deliverables**:
- Parser unit tests
- Database unit tests
- Repository unit tests

---

### Task 6.2: Integration Tests
**Estimated Context**: Medium

Create `tests/integration/`:

```typescript
// tests/integration/flow.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

describe('Event Flow', () => {
  let server: TestServer;
  let client: WebSocket;
  
  beforeAll(async () => {
    server = await startTestServer();
    client = new WebSocket(`ws://localhost:${server.port}/ws`);
  });
  
  afterAll(() => {
    client.close();
    server.stop();
  });
  
  test('client subscribes and receives events', async () => {
    // 1. Subscribe to coord hashes
    // 2. Inject mock event
    // 3. Verify client receives event
  });
  
  test('catch up returns historical events', async () => {
    // 1. Insert events into DB
    // 2. Send catch_up message
    // 3. Verify events received
  });
});
```

**Deliverables**:
- WebSocket integration tests
- Event flow tests
- Catch-up tests

---

### Task 6.3: Docker Deployment
**Estimated Context**: Small

Create `Dockerfile`:

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

# Create data directory
RUN mkdir -p /app/data

ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
```

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  indexer:
    build: .
    ports:
      - "3001:3001"
    environment:
      - RPC_ENDPOINT=${RPC_ENDPOINT}
      - RPC_WS_ENDPOINT=${RPC_WS_ENDPOINT}
      - PROGRAM_ID=${PROGRAM_ID}
      - DB_PATH=/app/data/indexer.db
    volumes:
      - indexer-data:/app/data
    restart: unless-stopped

volumes:
  indexer-data:
```

**Deliverables**:
- Dockerfile for Bun
- Docker Compose configuration
- Volume for database persistence

**Tests**: Docker build succeeds, container runs

---

## Testing Strategy Summary

| Task | Unit Tests | Integration Tests |
|------|------------|-------------------|
| 2.2 DB Client | ✅ CRUD ops | - |
| 3.1 Parser | ✅ Each event type | - |
| 3.3 Listener | ✅ Polling logic | ✅ Chain connection |
| 3.4 State Updater | ✅ Each handler | - |
| 4.1 WS Server | ✅ Connection mgmt | ✅ Real WebSocket |
| 4.2 Handlers | ✅ Each message type | ✅ Full flow |
| 6.1-6.2 Full | - | ✅ E2E scenarios |

---

## Dependencies

```
Indexer → ChainProgram: Listens to events, shares IDL
Indexer → Client: WebSocket API for real-time updates
```

## Notes for Subagent

1. **Use Bun native APIs** - WebSocket, SQLite if preferred
2. **Polling is simpler** than WebSocket subscription for chain
3. **Events are the source of truth** - store all, derive state
4. **Batch catch-up responses** for large result sets
5. **Test with mock events** before chain integration
6. **IDL must match chain program** exactly
