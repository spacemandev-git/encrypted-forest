# Client Specification

> **For Subagents**: This spec is designed for modular implementation. Complete each task in order within its phase. Write tests after each task. Each task is scoped to fit within agent context limits.

## Overview

The client is a Svelte 5 browser application with Three.js for 3D game rendering. It handles local fog-of-war computation, wallet integration, transaction submission, and real-time event synchronization via the indexer.

## Prerequisites

- Node.js 20+ and pnpm/npm
- Svelte 5 knowledge (runes, snippets)
- Three.js basics
- Solana wallet adapter familiarity

---

## Phase 1: Project Setup

### Task 1.1: Initialize Svelte 5 Project
**Estimated Context**: Small

```bash
cd client/
npm create svelte@latest . # Choose Svelte 5, TypeScript
npm install
```

**Additional Dependencies**:
```bash
npm install three @types/three
npm install @solana/web3.js @solana/wallet-adapter-wallets
npm install idb  # IndexedDB wrapper
```

**Deliverables**:
- Svelte 5 project with TypeScript
- Dependencies installed
- Basic folder structure:
  ```
  client/
  ├── src/
  │   ├── lib/
  │   │   ├── components/
  │   │   ├── game/
  │   │   ├── stores/
  │   │   ├── utils/
  │   │   └── types/
  │   ├── routes/
  │   └── app.html
  ├── static/
  └── tests/
  ```

**Tests**: `npm run dev` starts without errors

---

### Task 1.2: TypeScript Types
**Estimated Context**: Small

Create `src/lib/types/index.ts`:

```typescript
// Core game types
export interface GameConfig {
  publicKey: string;
  admin: string;
  mapDiameter: number;
  startTime: number;  // Unix timestamp
  endTime: number;
  gameSeed: Uint8Array;
}

export interface Planet {
  publicKey: string;
  coordHash: Uint8Array;
  x: number;          // Decrypted locally
  y: number;          // Decrypted locally
  level: number;
  owner: string | null;
  ships: number;
  lastUpdateSlot: number;
}

export interface Player {
  publicKey: string;
  authority: string;
  planetsOwned: number;
}

// Local state types
export interface DiscoveredPlanet extends Planet {
  planetKey: Uint8Array | null;  // For decrypting events
  lastSyncedSlot: number;
}

export interface Coordinate {
  x: number;
  y: number;
}

// Event types (from indexer)
export interface GameEvent {
  type: 'planet_created' | 'player_spawned' | 'attack_launched' | 'planet_captured';
  slot: number;
  data: unknown;
}
```

**Deliverables**:
- Complete TypeScript type definitions
- Matches chain program state

**Tests**: TypeScript compiles without errors

---

### Task 1.3: Environment Configuration
**Estimated Context**: Small

Create `src/lib/config.ts`:

```typescript
export const config = {
  // Solana
  rpcEndpoint: import.meta.env.VITE_RPC_ENDPOINT || 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_PROGRAM_ID || '',
  
  // Indexer
  indexerWsUrl: import.meta.env.VITE_INDEXER_WS || 'ws://localhost:3001',
  indexerHttpUrl: import.meta.env.VITE_INDEXER_HTTP || 'http://localhost:3001',
  
  // Game
  defaultGameId: import.meta.env.VITE_GAME_ID || '',
};
```

Create `.env.example`:
```
VITE_RPC_ENDPOINT=https://api.devnet.solana.com
VITE_PROGRAM_ID=your_program_id
VITE_INDEXER_WS=ws://localhost:3001
VITE_INDEXER_HTTP=http://localhost:3001
VITE_GAME_ID=your_game_id
```

**Deliverables**:
- Environment configuration module
- `.env.example` template

**Tests**: Config loads correctly with/without env vars

---

## Phase 2: Core Utilities

### Task 2.1: Noise Function (TypeScript Port)
**Estimated Context**: Medium

Create `src/lib/utils/noise.ts`:

**Critical**: Must produce identical results to Rust implementation!

```typescript
/**
 * Deterministic noise function - must match chain program exactly
 */
export function calculatePlanet(
  x: number, 
  y: number, 
  gameSeed: Uint8Array
): { exists: boolean; level: number } {
  const hash = hashCoordinates(x, y, gameSeed);
  // Apply same noise threshold as Rust
  // Return planet existence and level
}

export function hashCoordinates(
  x: number, 
  y: number, 
  gameSeed: Uint8Array
): Uint8Array {
  // SHA256(x || y || gameSeed)
  // Must match Rust implementation exactly
}

export function derivePlanetPDA(
  coordHash: Uint8Array,
  gameId: string,
  programId: string
): string {
  // Derive the same PDA as the chain program
}
```

**Deliverables**:
- `noise.ts` with hash and planet calculation
- Byte-for-byte compatibility with Rust

**Tests**:
- ✅ Test vectors from Rust implementation
- ✅ Known coordinates produce expected results
- ✅ PDA derivation matches chain

---

### Task 2.2: IndexedDB Storage
**Estimated Context**: Medium

Create `src/lib/stores/db.ts`:

```typescript
import { openDB, type IDBPDatabase } from 'idb';

interface GameDB {
  discoveredPlanets: {
    key: string;  // coordHash as hex
    value: DiscoveredPlanet;
    indexes: { 'by-coords': [number, number] };
  };
  events: {
    key: number;  // slot number
    value: GameEvent;
    indexes: { 'by-type': string };
  };
  syncState: {
    key: string;
    value: { lastSyncedSlot: number };
  };
}

export async function initDB(): Promise<IDBPDatabase<GameDB>> {
  return openDB<GameDB>('encrypted-forest', 1, {
    upgrade(db) {
      // Create object stores and indexes
    },
  });
}

export async function savePlanet(planet: DiscoveredPlanet): Promise<void> { }
export async function getPlanet(coordHash: string): Promise<DiscoveredPlanet | undefined> { }
export async function getAllPlanets(): Promise<DiscoveredPlanet[]> { }
export async function saveEvent(event: GameEvent): Promise<void> { }
export async function getEventsSince(slot: number): Promise<GameEvent[]> { }
```

**Deliverables**:
- IndexedDB schema and initialization
- CRUD operations for planets and events
- Sync state tracking

**Tests**:
- ✅ Save and retrieve planets
- ✅ Event storage and querying
- ✅ Sync state persistence

---

### Task 2.3: Encryption Utilities
**Estimated Context**: Medium

Create `src/lib/utils/crypto.ts`:

```typescript
/**
 * Decrypt planet events using planet key
 */
export async function decryptWithPlanetKey(
  encryptedData: Uint8Array,
  planetKey: Uint8Array
): Promise<Uint8Array> {
  // Use WebCrypto API
  // Match Arcium's encryption scheme
}

/**
 * Generate keypair for receiving sealed planet keys
 */
export async function generatePlayerKeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  // For Arcium key sealing
}

/**
 * Unseal planet key received from chain
 */
export async function unsealPlanetKey(
  sealedKey: Uint8Array,
  playerPrivateKey: Uint8Array
): Promise<Uint8Array> {
  // Decrypt the sealed planet key
}
```

**Deliverables**:
- Encryption/decryption matching Arcium scheme
- Player keypair generation
- Key unsealing

**Tests**:
- ✅ Round-trip encryption/decryption
- ✅ Unsealing test vectors

---

## Phase 3: Svelte 5 State Management

### Task 3.1: Wallet Store (Runes)
**Estimated Context**: Medium

Create `src/lib/stores/wallet.svelte.ts`:

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

class WalletStore {
  connected = $state(false);
  publicKey = $state<string | null>(null);
  
  #adapter: WalletAdapter | null = null;
  #connection: Connection;
  
  constructor() {
    this.#connection = new Connection(config.rpcEndpoint);
  }
  
  async connect(adapter: WalletAdapter): Promise<void> {
    await adapter.connect();
    this.#adapter = adapter;
    this.connected = true;
    this.publicKey = adapter.publicKey?.toBase58() ?? null;
  }
  
  async disconnect(): Promise<void> {
    await this.#adapter?.disconnect();
    this.connected = false;
    this.publicKey = null;
  }
  
  async signAndSendTransaction(tx: Transaction): Promise<string> {
    // Sign with wallet, send via connection
  }
}

export const wallet = new WalletStore();
```

**Deliverables**:
- Reactive wallet state using Svelte 5 runes
- Connect/disconnect functionality
- Transaction signing

**Tests**:
- ✅ Mock wallet connection
- ✅ State updates correctly

---

### Task 3.2: Game State Store
**Estimated Context**: Medium

Create `src/lib/stores/game.svelte.ts`:

```typescript
class GameStore {
  // Core state
  gameConfig = $state<GameConfig | null>(null);
  player = $state<Player | null>(null);
  loading = $state(false);
  
  // Discovered planets (loaded from IndexedDB)
  planets = $state<Map<string, DiscoveredPlanet>>(new Map());
  
  // Derived state
  ownedPlanets = $derived(
    [...this.planets.values()].filter(p => p.owner === wallet.publicKey)
  );
  
  async loadGame(gameId: string): Promise<void> {
    this.loading = true;
    // Fetch game config from chain
    // Load planets from IndexedDB
    this.loading = false;
  }
  
  async discoverPlanet(x: number, y: number): Promise<DiscoveredPlanet | null> {
    // Use noise function to check if planet exists
    // Derive PDA and check on-chain
    // Store in IndexedDB and state
  }
  
  updatePlanetFromEvent(event: GameEvent): void {
    // Update planet state from incoming event
  }
}

export const game = new GameStore();
```

**Deliverables**:
- Reactive game state with runes
- Planet discovery logic
- Derived computations

**Tests**:
- ✅ Planet discovery flow
- ✅ State updates from events
- ✅ Derived state calculations

---

### Task 3.3: Indexer Connection Store
**Estimated Context**: Medium

Create `src/lib/stores/indexer.svelte.ts`:

```typescript
class IndexerStore {
  connected = $state(false);
  lastSyncedSlot = $state(0);
  
  #ws: WebSocket | null = null;
  #subscribedPlanets: Set<string> = new Set();  // coord hashes
  
  connect(): void {
    this.#ws = new WebSocket(config.indexerWsUrl);
    
    this.#ws.onopen = () => {
      this.connected = true;
      this.#sendCatchUp();
    };
    
    this.#ws.onmessage = (event) => {
      this.#handleMessage(JSON.parse(event.data));
    };
    
    this.#ws.onclose = () => {
      this.connected = false;
      // Reconnect logic
    };
  }
  
  subscribeToPlanet(coordHash: string): void {
    this.#subscribedPlanets.add(coordHash);
    this.#sendSubscription(coordHash);
  }
  
  #sendCatchUp(): void {
    // Request events since lastSyncedSlot
    // Filtered by subscribed planets
  }
  
  #handleMessage(msg: IndexerMessage): void {
    // Route to game store for state updates
  }
}

export const indexer = new IndexerStore();
```

**Deliverables**:
- WebSocket connection management
- Subscription handling
- Catch-up synchronization
- Reconnection logic

**Tests**:
- ✅ Mock WebSocket connection
- ✅ Message handling
- ✅ Subscription management

---

## Phase 4: Transaction Builders

### Task 4.1: Program Client Setup
**Estimated Context**: Small

Create `src/lib/program/client.ts`:

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { IDL, type EncryptedForest } from './idl';

export function getProgram(provider: AnchorProvider): Program<EncryptedForest> {
  return new Program(IDL, config.programId, provider);
}

export function getProvider(wallet: WalletAdapter): AnchorProvider {
  const connection = new Connection(config.rpcEndpoint);
  return new AnchorProvider(connection, wallet, {});
}
```

**Deliverables**:
- Program client initialization
- IDL type imports (copy from chain build)

**Tests**: Program client instantiates

---

### Task 4.2: Spawn Transaction
**Estimated Context**: Medium

Create `src/lib/program/instructions/spawn.ts`:

```typescript
export async function buildSpawnTransaction(
  program: Program<EncryptedForest>,
  gameId: PublicKey,
  planetCoords: { x: number; y: number }
): Promise<Transaction> {
  // 1. Calculate coord hash
  // 2. Derive planet PDA
  // 3. Derive player PDA
  // 4. Build spawn instruction
  // 5. Return unsigned transaction
}

export async function spawn(
  wallet: WalletStore,
  gameId: string,
  x: number,
  y: number
): Promise<string> {
  const program = getProgram(getProvider(wallet.adapter));
  const tx = await buildSpawnTransaction(program, new PublicKey(gameId), { x, y });
  return wallet.signAndSendTransaction(tx);
}
```

**Deliverables**:
- Spawn transaction builder
- High-level spawn function

**Tests**:
- ✅ Transaction builds correctly
- ✅ PDAs derived correctly

---

### Task 4.3: Attack Transaction
**Estimated Context**: Medium

Create `src/lib/program/instructions/attack.ts`:

```typescript
export async function buildAttackTransaction(
  program: Program<EncryptedForest>,
  fromPlanet: PublicKey,
  toPlanetCoords: { x: number; y: number },
  shipsToSend: number
): Promise<Transaction> {
  // 1. Calculate target coord hash
  // 2. Derive target planet PDA
  // 3. Build attack instruction with Arcium accounts
  // 4. Return unsigned transaction
}

export async function attack(
  wallet: WalletStore,
  fromPlanetId: string,
  toX: number,
  toY: number,
  ships: number
): Promise<string> {
  // Build and send attack transaction
}
```

**Deliverables**:
- Attack transaction builder
- Ship validation

**Tests**:
- ✅ Transaction builds correctly
- ✅ Validates ship count

---

### Task 4.4: Get Planet Key Transaction
**Estimated Context**: Medium

Create `src/lib/program/instructions/getPlanetKey.ts`:

```typescript
export async function buildGetPlanetKeyTransaction(
  program: Program<EncryptedForest>,
  planetCoords: { x: number; y: number },
  playerEncryptionPubkey: Uint8Array
): Promise<Transaction> {
  // Build instruction to get planet key sealed to player
}

export async function getPlanetKey(
  wallet: WalletStore,
  x: number,
  y: number
): Promise<Uint8Array> {
  // 1. Generate/load player encryption keypair
  // 2. Send transaction
  // 3. Read sealed key from account
  // 4. Unseal with player private key
  // 5. Return planet key
}
```

**Deliverables**:
- Planet key request transaction
- Key unsealing flow

**Tests**:
- ✅ Transaction builds correctly
- ✅ Key unsealing works

---

## Phase 5: UI Components

### Task 5.1: Wallet Connect Component
**Estimated Context**: Small

Create `src/lib/components/WalletConnect.svelte`:

```svelte
<script lang="ts">
  import { wallet } from '$lib/stores/wallet.svelte';
  
  const wallets = [
    // Phantom, Solflare, etc.
  ];
</script>

{#if wallet.connected}
  <button onclick={() => wallet.disconnect()}>
    {wallet.publicKey?.slice(0, 8)}...
  </button>
{:else}
  <div class="wallet-options">
    {#each wallets as w}
      <button onclick={() => wallet.connect(w)}>
        {w.name}
      </button>
    {/each}
  </div>
{/if}
```

**Deliverables**:
- Wallet selection UI
- Connect/disconnect buttons
- Address display

**Tests**: Component renders, mock wallet interaction

---

### Task 5.2: Game HUD Component
**Estimated Context**: Small

Create `src/lib/components/GameHUD.svelte`:

```svelte
<script lang="ts">
  import { game } from '$lib/stores/game.svelte';
  import { indexer } from '$lib/stores/indexer.svelte';
</script>

<div class="hud">
  <div class="stats">
    <span>Planets: {game.ownedPlanets.length}</span>
    <span>Total Ships: {game.ownedPlanets.reduce((a, p) => a + p.ships, 0)}</span>
  </div>
  
  <div class="connection-status">
    {#if indexer.connected}
      <span class="online">● Synced</span>
    {:else}
      <span class="offline">● Reconnecting...</span>
    {/if}
  </div>
  
  <div class="game-timer">
    <!-- Time remaining -->
  </div>
</div>
```

**Deliverables**:
- Player stats display
- Connection status
- Game timer

**Tests**: Component renders with mock state

---

### Task 5.3: Planet Info Panel
**Estimated Context**: Small

Create `src/lib/components/PlanetInfo.svelte`:

```svelte
<script lang="ts">
  import type { DiscoveredPlanet } from '$lib/types';
  
  interface Props {
    planet: DiscoveredPlanet | null;
    onAttack?: (ships: number) => void;
  }
  
  let { planet, onAttack }: Props = $props();
  let shipsToSend = $state(0);
</script>

{#if planet}
  <div class="planet-panel">
    <h3>Planet ({planet.x}, {planet.y})</h3>
    <p>Level: {planet.level}</p>
    <p>Ships: {planet.ships}</p>
    <p>Owner: {planet.owner ?? 'Neutral'}</p>
    
    {#if onAttack}
      <input type="range" bind:value={shipsToSend} max={maxShips} />
      <button onclick={() => onAttack(shipsToSend)}>
        Attack with {shipsToSend} ships
      </button>
    {/if}
  </div>
{/if}
```

**Deliverables**:
- Planet details display
- Attack controls
- Ship slider

**Tests**: Component renders, attack callback works

---

## Phase 6: Three.js Game Renderer

### Task 6.1: Scene Setup
**Estimated Context**: Medium

Create `src/lib/game/renderer.ts`:

```typescript
import * as THREE from 'three';

export class GameRenderer {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  
  #planets: Map<string, THREE.Mesh> = new Map();
  #fogOverlay: THREE.Mesh;
  
  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(/* ... */);
    this.renderer = new THREE.WebGLRenderer({ canvas });
    
    this.#setupLighting();
    this.#setupFogOverlay();
  }
  
  #setupLighting(): void { /* ... */ }
  #setupFogOverlay(): void { /* Create grid with fog shader */ }
  
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
  
  dispose(): void {
    // Cleanup Three.js resources
  }
}
```

**Deliverables**:
- Three.js scene initialization
- Orthographic camera for 2D view
- Basic lighting

**Tests**: Scene renders without errors

---

### Task 6.2: Planet Rendering
**Estimated Context**: Medium

Create `src/lib/game/planets.ts`:

```typescript
export function createPlanetMesh(planet: DiscoveredPlanet): THREE.Group {
  const group = new THREE.Group();
  
  // Planet sphere (size based on level)
  const geometry = new THREE.SphereGeometry(planet.level * 0.5);
  const material = new THREE.MeshStandardMaterial({
    color: getPlanetColor(planet),
  });
  const sphere = new THREE.Mesh(geometry, material);
  group.add(sphere);
  
  // Ship count indicator
  // Owner ring
  
  return group;
}

function getPlanetColor(planet: DiscoveredPlanet): number {
  if (!planet.owner) return 0x888888;  // Neutral
  if (planet.owner === wallet.publicKey) return 0x00ff00;  // Owned
  return 0xff0000;  // Enemy
}
```

Add to `GameRenderer`:
```typescript
addPlanet(planet: DiscoveredPlanet): void {
  const mesh = createPlanetMesh(planet);
  mesh.position.set(planet.x, planet.y, 0);
  this.scene.add(mesh);
  this.#planets.set(planet.publicKey, mesh);
}

updatePlanet(planet: DiscoveredPlanet): void {
  // Update existing mesh
}

removePlanet(publicKey: string): void {
  // Remove from scene
}
```

**Deliverables**:
- Planet mesh creation
- Level-based sizing
- Owner-based coloring
- Add/update/remove methods

**Tests**: Planets render at correct positions

---

### Task 6.3: Fog of War Shader
**Estimated Context**: Medium

Create `src/lib/game/shaders/fog.ts`:

```typescript
export const fogVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fogFragmentShader = `
  uniform sampler2D revealedMap;  // Texture of revealed areas
  varying vec2 vUv;
  
  void main() {
    float revealed = texture2D(revealedMap, vUv).r;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - revealed);
  }
`;
```

Add fog management to renderer:
```typescript
revealArea(x: number, y: number, radius: number): void {
  // Update revealed texture
}
```

**Deliverables**:
- Fog of war shader
- Reveal mechanism
- Gradual reveal animation

**Tests**: Fog renders, areas reveal correctly

---

### Task 6.4: Camera Controls
**Estimated Context**: Small

Create `src/lib/game/controls.ts`:

```typescript
export class CameraControls {
  #camera: THREE.OrthographicCamera;
  #canvas: HTMLCanvasElement;
  
  #isDragging = false;
  #lastMouse = { x: 0, y: 0 };
  
  zoom = 1;
  position = { x: 0, y: 0 };
  
  constructor(camera: THREE.OrthographicCamera, canvas: HTMLCanvasElement) {
    this.#camera = camera;
    this.#canvas = canvas;
    this.#setupEventListeners();
  }
  
  #setupEventListeners(): void {
    this.#canvas.addEventListener('mousedown', this.#onMouseDown);
    this.#canvas.addEventListener('mousemove', this.#onMouseMove);
    this.#canvas.addEventListener('mouseup', this.#onMouseUp);
    this.#canvas.addEventListener('wheel', this.#onWheel);
  }
  
  #onWheel = (e: WheelEvent): void => {
    this.zoom = Math.max(0.5, Math.min(3, this.zoom - e.deltaY * 0.001));
    this.#updateCamera();
  };
  
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    // Convert screen coordinates to world coordinates
  }
}
```

**Deliverables**:
- Pan with mouse drag
- Zoom with scroll wheel
- Screen-to-world coordinate conversion

**Tests**: Pan and zoom work correctly

---

### Task 6.5: Selection & Interaction
**Estimated Context**: Medium

Create `src/lib/game/interaction.ts`:

```typescript
export class InteractionManager {
  #renderer: GameRenderer;
  #raycaster: THREE.Raycaster;
  
  selectedPlanet = $state<DiscoveredPlanet | null>(null);
  hoveredPlanet = $state<DiscoveredPlanet | null>(null);
  
  constructor(renderer: GameRenderer) {
    this.#renderer = renderer;
    this.#raycaster = new THREE.Raycaster();
  }
  
  handleClick(screenX: number, screenY: number): void {
    const intersects = this.#raycast(screenX, screenY);
    if (intersects.length > 0) {
      // Find planet and select it
    }
  }
  
  handleHover(screenX: number, screenY: number): void {
    // Update hovered planet
  }
}
```

**Deliverables**:
- Raycasting for planet selection
- Hover detection
- Selection state

**Tests**: Selection/hover work correctly

---

## Phase 7: Main Game View

### Task 7.1: Game Canvas Component
**Estimated Context**: Medium

Create `src/lib/components/GameCanvas.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { GameRenderer } from '$lib/game/renderer';
  import { game } from '$lib/stores/game.svelte';
  
  let canvas: HTMLCanvasElement;
  let renderer: GameRenderer;
  
  onMount(() => {
    renderer = new GameRenderer(canvas);
    
    // Sync planets from game store
    $effect(() => {
      for (const planet of game.planets.values()) {
        renderer.addPlanet(planet);
      }
    });
    
    // Animation loop
    const animate = () => {
      renderer.render();
      requestAnimationFrame(animate);
    };
    animate();
  });
  
  onDestroy(() => {
    renderer?.dispose();
  });
</script>

<canvas bind:this={canvas}></canvas>
```

**Deliverables**:
- Canvas component with Three.js integration
- Reactive planet rendering
- Cleanup on unmount

**Tests**: Component mounts, renders planets

---

### Task 7.2: Main Game Route
**Estimated Context**: Medium

Create `src/routes/game/[gameId]/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { game } from '$lib/stores/game.svelte';
  import { indexer } from '$lib/stores/indexer.svelte';
  import GameCanvas from '$lib/components/GameCanvas.svelte';
  import GameHUD from '$lib/components/GameHUD.svelte';
  import PlanetInfo from '$lib/components/PlanetInfo.svelte';
  import WalletConnect from '$lib/components/WalletConnect.svelte';
  
  const gameId = $page.params.gameId;
  
  $effect(() => {
    game.loadGame(gameId);
    indexer.connect();
  });
</script>

<div class="game-container">
  <WalletConnect />
  <GameHUD />
  <GameCanvas />
  <PlanetInfo planet={selectedPlanet} />
</div>

<style>
  .game-container {
    width: 100vw;
    height: 100vh;
    position: relative;
  }
</style>
```

**Deliverables**:
- Main game page
- Component composition
- Game initialization on mount

**Tests**: Page loads, components render

---

## Phase 8: E2E Integration Tests

### Task 8.1: Planet Discovery Flow
**Estimated Context**: Medium

Create `tests/e2e/discovery.test.ts`:

Test the complete flow:
1. User connects wallet
2. User explores coordinates
3. Planet is discovered (or not)
4. Planet appears on map
5. Planet is saved to IndexedDB

**Deliverables**: E2E test for discovery

---

### Task 8.2: Spawn Flow
**Estimated Context**: Medium

Test the complete spawn flow:
1. User finds valid spawn planet
2. User initiates spawn
3. Transaction succeeds
4. Player state updates
5. Planet ownership updates

**Deliverables**: E2E test for spawning

---

### Task 8.3: Attack Flow
**Estimated Context**: Medium

Test the complete attack flow:
1. User selects owned planet
2. User targets enemy/neutral planet
3. Attack transaction sent
4. Result received via indexer
5. State updates correctly

**Deliverables**: E2E test for attacking

---

## Testing Strategy Summary

| Task | Unit Tests | Integration Tests |
|------|------------|-------------------|
| 2.1 Noise | ✅ Determinism, vectors | - |
| 2.2 IndexedDB | ✅ CRUD operations | - |
| 2.3 Crypto | ✅ Encrypt/decrypt | - |
| 3.1-3.3 Stores | ✅ State management | ✅ Store interactions |
| 4.1-4.4 Transactions | ✅ Build correctly | ✅ With mock program |
| 5.1-5.3 Components | ✅ Render tests | - |
| 6.1-6.5 Three.js | ✅ Render tests | - |
| 8.1-8.3 E2E | - | ✅ Full flows |

---

## Dependencies

```
Client → ChainProgram: Uses IDL, shares noise function
Client → Indexer: WebSocket connection for events
```

## Notes for Subagent

1. **Noise function is critical** - must match chain exactly
2. **Use Svelte 5 runes** (`$state`, `$derived`, `$effect`) not stores
3. **Three.js cleanup** is important - dispose resources
4. **IndexedDB** for offline support and fast loads
5. **Test with mock data** before chain integration
