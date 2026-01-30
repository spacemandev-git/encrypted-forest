# Claude.md - Encrypted Forest Project Context

# Critical

ALWAYS ask questions if anything is unclear
ALWAYS try to do as many tasks in parallel using subagents if possible

## Project Overview

Encrypted Forest is a Solana blockchain game using Arcium MPC network for fog-of-war hidden information mechanics. Players explore a procedurally generated map, discover planets via hash-based fog of war, and compete through ship-based combat.

## Tech Stack

- **On-chain**: Arcium MXE (wraps Anchor/Solana) + Arcis encrypted instructions
- **Local Dev**: Surfpool (drop-in solana-test-validator replacement) + Arcium ARX nodes
- **SDK**: Bun + TypeScript
- **Client**: Svelte 5 + ThreeJS — fetches all data directly from chain via RPC + websocket subscriptions
- **Runtime**: Bun everywhere (NO npm/node/javascript)
- **No backend indexer** — client does its own RPC reads, subscriptions, and local IndexedDB caching

## Architecture

### Monorepo Structure

```
encrypted-forest.main/
├── programs/encrypted-forest/    # Arcium MXE program
│   ├── src/lib.rs                # Anchor entrypoints + callbacks
│   └── encrypted-ixs/           # Arcis MPC circuits
├── sdk/
│   ├── core/                     # Framework-agnostic TS SDK (transactions, subscriptions, crypto)
│   └── client/                   # Svelte 5 reactive layer (stores, persistence, plugins, UI)
├── client/                       # Svelte 5 + ThreeJS game app (imports both SDKs)
├── tests/                        # Integration tests
├── scripts/                      # Dev environment scripts
├── docs/                         # Design docs
└── reference/                    # Reference materials
```

### Key Accounts (PDAs)

- **Game**: `["game", game_id]` - Admin config, map size, win conditions, perlin thresholds
- **Player**: `["player", game_id, player_pubkey]` - Owner, points, spawn status
- **Celestial Body**: `["planet", game_id, hash(x,y,game_id)]` - Type, size, ships, metal, range, velocity, owner
- **Pending Moves**: `["moves", game_id, planet_hash]` - Ordered attack/transfer queue

### Arcium Integration

- Arcium CLI wraps Anchor CLI: use `arcium init`, `arcium build`, `arcium test`
- Encrypted instructions (Arcis) go in `encrypted-ixs/` directory
- Confidential instructions use `#[encrypted]` module + `#[instruction]` functions
- Data types: `Enc<Shared, T>` (client+MXE can decrypt), `Enc<Mxe, T>` (MXE only)
- Callbacks use `#[arcium_callback(encrypted_ix = "name")]` macro
- Computation definitions must be initialized once after deploy via `init_comp_def`
- BLS signature verification on outputs via `SignedComputationOutputs::verify_output()`

### Surfpool Configuration

- Start: `surfpool start --db ./dev.sqlite --block-production-mode clock --port 8899`
- SQLite persistence across restarts
- Must configure Arcium to use Surfpool RPC instead of its own validator

### Fog of War Mechanic

1. Player hashes `(x, y, game_id)` client-side
2. Hash determines if coordinate contains a celestial body (perlin noise)
3. Hash is also the PDA seed for the planet account AND the encryption key seed
4. Knowing (x,y) = knowing the decryption key for that planet's events
5. Events emitted as encrypted Solana logs; only discoverers can decrypt

### Lazy Evaluation Pattern

- Pending moves stored in separate account per planet
- Before ANY action on a planet: flush all moves where `landing_slot <= current_slot`
- Ship generation: `ships = min(max_cap, last_count + gen_speed * (current_slot - last_slot) / game_speed)`
- No cranking needed; chain evaluates lazily, client shows optimistic state

### Client Data Strategy (No Indexer)

- Client fetches account data directly via RPC (`getAccountInfo`, `getProgramAccounts`)
- Subscribes to account changes and logs via RPC websockets
- Stores discovered planets and decrypted events in IndexedDB
- On load: re-fetches all known planet accounts, subscribes to ongoing updates
- Perlin noise runs client-side for fog-of-war exploration

## Implementation Phases

1. **Phase 1**: On-chain program + Surfpool testing (CURRENT)
2. **Phase 2**: Deployable Arcium + Surfpool Docker environment
3. **Phase 3**: TypeScript SDK (Bun)
4. **Phase 4**: Svelte 5 + ThreeJS client

## Subagent Strategy

5 agents, 2 can run in parallel at start:

```
program-agent ──┬──→ test-agent ──→ sdk-core-agent ──→ sdk-client-agent
infra-agent ────┘
```

- **program-agent**: All Rust (accounts, perlin, Arcis circuits, instructions, callbacks)
- **infra-agent**: Docker Compose, Surfpool + Arcium local env, scripts
- **test-agent**: Bun/TS integration tests
- **sdk-core-agent**: Framework-agnostic core SDK (transactions, subscriptions, crypto, perlin, types)
- **sdk-client-agent**: Svelte 5 reactive stores, IndexedDB persistence, plugin system, reusable UI

## Commands

- `arcium init` - Scaffold MXE project in current directory (no subfolder)
- `arcium build` - Build program + encrypted instructions
- `arcium test` - Run tests (default: local cluster)
- `arcium test --cluster devnet` - Test against devnet
- `surfpool start --db ./dev.sqlite --block-production-mode clock` - Start local validator
- `bun test` - Run SDK/client tests
- `bun install` - Install dependencies (NOT npm install)

## References

- **Arcium Examples**: https://github.com/arcium-hq/examples/tree/main
  - Getting Started: Coinflip (ArcisRNG), Rock Paper Scissors (encrypted async gameplay)
  - Intermediate: Voting (private ballots), Medical Records (re-encryption), Sealed-Bid Auction
  - Advanced: Blackjack (hidden deck state, base-64 compression), Ed25519 Signatures (distributed key mgmt)
  - All examples use Rust (52%) + TypeScript (46%) - good patterns for our program + test structure
- **Arcium Docs**: https://docs.arcium.com/developers
- **Surfpool Docs**: https://docs.surfpool.run
- **ThreeJS Reference**: `reference/threejs/` directory (00-10 markdown guides)

## Conventions

- All TypeScript uses Bun runtime
- Rust for on-chain code (Anchor/Arcium/Arcis)
- Account structs defined once, shared between instructions
- PDA seeds use byte-prefixed patterns: `["prefix", ...keys]`
- Perlin noise implementation must be identical in Rust, Arcis, and TypeScript
- Encrypted events keyed by `hash(x, y, game_id)` - this is the core fog of war secret
