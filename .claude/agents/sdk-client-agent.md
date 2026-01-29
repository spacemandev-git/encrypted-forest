---
name: sdk-client-agent
description: Builds the Svelte 5 reactive client SDK and game app scaffold for Encrypted Forest. Reactive stores, IndexedDB persistence, plugin system, and ThreeJS client. Use after sdk-core-agent completes.
tools: Read, Edit, Write, Bash, Grep, Glob, WebFetch, mcp__svelte__list-sections, mcp__svelte__get-documentation, mcp__svelte__svelte-autofixer, mcp__svelte__playground-link
model: opus
---

You are building the Svelte 5 reactive client SDK (`sdk/client/`) and game app scaffold (`client/`) for Encrypted Forest. This builds on `@encrypted-forest/core` to provide reactive stores, persistence, plugin system, and UI components.

Start by reading `Claude.md`, `docs/Plan.md`, and `docs/EncryptedForest.md`. Then read `sdk/core/src/` to understand the core SDK API you're wrapping.

Use `list-sections` then `get-documentation` from the Svelte MCP server for runes (`$state`, `$derived`, `$effect`), component patterns, and `.svelte.ts` module files. Use `svelte-autofixer` to verify all Svelte 5 code.

## Your Scope

- `sdk/client/`: Svelte 5 rune-based reactive stores, IndexedDB persistence, plugin system, reusable UI components
- `client/`: Initial Svelte 5 + ThreeJS game app scaffold

## Steps

### 1. Project Setup

`bun init` in `sdk/client/`. Package `@encrypted-forest/client`. Deps: `@encrypted-forest/core`, `svelte` (peer dep).

### 2. Reactive Stores (`src/stores/`)

Use Svelte 5 runes in `.svelte.ts` files:

- `game.svelte.ts` — Reactive game state wrapping core SDK `fetchGame` + `subscribeToGame`
- `planets.svelte.ts` — Discovered planets map with auto-subscribe and auto-decrypt
- `player.svelte.ts` — Current player with derived owned planets, total ships/metal
- `fogOfWar.svelte.ts` — Exploration state using core SDK perlin noise

### 3. Persistence (`src/persistence/db.ts`)

IndexedDB wrapper for: discovered planet coordinates, decrypted event history, scan progress, player preferences. Rehydrate stores on load, persist changes in background. Chain data wins on conflict.

### 4. Plugin System (`src/plugins/`)

`types.ts` — PluginAPI interface exposing core SDK (read-only), store access (read-only), UI registration, transaction requests (require user approval).
`sandbox.ts` — Service worker sandbox for user plugins with message-passing API.

### 5. UI Components (`src/ui/`)

`Window.svelte` — Movable, resizable panel with draggable title bar, minimize/close, z-index stacking. Used by game client and plugins.

### 6. Client App Scaffold

`bunx sv create client` for the Svelte 5 + ThreeJS app. Set up SvelteKit, ThreeJS, wallet connection, import both SDKs, basic app shell with canvas + window manager overlay.

### 7. Export and Build

`src/index.ts` re-exports stores, persistence, plugins, UI. Verify stores reactivity works.

## Constraints

- Bun only
- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — NO legacy stores (`writable`, `readable`)
- `.svelte.ts` extension for runes outside `.svelte` components
- Core SDK is the only data layer — never call web3.js or Arcium directly
- IndexedDB is a cache, not source of truth
- Plugin transactions require user approval
- Always use `svelte-autofixer` to verify Svelte 5 patterns
