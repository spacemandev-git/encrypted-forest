# Encrypted Forest - Implementation Plan

## Progress Tracker

| Phase | Component               | Status | Notes                                                              |
| ----- | ----------------------- | ------ | ------------------------------------------------------------------ |
| 1A    | Project Scaffolding     | DONE   | `arcium init` complete, Anchor.toml → Surfpool                     |
| 1A    | Surfpool Scripts        | DONE   | dev-start.sh, dev-stop.sh, deploy-local.sh                         |
| 1A    | Docker Compose          | DONE   | Postgres + 2 ARX nodes, connects to Surfpool                       |
| 1A    | Makefile + package.json | DONE   | Bun workspaces, make targets                                       |
| 1A    | .gitignore              | DONE   | Covers build artifacts, secrets, SQLite                            |
| 1B    | Account Structures      | DONE   | Game, Player, CelestialBody, PendingMoves (1722 lines)             |
| 1C    | Arcis Circuits          | DONE   | create_planet_key, verify_spawn, resolve_combat (174 lines)        |
| 1D    | Program Instructions    | DONE   | 12 instructions + 3 callbacks + flush helper                       |
| 1E    | Hash-Based Noise        | DONE   | blake3 hash → body type/size/comets via byte ranges                |
| 1F    | Integration Tests       | DONE   | 8 test files, 3469 lines total, all compile                        |
| 2     | Docker Environment      | DONE   | docker-compose.yml + ARX node configs                              |
| 3     | Core SDK                | DONE   | 25 files, 41 tests passing, 0 TS errors                            |
| 4     | Client SDK + App        | DONE   | sdk/client (10 files) + client scaffold (10 files), Svelte 5 runes |

### Design Decisions Made

- **Hash-based noise** instead of perlin (user choice) — blake3 hash bytes determine body type/size/comets
- **Encryption**: Arcium MXE returns encrypted data, logged via standard Solana emit!()
- **Surfpool**: Configured as local validator at localhost:8899

---

## Architecture Overview

```
encrypted-forest.main/
├── programs/              # Arcium MXE program (arcium init)
│   └── encrypted-forest/
│       ├── src/
│       │   └── lib.rs     # Anchor/Arcium program entrypoints
│       └── encrypted-ixs/ # Arcis encrypted instructions (MPC circuits)
├── sdk/
│   ├── core/              # Framework-agnostic TS SDK (transactions, subscriptions, crypto)
│   └── client/            # Svelte 5 reactive layer (stores, persistence, plugins, UI)
├── client/                # Svelte 5 + ThreeJS game app (imports both SDKs)
├── tests/                 # Arcium test suite (Bun + @arcium-hq/client)
├── scripts/               # Surfpool launch scripts, deployment helpers
├── docs/
├── reference/
├── Arcium.toml
├── Anchor.toml
└── package.json           # Workspace root (Bun workspaces)
```

No backend indexer — the client fetches data directly from chain and subscribes to account/log updates via RPC websockets.

## Phased Implementation

### Phase 1: On-Chain Program + Local Testing Infrastructure

**Goal:** Fully working Arcium MXE program with all instructions, tested against Surfpool.

#### 1A: Project Scaffolding & Surfpool Integration

- `arcium init` in the project root to scaffold the MXE project in-place
- Configure Surfpool as the local validator instead of Arcium's default:
  - Surfpool CLI: `surfpool start --db ./dev.sqlite --block-production-mode clock --port 8899`
  - Transaction-only block production keeps footprint low
  - SQLite persistence lets us restart without losing state during dev
  - `--watch` flag for auto-redeploy on `.so` changes
- Configure `Anchor.toml` to point to `http://localhost:8899` (Surfpool RPC)
- Configure `Arcium.toml` for local cluster
- Script to launch Surfpool + Arcium ARX nodes together (`scripts/dev-start.sh`)
- Ensure `arcium test` bypasses its own validator startup and uses Surfpool's RPC

#### 1B: Account Structures & State Design

**Game Account** (PDA: `["game", game_id]`)

- Admin pubkey, config (map diameter, game speed, perlin thresholds, start/end time, win condition, whitelist settings)

**Player Account** (PDA: `["player", game_id, player_pubkey]`)

- Owner pubkey, game_id, points, has_spawned flag

**Celestial Body Account** (PDA: `["planet", game_id, hash(x, y, game_id)]`)

- Type enum (Planet, Quasar, SpacetimeRip, AsteroidBelt)
- Size (1-6), owner, ship_count, max_ship_capacity, ship_gen_speed
- metal_count, max_metal_capacity, metal_gen_speed
- range, launch_velocity, level, comets
- last_updated_slot (for deterministic generation computation)
- encryption_key_seed (the hash used for Arcium encrypted events)

**Pending Moves Account** (PDA: `["moves", game_id, planet_hash]`)

- Stack of pending moves with: source_planet, ships_sent, metal_sent, landing_slot, attacker_pubkey
- Must be flushed in landing_slot order before any new action from/to this planet

#### 1C: Arcis Encrypted Instructions (MPC Circuits)

These are the confidential computations that run on Arcium's MPC network:

1. **`create_planet_key`** - Given encrypted (x, y, game_id), compute hash and generate the planet encryption key. Returns encrypted key material.
2. **`verify_spawn_coordinates`** - Verify that encrypted (x, y) coordinates hash to a valid Miniscule neutral planet per the perlin noise function. Returns encrypted validation result + planet data.
3. **`encrypt_planet_event`** - Given planet state changes and the planet's encryption key, produce an encrypted event log that only discoverers can decrypt.
4. **`resolve_combat`** - Given attacker ships (with distance decay applied) and defender ships, compute combat outcome. Returns encrypted new planet state.

#### 1D: Program Instructions (Anchor Entrypoints)

1. **`create_game`** - Permissionless. Creates Game account with admin config.
2. **`init_player`** - Creates Player account. If whitelist enabled, requires server co-sign.
3. **`spawn`** - Once per player per game. Validates planet hash → Miniscule via perlin. Creates Celestial Body account. Invokes `create_planet_key` Arcium computation. Sets player as owner.
4. **`move`** (send ships/metal) - Validates source planet ownership. Flushes pending moves that would resolve before this action. Computes landing_slot from launch_velocity + distance. Pushes to target's pending_moves stack. Emits encrypted event.
5. **`upgrade`** - Spends metal to level up a Planet-type celestial body. Player chooses Range or Launch Velocity focus. Both options also double ship/metal capacities and gen speed.
6. **`broadcast`** - Emits unencrypted (x, y, game_id) log so all listeners can reveal the planet.
7. **`cleanup_account`** - After game end, anyone can close accounts to reclaim rent.
8. **`init_comp_def_*`** - One-time initialization of each Arcium computation definition.

#### 1E: Perlin Noise & Planet Generation

- Implement deterministic perlin noise function in Rust (both on-chain for validation and in Arcis circuits)
- Input: hash(x, y, game_id) → noise value → determines:
  - Dead space vs celestial body
  - Body type (planet/quasar/spacetime rip/asteroid belt)
  - Size (1-6) based on configurable difficulty thresholds
  - Comet spawning (85% none, 15% one, 5% two)
- Ship generation is deterministic: `current_ships = min(max_capacity, last_ship_count + gen_speed * (current_slot - last_updated_slot) / game_speed)`

#### 1F: Testing

- All tests in TypeScript using `@arcium-hq/client` + Bun test runner
- Test against Surfpool (`surfpool start --db ./test.sqlite --block-production-mode clock`)
- Test scenarios:
  1. Game creation with various configs
  2. Player initialization (with and without whitelist)
  3. Spawning at valid/invalid coordinates
  4. Ship movement, distance decay, landing time computation
  5. Combat resolution (attack neutral, attack enemy, reinforce own)
  6. Pending moves flush ordering
  7. Planet upgrades (range focus vs velocity focus)
  8. Broadcasting planet coordinates
  9. Account cleanup after game end
  10. Encrypted event emission and decryption by discoverers
  11. Fog of War: only players who know (x,y) can derive decryption key

### Phase 2: Deployable Arcium + Surfpool Environment

**Goal:** Reproducible local dev environment that anyone can spin up.

- Docker Compose setup with:
  - Surfpool container: `surfpool start --db /data/chain.sqlite --block-production-mode clock`
  - Arcium ARX node containers (using Arx Docker image from arcup)
  - Postgres container for Arcium callback server
  - Arcium callback server
- Shell script / Makefile for one-command startup
- Program auto-deploy on Surfpool startup
- Computation definition auto-initialization
- Documented in README with prerequisites

### Phase 3: Core SDK (`sdk/core`)

**Goal:** Framework-agnostic Bun + TypeScript SDK wrapping Arcium/Solana web3.js for transactions and subscriptions. Usable by plugins, bots, tests, or any JS environment.

```
sdk/core/
├── src/
│   ├── index.ts           # Main exports
│   ├── client.ts          # EncryptedForestClient class
│   ├── instructions/      # One file per instruction builder
│   │   ├── createGame.ts
│   │   ├── initPlayer.ts
│   │   ├── spawn.ts
│   │   ├── move.ts
│   │   ├── upgrade.ts
│   │   └── broadcast.ts
│   ├── accounts/          # Account fetching & deserialization
│   │   ├── game.ts
│   │   ├── player.ts
│   │   ├── celestialBody.ts
│   │   └── pendingMoves.ts
│   ├── crypto/            # Arcium encryption helpers
│   │   ├── planetKey.ts   # Derive planet encryption key from (x,y,gameId)
│   │   ├── rescue.ts      # RescueCipher wrapper
│   │   └── fog.ts         # Fog of war hash + reveal logic
│   ├── perlin/            # Client-side perlin noise (matching on-chain impl)
│   │   └── noise.ts
│   ├── subscriptions/     # RPC websocket subscriptions
│   │   ├── accounts.ts    # Account change listeners
│   │   └── logs.ts        # Log/event subscription + decryption
│   ├── types/             # Shared types
│   │   ├── game.ts
│   │   ├── celestialBody.ts
│   │   └── events.ts
│   └── utils/
│       └── pda.ts         # PDA derivation helpers
├── package.json
└── tsconfig.json
```

Key features:

- `EncryptedForestClient` class with methods for every instruction
- Planet coordinate hashing + PDA derivation
- Arcium encryption/decryption (RescueCipher wrapper)
- Fog of War: client-side coordinate scanning + hash verification
- Event subscription with automatic decryption for known planets
- Perlin noise matching on-chain implementation
- RPC websocket subscriptions for account updates
- No UI dependencies — pure data layer

### Phase 4: Client SDK (`sdk/client`) + Svelte 5 + ThreeJS Client

**Goal:** Svelte-specific SDK that builds on top of `sdk/core` to provide reactive UI primitives, plus the game client itself.

```
sdk/client/
├── src/
│   ├── index.ts           # Main exports
│   ├── stores/            # Svelte 5 rune-based reactive stores
│   │   ├── game.svelte.ts       # Reactive game state
│   │   ├── planets.svelte.ts    # Reactive discovered planets map
│   │   ├── player.svelte.ts     # Current player state
│   │   └── fogOfWar.svelte.ts   # Exploration state + scanning
│   ├── persistence/       # IndexedDB for local state
│   │   └── db.ts          # Discovered planets, decrypted events
│   ├── plugins/           # Plugin system types + loader
│   │   ├── types.ts       # Plugin API interface (exposes core SDK)
│   │   └── sandbox.ts     # Service worker sandbox for user plugins
│   └── ui/                # Reusable Svelte components for plugin authors
│       ├── Window.svelte        # Movable/resizable panel
│       └── types.ts             # UI component props/types
├── package.json
└── tsconfig.json
```

```
client/                    # The actual Svelte 5 + ThreeJS app
├── src/
│   ├── lib/               # Uses sdk/client stores + sdk/core
│   ├── routes/            # SvelteKit routes
│   └── ...
├── package.json
└── svelte.config.js
```

Key split:

- **`sdk/core`**: Pure data — transactions, subscriptions, crypto, perlin. No framework deps. Usable by bots/plugins/tests.
- **`sdk/client`**: Svelte 5 reactive layer — runes-based stores backed by core SDK, IndexedDB persistence, plugin system, reusable UI components.
- **`client/`**: The actual game app. Imports from both SDKs. ThreeJS rendering, SvelteKit routes, game UI.

---

## Parallel Subagent Strategy

4 consolidated agents:

| Agent                  | Responsibility                                                                                     | Dependencies                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **`program-agent`**    | All Rust code: account structs, perlin noise, Arcis circuits, Anchor instructions, callbacks       | None                               |
| **`infra-agent`**      | Docker Compose, Surfpool + Arcium local env, startup scripts                                       | None                               |
| **`test-agent`**       | Bun/TS integration tests using @arcium-hq/client                                                   | program-agent, infra-agent         |
| **`sdk-core-agent`**   | Core SDK: types, crypto, perlin port, client class, RPC subscriptions, events. No framework deps.  | test-agent (Phase 1 tests passing) |
| **`sdk-client-agent`** | Client SDK: Svelte 5 reactive stores, IndexedDB persistence, plugin system, reusable UI components | sdk-core-agent                     |

```
program-agent ──┬──→ test-agent ──→ sdk-core-agent ──→ sdk-client-agent
infra-agent ────┘
```

`program-agent` and `infra-agent` run in parallel. `test-agent` starts once both are done. `sdk-core-agent` starts after tests pass. `sdk-client-agent` builds on top of core.

## Key Technical Decisions

1. **No backend indexer**: The client fetches data directly from chain via RPC and subscribes to account/log updates over websockets. IndexedDB stores local state (discovered planets, decrypted events). This keeps the architecture simple — just on-chain program + client.

2. **Perlin Noise on-chain**: Must be deterministic and identical in Rust (on-chain), Arcis (MPC circuit), and TypeScript (client). Shared Rust library crate for on-chain + Arcis, then ported to TS for SDK.

3. **Lazy Evaluation Pattern**: Pending moves are stored in a separate account per planet. Before any action touching a planet, all moves with `landing_slot <= current_slot` must be flushed in order. Ship generation is computed deterministically from `last_updated_slot`.

4. **Encrypted Events via Arcium**: Planet encryption key = derived from `hash(x, y, game_id)`. Events (attacks, state changes) are emitted as Solana logs encrypted with this key. Only players who have discovered the (x,y) coordinate can derive the key and decrypt.

5. **Surfpool over solana-test-validator**: Surfpool with `--db ./dev.sqlite --block-production-mode clock` gives us persistent state, low footprint, and transaction-only block production. Need to ensure Arcium's ARX nodes can connect to Surfpool's RPC endpoint.

6. **Bun everywhere**: All TypeScript (tests, SDK, client) uses Bun runtime. No npm/node/JavaScript.
