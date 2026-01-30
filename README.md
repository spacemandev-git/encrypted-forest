# Encrypted Forest

A fully on-chain strategy game on Solana where players explore a hidden universe through fog of war, discover planets, build fleets, and compete for galactic dominance. All hidden information is secured by [Arcium](https://arcium.com)'s multi-party computation (MPC) network -- no server ever sees the full game state.

## Table of Contents

- [How to Play](#how-to-play)
  - [Game Overview](#game-overview)
  - [Getting Started](#getting-started)
  - [Celestial Bodies](#celestial-bodies)
  - [Actions](#actions)
  - [Win Conditions](#win-conditions)
- [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [On-Chain Program](#on-chain-program)
  - [Encrypted Instructions (Arcis Circuits)](#encrypted-instructions-arcis-circuits)
  - [Fog of War](#fog-of-war)
  - [Lazy Evaluation](#lazy-evaluation)
  - [Account Layout](#account-layout)
  - [Events](#events)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
  - [Commands](#commands)
  - [Local Infrastructure](#local-infrastructure)
  - [Testing](#testing)
- [SDK and Client](#sdk-and-client)
- [License](#license)

---

## How to Play

### Game Overview

Encrypted Forest is an asymmetric-information space strategy game. An admin creates a game instance with a procedurally generated map. Players join, explore the map through a fog of war, discover celestial bodies, build up ship fleets, and attack other planets to expand their territory. The twist: nobody -- not even the blockchain validators -- can see what you've discovered or where your planets are until you choose to reveal them.

The map is generated deterministically from a hash function. To explore, you hash coordinate pairs on your own machine. If the hash produces a valid celestial body, you've discovered a planet. The hash also serves as the encryption key for that planet's on-chain data, meaning only players who know the coordinates can decrypt updates.

### Getting Started

1. **An admin creates a game** with configured map size, game speed, noise thresholds, win condition, and time window (start/end slots).
2. **You register as a player** (`init_player`). If the game is whitelisted, you need a server co-signature.
3. **You explore the fog of war** by hashing `(x, y, game_id)` coordinates locally. You're looking for a valid **Miniscule Planet** (size 1, type Planet) to spawn at.
4. **You spawn** (`init_spawn_planet`) at a valid coordinate. This creates the planet account on-chain and sets you as the owner. You can only spawn once per game.
5. **You explore further** by continuing to hash coordinates, discovering neutral planets, asteroid belts, quasars, and spacetime rips.
6. **You send ships** (`process_move`) from planets you own to attack neutral or enemy planets, or reinforce your own.
7. **You upgrade planets** (`upgrade_planet`) by spending metal to increase their capabilities.
8. **You broadcast** (`broadcast`) planet coordinates to reveal them to all players -- useful for diplomacy or intimidation.

### Celestial Bodies

All celestial bodies have a **size** (1-6: Miniscule through Gargantuan) determined by the coordinate hash. Size affects base stats: capacities scale quadratically, generation speeds scale linearly.

| Type | Ship Gen | Metal Gen | Ship Cap | Metal Cap | Upgradeable | Notes |
|------|----------|-----------|----------|-----------|-------------|-------|
| **Planet** | Yes (if owned) | No | Moderate | -- | Yes | Only type that can be upgraded. Focus upgrades on Range or Launch Velocity. |
| **Quasar** | No | No | Very high | Very high | No | Massive storage, no production. |
| **Spacetime Rip** | Low | No | Low | -- | No | Burns metal for points (if game mode enabled). |
| **Asteroid Belt** | No | Yes | Moderate | High | No | The only source of metal generation. |

**Stats every celestial body has:**

- **Ship Count / Max Ship Capacity** -- Current ships and maximum. Neutral planets have a static "native population" that does not regenerate.
- **Ship Generation Speed** -- Ships per game tick. Only active when owned by a player.
- **Metal Count / Max Metal Capacity** -- Resource for upgrades.
- **Metal Generation Speed** -- Only asteroid belts generate metal.
- **Range** -- Distance ships can travel before losing units. Every `range` distance traveled costs 1 ship.
- **Launch Velocity** -- How fast ships travel. Higher velocity = shorter travel time.

**Comets:** Each celestial body has a chance of spawning with comets (85% none, 15% one, 5% two). Each comet doubles one stat (ship capacity, metal capacity, ship gen speed, metal gen speed, range, or launch velocity). Two comets always boost different stats.

### Actions

**Spawn** -- Search for a Miniscule Planet (size 1, type Planet) by hashing coordinates locally. Once found, call `init_spawn_planet` with encrypted coordinates. The MPC network validates the spawn and creates the planet with you as owner.

**Move (Attack/Reinforce)** -- Send ships (and optionally metal) from a planet you own to any target planet. Ships travel at the source planet's launch velocity and lose units based on distance vs. range. If the target is friendly, ships and metal are added (capped at capacity). If hostile, attacking ships reduce defending ships; if attackers remain after defenders are eliminated, the attacker claims the planet.

**Upgrade** -- Spend metal to upgrade a Planet (only planets, not other body types). Each upgrade level doubles Max Ship Capacity, Max Metal Capacity, and Ship Gen Speed. You choose to focus the upgrade on either Range (2x) or Launch Velocity (2x). Cost: `100 * 2^level` metal.

**Broadcast** -- Publicly reveal a planet's `(x, y, game_id)` coordinates so all players can see it. Useful for signaling, diplomacy, or baiting.

### Win Conditions

Games are configured with one of these win conditions:

- **Points (Burning Metal)** -- Burn metal at Spacetime Rips to earn points. Configurable points-per-metal ratio. Highest score at game end wins.
- **Race to the Center** -- Players spawn at a minimum distance from the map center. First to claim the center wins.

---

## Architecture

### Project Structure

```
encrypted-forest.main/
├── programs/encrypted_forest/src/lib.rs   # Anchor program: instructions, accounts, callbacks
├── encrypted-ixs/src/lib.rs               # Arcis circuits: encrypted MPC computations
├── sdk/
│   ├── core/                              # Framework-agnostic TS SDK (transactions, crypto, types)
│   └── client/                            # Svelte 5 reactive layer (stores, IndexedDB, plugins)
├── client/                                # Svelte 5 + ThreeJS game application
├── tests/                                 # Integration tests (Bun + Vitest)
├── scripts/                               # Dev environment management
├── docker-compose.yml                     # ARX node infrastructure
├── Anchor.toml                            # Anchor/Solana configuration
├── Arcium.toml                            # Arcium MPC cluster configuration
└── Makefile                               # Common dev commands
```

### On-Chain Program

The Solana program (`programs/encrypted_forest/src/lib.rs`) uses Anchor with Arcium extensions. It defines:

**Instructions:**

| Instruction | Purpose |
|---|---|
| `create_game` | Create a game instance with admin config |
| `init_player` | Register a player (with optional whitelist check) |
| `queue_init_planet` | Queue MPC computation to create a planet from encrypted coords |
| `queue_init_spawn_planet` | Queue MPC computation to create + spawn at a planet |
| `queue_process_move` | Queue MPC computation to validate and execute a ship movement |
| `queue_flush_planet` | Queue MPC computation to resolve up to 8 landed attacks |
| `queue_upgrade_planet` | Queue MPC computation to upgrade a planet |
| `broadcast` | Publicly reveal a planet's coordinates |
| `cleanup_game/player/planet` | Reclaim rent after game ends |

Each `queue_*` instruction builds an `ArgBuilder` with encrypted ciphertexts and plaintext parameters, then calls `queue_computation` to submit work to the Arcium MPC network. The MPC nodes execute the corresponding Arcis circuit and return encrypted results via a callback instruction (e.g., `init_planet_callback`).

**Computation definition initializers** (`init_comp_def_*`) register each circuit with the Arcium MXE after deployment. These must be called once before any gameplay instructions.

**Callbacks** (`*_callback`) receive BLS-signed computation outputs from the MPC cluster, verify the signature, and write encrypted results back to on-chain accounts.

### Encrypted Instructions (Arcis Circuits)

The MPC circuits (`encrypted-ixs/src/lib.rs`) run inside the Arcium network. They operate on encrypted data -- no single node sees plaintext values. The circuit language is a restricted Rust subset (no return statements, limited to arithmetic, if/else, and function calls).

**Circuits:**

| Circuit | Inputs | Outputs | Purpose |
|---|---|---|---|
| `init_planet` | Encrypted (x,y) + plaintext thresholds | PlanetStatic, PlanetDynamic, InitPlanetRevealed | Hash coords, determine body type/size/comets, build stats |
| `init_spawn_planet` | Encrypted (x,y,player_id,source_planet_id) + thresholds | PlanetStatic, PlanetDynamic, SpawnPlanetRevealed | Same as init + validate spawn (must be Miniscule Planet) |
| `process_move` | PlanetStatic, PlanetDynamic, ProcessMoveInput | Updated PlanetDynamic, PendingMoveData, MoveRevealed | Validate ownership, compute lazy generation, calculate distance/decay/landing |
| `flush_planet` | PlanetStatic, PlanetDynamic, 8x PendingMoveData, FlushTimingInput | Updated PlanetDynamic | Apply up to 8 landed moves sequentially (combat resolution) |
| `upgrade_planet` | PlanetStatic, PlanetDynamic, UpgradePlanetInput | Updated PlanetStatic, PlanetDynamic, UpgradeRevealed | Validate ownership + affordability, double stats |

**Encrypted data types:**
- `Enc<Shared, T>` -- Encrypted with a shared key that both the client and MXE can decrypt
- `Enc<Mxe, T>` -- Encrypted so only the MXE can decrypt (used for pending move data that players should not read)

### Fog of War

The fog of war is the core mechanic that makes Encrypted Forest unique:

1. **Exploration is local.** Players hash `(x, y, game_id)` on their own machine using iterated BLAKE3. The hash determines whether a celestial body exists at those coordinates and what its properties are.

2. **The hash is the encryption key.** The same hash that identifies a planet is used as the seed for its PDA (`["planet", game_id, hash]`) and as the basis for the encryption key that protects its on-chain data. Knowing the coordinates = knowing the key.

3. **Events are encrypted.** When actions happen on a planet (attacks, upgrades, etc.), the emitted Solana logs are encrypted. Only players who have discovered the planet's coordinates can decrypt them.

4. **Revealing is optional.** Players can `broadcast` coordinates to make a planet visible to everyone, but this is a strategic choice, not a requirement.

```
Player explores (x=5, y=3, game_id=1)
    │
    ▼
hash = BLAKE3(5 || 3 || 1)  ──repeated hash_rounds times
    │
    ├── byte[0] >= dead_space_threshold?  → Celestial body exists
    ├── byte[1] → body type (planet / quasar / spacetime rip / asteroid belt)
    ├── byte[2] → size (1-6)
    ├── byte[3] → comet count (0/1/2)
    └── hash → PDA seed + encryption key seed
```

### Lazy Evaluation

The game uses lazy evaluation to avoid the need for a cranking service:

- **Ship/metal generation** is not actively computed each slot. Instead, the `last_updated_slot` is stored, and current resources are calculated on-demand: `current = min(max_cap, stored + gen_speed * elapsed_slots / game_speed)`.

- **Pending moves** are stored in a sorted queue per planet. Before any new action on a planet, all moves with `landing_slot <= current_slot` must be **flushed** (resolved). The `flush_planet` circuit processes up to 8 moves per batch.

- **Combat resolution** during flush is sequential: each move's attacking ships are compared against the current defender count, ownership may change, and the next move resolves against the updated state.

### Account Layout

```
Game (PDA: ["game", game_id])
├── admin, game_id, map_diameter, game_speed
├── start_slot, end_slot, win_condition
├── whitelist, server_pubkey
├── noise_thresholds (10 u8 values)
└── hash_rounds

Player (PDA: ["player", game_id, owner_pubkey])
├── owner, game_id, points, has_spawned

EncryptedCelestialBody (PDA: ["planet", game_id, planet_hash])
├── planet_hash [32 bytes]
├── last_updated_slot, last_flushed_slot
├── Static section (encrypted): pubkey + nonce + 12 ciphertexts
│   └── body_type, size, max_ship_cap, ship_gen, max_metal_cap,
│       metal_gen, range, velocity, level, comet_count, comet_0, comet_1
└── Dynamic section (encrypted): pubkey + nonce + 4 ciphertexts
    └── ship_count, metal_count, owner_exists, owner_id

PendingMovesMetadata (PDA: ["moves", game_id, planet_hash])
├── game_id, planet_hash, next_move_id, move_count
├── queued_count + queued_landing_slots[8]  (FIFO buffer for callbacks)
└── moves: Vec<PendingMoveEntry>  (sorted by landing_slot)

PendingMoveAccount (PDA: ["move", game_id, planet_hash, move_id])
├── game_id, planet_hash, move_id, landing_slot, payer
└── enc_nonce + enc_ciphertexts[4]  (ships, metal, attacking_planet_id, attacking_player_id)
```

The `EncryptedCelestialBody` account stores two encrypted sections at fixed byte offsets so that MPC nodes can read them directly via `ArgBuilder::account()` without deserialization:
- **Static section** starts at byte offset 56 (432 bytes)
- **Dynamic section** starts at byte offset 488 (176 bytes)

### Events

All gameplay events are emitted as Solana logs. Most are encrypted so only players who know the planet's coordinates can decrypt:

| Event | Fields | Encrypted? |
|---|---|---|
| `InitPlanetEvent` | planet_hash, valid, encryption_key, nonce | Yes |
| `InitSpawnPlanetEvent` | planet_hash, valid, spawn_valid, encryption_key, nonce | Yes |
| `ProcessMoveEvent` | landing_slot, surviving_ships, valid, encryption_key, nonce | Yes |
| `FlushPlanetEvent` | planet_hash, flushed_count | No (metadata only) |
| `UpgradePlanetEvent` | planet_hash, success, new_level, encryption_key, nonce | Yes |
| `BroadcastEvent` | x, y, game_id, planet_hash, broadcaster | No (intentionally public) |

---

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (with the toolchain specified in `rust-toolchain.toml`)
- [Bun](https://bun.sh/) (used instead of Node.js everywhere)
- [Arcium CLI](https://docs.arcium.com/) (`arcium` -- wraps Anchor)
- [Surfpool](https://docs.surfpool.run/) (local Solana validator replacement)
- [Docker](https://www.docker.com/) (for ARX MPC nodes)

### Quick Start

```bash
# Clean slate + full local bootstrap (builds, deploys, starts Surfpool + ARX nodes)
make clean && ./scripts/run-local.sh
```

That single command handles everything: dependency checks, keypair generation, building the program, starting Surfpool, initializing the Arcium network and ARX nodes via Docker, deploying the program, initializing the MXE, uploading circuits, and copying the IDL into SDK packages. Verbose logs go to `logs/run-local-verbose.log`.

On subsequent runs you can skip steps:

```bash
# Re-run without rebuilding or re-deploying
./scripts/run-local.sh --skip-build --skip-deploy

# Re-run without dependency checks
./scripts/run-local.sh --skip-deps
```

Once the environment is running:

```bash
# Run integration tests against the local environment
make test-local

# Stop everything (Surfpool + Docker ARX nodes)
make stop
```

### Commands

| Command | Description |
|---|---|
| `make clean && ./scripts/run-local.sh` | Full clean bootstrap (the primary dev workflow) |
| `make test-local` | Run tests against already-running local environment |
| `make stop` | Stop all dev services (Surfpool + Docker) |
| `make build` | Build the Arcium MXE program (`arcium build`) |
| `make test` | Run `arcium test` (starts its own local cluster) |
| `make clean` | Remove build artifacts, databases, Docker volumes |
| `make install` | Install Bun dependencies |

### Local Infrastructure

`./scripts/run-local.sh` orchestrates the full local environment. Under the hood it manages two components:

**Surfpool** -- A drop-in replacement for `solana-test-validator` with SQLite persistence (`dev.sqlite`). Runs natively (no Docker image) on port 8899.

**ARX Nodes** -- Arcium MPC nodes that execute the encrypted circuits. Run via Docker Compose (`docker-compose.yml`) with a custom bridge network (`172.20.0.0/16`):
- 3 main cluster nodes (`172.20.0.100-102`)
- 1 extra recovery node (`172.20.0.103`)
- 1 trusted dealer for DKG key distribution (`172.20.0.99`)

The bootstrap script handles: dependency checks, keypair generation (admin + all ARX nodes), building, starting Surfpool, deploying Arcium network programs, registering and activating ARX clusters, deploying the game program, initializing the MXE, finalizing DKG keys, uploading circuits, and copying the IDL. Configuration is in `Arcium.toml` (3-node cluster, Cerberus backend).

### Testing

Tests are in the `tests/` directory using Bun + Vitest:

| Test File | Coverage |
|---|---|
| `arcium.test.ts` | Arcium MPC integration, computation definitions |
| `game.test.ts` | Game creation, configuration validation |
| `player.test.ts` | Player registration, whitelist logic |
| `spawn.test.ts` | Planet spawning via encrypted coordinates |
| `movement.test.ts` | Ship movement, distance decay, combat resolution |
| `upgrade.test.ts` | Planet upgrades, metal spending |
| `broadcast.test.ts` | Coordinate broadcasting |
| `cleanup.test.ts` | Post-game account cleanup and rent reclamation |

Run with `make test-local` against a running local environment, or `make test` to let Arcium manage the test cluster.

---

## SDK and Client

The project includes a TypeScript SDK (Bun) split into two layers:

**`sdk/core`** -- Framework-agnostic core SDK. Handles:
- Transaction building for all on-chain instructions
- X25519 encryption/decryption for Arcium ciphertexts
- BLAKE3 hashing for fog-of-war planet discovery
- Perlin noise computation (matching the on-chain deterministic hash)
- Account deserialization and type definitions
- RPC subscriptions for account changes and logs

**`sdk/client`** -- Svelte 5 reactive layer built on top of core. Provides:
- Reactive stores for game state (planets, players, pending moves)
- IndexedDB persistence for discovered planets and decrypted events
- Plugin system for user-created JavaScript extensions
- Modular windowed UI components for the ThreeJS canvas

**`client/`** -- The game application itself. Svelte 5 + ThreeJS with:
- Shader-based planet rendering (color/size by type)
- Movable windowed UI on the game canvas
- Direct chain interaction (no backend indexer)
- WebSocket subscriptions for real-time updates

The client fetches all data directly from the Solana RPC. On load, it re-fetches all known planet accounts from IndexedDB and subscribes to ongoing updates. Fog-of-war exploration runs entirely client-side.

---

## License

MIT
