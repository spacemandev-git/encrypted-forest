# Encrypted Forest - Local Dev Walkthrough

End-to-end guide: install prerequisites, start the local environment, build & deploy the program, connect the SDK, and run the client.

---

## 0. Prerequisites

Install these before anything else:

| Tool | Purpose | Install |
|------|---------|---------|
| **Rust 1.89+** | On-chain program | `rustup install 1.89.0` (repo has `rust-toolchain.toml`) |
| **Bun** | JS runtime (replaces npm/node) | `curl -fsSL https://bun.sh/install \| bash` |
| **Arcium CLI** | Build & test MXE programs | `curl -fsSL https://install.arcium.com \| bash && arcup install` |
| **Surfpool** | Local Solana validator | See [docs.surfpool.run](https://docs.surfpool.run) |
| **Docker + Compose** | ARX MPC nodes + Postgres | [docker.com](https://docker.com) |
| **Solana CLI** | Keypair management | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| **Wrangler** (optional) | Circuit uploads to R2 | `bun add -g wrangler` |

Verify everything is installed:

```bash
rustc --version        # 1.89.0+
bun --version          # 1.x
arcium --version
surfpool --version
docker --version
solana --version
```

Make sure you have a Solana keypair:

```bash
# Check for existing keypair
ls ~/.config/solana/id.json

# If missing, generate one (localnet only, no real funds needed)
solana-keygen new
```

> **Automated alternative:** `./scripts/run-local.sh` performs every step in this walkthrough (sections 1–5) in a single command. See [Section 9](#9-full-startup-sequence-copy-paste) for details.

---

## 1. Install Dependencies

```bash
cd encrypted-forest.main
bun install
```

This installs all workspace packages (`sdk/core`, `sdk/client`, `client`, `tests`).

---

## 2. Start Surfpool (Local Validator)

Surfpool is a drop-in replacement for `solana-test-validator` with SQLite persistence and transaction-only block production.

### Option A: Surfpool only (no MPC)

Good for developing non-encrypted instructions, testing account logic, or working on the client.

```bash
make dev
# or: ./scripts/dev-start.sh
```

This will:
- Start Surfpool on **port 8899** (RPC) and **8900** (WebSocket)
- Persist state in `./dev.sqlite`
- Only produce blocks when transactions arrive (low resource usage)
- Log to `./logs/surfpool.log`

Wait for `ready.` to appear, then verify:

```bash
curl http://localhost:8899/health
# Should return "ok"
```

### Option B: Surfpool + ARX nodes (full MPC)

Required for testing encrypted instructions (Arcis circuits). Adds 2 ARX MPC nodes and a Postgres database via Docker.

```bash
make dev-docker
# or: ./scripts/dev-start.sh --docker
```

This starts Surfpool (same as above) **plus** Docker Compose services:
- **Postgres** (port 5432) - Arcium callback database
- **ARX Node 1** (ports 8001-8002, 8012-8013, 9091)
- **ARX Node 2** (ports 8003-8004, 8014-8015, 9092)

The ARX nodes connect to Surfpool via `host.docker.internal:8899`.

#### ARX Node Keypairs (first-time setup)

The ARX nodes need keypairs in `arx-keys/node-{1,2}/`. These are gitignored and must be generated once per node. Each node requires 5 key files generated with different tools:

```bash
# For each node (repeat for node-1 and node-2):
NODE_DIR=arx-keys/node-1
mkdir -p "$NODE_DIR"

# 1. Node keypair (Solana keypair — the node's on-chain identity)
solana-keygen new --outfile "$NODE_DIR/node-keypair.json" --no-bip39-passphrase

# 2. Callback authority keypair (Solana keypair — signs callback TXs)
solana-keygen new --outfile "$NODE_DIR/callback-kp.json" --no-bip39-passphrase

# 3. Identity keypair (Ed25519 PEM — libp2p peer identity)
openssl genpkey -algorithm Ed25519 -out "$NODE_DIR/identity.pem"

# 4. BLS keypair (for aggregated signature verification)
arcium gen-bls-key "$NODE_DIR/bls-keypair.json"

# 5. X25519 keypair (for MXE encryption key exchange)
arcium generate-x25519 --output "$NODE_DIR/x25519-keypair.json"
```

Each node directory should contain:
```
arx-keys/node-1/
  node-config.toml          # Already checked in (points to host.docker.internal:8899)
  node-keypair.json          # Generated — solana-keygen
  callback-kp.json           # Generated — solana-keygen
  identity.pem               # Generated — openssl
  bls-keypair.json           # Generated — arcium gen-bls-key
  x25519-keypair.json        # Generated — arcium generate-x25519
```

> `run-local.sh` generates all missing keys automatically.

Verify Docker is running:

```bash
docker compose ps
# Should show ef-postgres, ef-arx-node-1, ef-arx-node-2 as "running"
```

### Option C: Watch mode (auto-redeploy)

Surfpool watches for `.so` file changes and auto-redeploys:

```bash
make dev-watch
# or: ./scripts/dev-start.sh --watch
```

---

## 3. Initialize Arcium Network on Surfpool

Before building or deploying the game program, the Arcium network programs and on-chain state must be initialized on Surfpool. This is a one-time setup (persisted in `dev.sqlite`).

> `arcium test` and `arcium localnet` handle this automatically for ephemeral clusters. The steps below are for the **persistent Surfpool + Docker** setup (`make dev-docker`).

### Admin keypair

Create a dedicated admin keypair for Arcium operations. This is gitignored and separate from `~/.config/solana/id.json`:

```bash
solana-keygen new --outfile admin.json --no-bip39-passphrase

# Fund it on Surfpool (100 SOL)
solana airdrop 100 "$(solana address --keypair admin.json)" --url http://localhost:8899
```

### Fund ARX node keypairs

Each node keypair and callback keypair needs SOL for on-chain transactions:

```bash
for i in 1 2; do
  solana airdrop 100 "$(solana address --keypair arx-keys/node-$i/node-keypair.json)" --url http://localhost:8899
  solana airdrop 100 "$(solana address --keypair arx-keys/node-$i/callback-kp.json)" --url http://localhost:8899
done
```

### Step-by-step Arcium initialization

The full sequence deploys the Arcium programs, registers nodes, forms a cluster, and activates it:

```bash
RPC=http://localhost:8899

# 1. Deploy Arcium network programs to Surfpool
arcium init-arcium-network --keypair-path admin.json --rpc-url $RPC

# 2. Register each ARX node on-chain
for i in 1 2; do
  OFFSET=$((i - 1))
  IP="172.20.0.$((99 + i))"   # 172.20.0.100 for node-1, .101 for node-2
  arcium init-arx-accs \
    --keypair-path arx-keys/node-$i/node-keypair.json \
    --callback-keypair-path arx-keys/node-$i/callback-kp.json \
    --peer-keypair-path arx-keys/node-$i/identity.pem \
    --bls-keypair-path arx-keys/node-$i/bls-keypair.json \
    --x25519-keypair-path arx-keys/node-$i/x25519-keypair.json \
    --node-offset $OFFSET \
    --ip-address $IP \
    --rpc-url $RPC
done

# 3. Create a 2-node cluster (offset=0)
arcium init-cluster \
  --keypair-path admin.json \
  --offset 0 \
  --max-nodes 2 \
  --rpc-url $RPC

# 4. Propose and accept each node into the cluster
for i in 1 2; do
  OFFSET=$((i - 1))
  arcium propose-join-cluster \
    --keypair-path admin.json \
    --cluster-offset 0 \
    --node-offset $OFFSET \
    --rpc-url $RPC

  arcium join-cluster true \
    --keypair-path arx-keys/node-$i/node-keypair.json \
    --node-offset $OFFSET \
    --cluster-offset 0 \
    --rpc-url $RPC
done

# 5. Each node submits its aggregated BLS key
for i in 1 2; do
  OFFSET=$((i - 1))
  arcium submit-aggregated-bls-key \
    --keypair-path arx-keys/node-$i/node-keypair.json \
    --cluster-offset 0 \
    --node-offset $OFFSET \
    --rpc-url $RPC
done

# 6. Activate the cluster
arcium activate-cluster \
  --keypair-path admin.json \
  --cluster-offset 0 \
  --rpc-url $RPC
```

After activation, start the Docker ARX nodes so they can process MPC computations:

```bash
docker compose up -d
docker compose ps    # Verify all 3 services are running
```

### Verify the network

```bash
# Check cluster info
arcium list-clusters --rpc-url http://localhost:8899

# Check individual nodes
arcium arx-info 0 --rpc-url http://localhost:8899
arcium arx-info 1 --rpc-url http://localhost:8899
```

---

## 4. Build the Program

```bash
make build
# or: arcium build
```

This compiles:
- **Rust program** -> `target/deploy/encrypted_forest.so`
- **Arcis circuits** -> `build/*.arcis` (5 circuit files)
- **IDL** -> `target/idl/encrypted_forest.json`

The 5 encrypted circuits:

| Circuit | What it does | Size |
|---------|-------------|------|
| `init_planet.arcis` | Hash coords -> generate planet stats | ~2 MB |
| `init_spawn_planet.arcis` | Same + validate spawn conditions | ~2 MB |
| `process_move.arcis` | Validate + encrypt a ship movement | ~6 MB |
| `flush_planet.arcis` | Apply up to 8 pending moves in batch | ~19 MB |
| `upgrade_planet.arcis` | Upgrade planet stats, deduct metal | ~2 MB |

---

## 5. Deploy to Local Surfpool

### Quick deploy (program only, no circuits)

If you just need the Anchor program deployed without MPC:

```bash
anchor deploy --provider.cluster http://localhost:8899
```

### Full deploy (program + MXE + circuits)

This is the complete pipeline: deploy the program, initialize its MXE (MPC eXecution Environment), upload circuits, and finalize encryption keys.

```bash
RPC=http://localhost:8899

# 1. Deploy program and initialize MXE in one step
arcium deploy \
  --keypair-path admin.json \
  --cluster-offset 0 \
  --recovery-set-size 2 \
  --program-name encrypted_forest \
  --rpc-url $RPC

# 2. Finalize MXE keys (triggers Distributed Key Generation on the ARX nodes)
#    The ARX Docker nodes must be running for this step.
PROGRAM_ID=$(solana address --keypair target/deploy/encrypted_forest-keypair.json)
arcium finalize-mxe-keys "$PROGRAM_ID" \
  --keypair-path admin.json \
  --cluster-offset 0 \
  --rpc-url $RPC

# 3. Upload circuits to R2 (requires CIRCUIT_BUCKET env var)
export CIRCUIT_BUCKET=your-r2-bucket-name
./scripts/upload-circuits.sh

# 4. Initialize computation definitions (if script exists)
# bun run scripts/init-comp-defs.ts
```

Alternatively, `scripts/deploy-local.sh` runs the build + legacy deploy pipeline (without MXE init):

```bash
export CIRCUIT_BUCKET=your-r2-bucket-name
make deploy
# or: ./scripts/deploy-local.sh
```

#### Circuit Upload Setup (one-time)

The ARX nodes fetch circuit definitions from a URL. For local dev, you need an R2 bucket:

```bash
# Login to Cloudflare
bun x wrangler login

# Create a bucket (one-time)
bun x wrangler r2 bucket create spacerisk

# Set env vars (add to .env or shell profile)
export CIRCUIT_BUCKET=spacerisk
export CIRCUIT_BASE_URL=https://s3.spacerisk.io/spacerisk

# Upload circuits manually if needed
./scripts/upload-circuits.sh
```

---

## 6. Arcium Configuration

The Arcium integration is configured across several files:

### `Arcium.toml`

```toml
[localnet]
nodes = 2                                         # 2 ARX nodes for localnet MPC
nodes_ips = [[172, 20, 0, 100], [172, 20, 0, 101]]  # Docker network IPs
backends = ["Cerberus"]                            # MPC backend
```

### `Anchor.toml`

```toml
[programs.localnet]
encrypted_forest = "B1TzhUCEMvuHEvjSBGLQuHfCdQTPRDXUMYci3bfd5kfQ"

[provider]
cluster = "http://localhost:8899"    # Points to Surfpool, NOT default Solana devnet
wallet = "~/.config/solana/id.json"
```

### `arx-keys/node-{1,2}/node-config.toml`

```toml
[node]
offset = 0              # 0 for node-1, 1 for node-2

[solana]
endpoint_rpc = "http://host.docker.internal:8899"   # Surfpool via Docker host
endpoint_wss = "ws://host.docker.internal:8900"
cluster = "Localnet"
```

### How it all connects

```
┌──────────────┐
│  Client/SDK  │──── RPC ────▶ localhost:8899 ───▶ Surfpool
└──────────────┘                                     │
                                                     │ (program deployed here)
                                                     ▼
                                              ┌──────────────┐
                                              │  Encrypted    │
                                              │  Forest .so   │
                                              └──────┬───────┘
                                                     │
                                          Arcium CPI │ (queue_computation)
                                                     ▼
                                    ┌────────────────────────────┐
                                    │     Arcium MXE Program     │
                                    └────────────┬───────────────┘
                                                 │
                               Fetch circuits    │  Dispatch MPC
                               from R2 URL       │
                                                 ▼
                              ┌──────────────────────────────────┐
                              │  ARX Node 1  ◄──MPC──▶  ARX Node 2  │
                              │  (Docker)                (Docker)    │
                              └──────────────────┬───────────────────┘
                                                 │
                                    Callback TX  │ (results back on-chain)
                                                 ▼
                                           Surfpool
```

---

## 7. Run Tests

### Integration tests (arcium spins up its own cluster)

```bash
make test
# or: arcium test
```

This starts a temporary Surfpool + ARX nodes, deploys, runs `vitest run`, and tears everything down.

### Tests against your running Surfpool

```bash
make test-local
# or: arcium test --cluster devnet
```

Uses your already-running `make dev-docker` environment.

### Unit tests only

```bash
bun run test:unit
# or: vitest run
```

### Single test file

```bash
bun test tests/game.test.ts
```

---

## 8. SDK Setup

The SDK is split into two workspace packages:

### `sdk/core` — Framework-agnostic TypeScript

Pure data layer: transactions, subscriptions, crypto, perlin noise. No UI framework dependency.

```typescript
import {
  EncryptedForestClient,
  computePlanetHash,
  deriveGamePDA,
  derivePlanetPDA,
} from "@encrypted-forest/core";

// Create client
const client = new EncryptedForestClient(connection, wallet);

// Derive PDAs
const [gamePDA] = deriveGamePDA(gameId);
const planetHash = computePlanetHash(x, y, gameId, hashRounds);
const [planetPDA] = derivePlanetPDA(gameId, planetHash);

// Build and send transactions
const tx = await client.createGame({ mapSize: 100, hashRounds: 100, ... });
```

### `sdk/client` — Svelte 5 Reactive Layer

Wraps the core SDK with Svelte 5 runes-based reactive stores, IndexedDB persistence, and a plugin system.

```typescript
import { GameStore, PlanetsStore, PlayerStore } from "@encrypted-forest/client";

// Reactive stores (Svelte 5 runes)
const gameStore = new GameStore(connection, gameId);
const planetsStore = new PlanetsStore(connection, gameId);

// Automatically subscribes to on-chain updates via WebSocket
// Persists discovered planets to IndexedDB
```

Both packages are Bun workspaces — they're linked automatically after `bun install`.

---

## 9. Run the Client

The game client is a SvelteKit app with ThreeJS rendering.

```bash
cd client
bun run dev
```

Opens at `http://localhost:5173` (default Vite port).

The client:
- Connects to Surfpool RPC at `localhost:8899` and WebSocket at `localhost:8900`
- Fetches all game/player/planet accounts directly via RPC
- Subscribes to account changes via WebSocket (no indexer needed)
- Stores discovered planets in IndexedDB for offline access
- Runs perlin noise client-side for fog-of-war exploration

### Production build

```bash
cd client
bun run build
# Output in client/build/ (static SPA, adapter-static)
```

---

## 10. Full Startup Sequence

### Automated (recommended)

`run-local.sh` performs every step below in a single command:

```bash
./scripts/run-local.sh
```

Flags for re-runs: `--skip-deps`, `--skip-build`, `--skip-deploy`.

### Manual (copy-paste)

From a clean state, here's every command in order:

```bash
RPC=http://localhost:8899

# 1. Install deps
bun install

# 2. Generate admin keypair (gitignored)
solana-keygen new --outfile admin.json --no-bip39-passphrase

# 3. Generate ARX node keys (see Section 2 for per-key commands)
#    Repeat for node-1 and node-2

# 4. Start Surfpool
./scripts/dev-start.sh
# Wait for "ready."
solana airdrop 100 "$(solana address --keypair admin.json)" --url $RPC

# 5. Fund ARX node keypairs
for i in 1 2; do
  solana airdrop 100 "$(solana address --keypair arx-keys/node-$i/node-keypair.json)" --url $RPC
  solana airdrop 100 "$(solana address --keypair arx-keys/node-$i/callback-kp.json)" --url $RPC
done

# 6. Initialize Arcium network (see Section 3 for full details)
arcium init-arcium-network --keypair-path admin.json --rpc-url $RPC
# ... init-arx-accs, init-cluster, propose/join, BLS keys, activate-cluster
# (see Section 3 or use run-local.sh)

# 7. Start Docker ARX nodes
docker compose up -d
docker compose ps

# 8. Build program + circuits
make build

# 9. Deploy program + MXE
arcium deploy \
  --keypair-path admin.json \
  --cluster-offset 0 \
  --recovery-set-size 2 \
  --program-name encrypted_forest \
  --rpc-url $RPC

# 10. Finalize MXE keys (triggers DKG — Docker nodes must be running)
PROGRAM_ID=$(solana address --keypair target/deploy/encrypted_forest-keypair.json)
arcium finalize-mxe-keys "$PROGRAM_ID" \
  --keypair-path admin.json --cluster-offset 0 --rpc-url $RPC

# 11. Upload circuits + init comp defs
export CIRCUIT_BUCKET=your-bucket
./scripts/upload-circuits.sh

# 12. Run tests to verify
make test-local

# 13. Start the client
cd client && bun run dev
# Open http://localhost:5173
```

---

## 11. Stopping Everything

```bash
make stop
# or: ./scripts/dev-stop.sh
```

This gracefully stops Surfpool (SIGTERM, then SIGKILL after 10s) and runs `docker compose down` if Docker services are running.

### Full cleanup (removes all build artifacts, DBs, Docker volumes)

```bash
make clean
```

---

## Port Reference

| Port | Service |
|------|---------|
| 8899 | Surfpool RPC (HTTP) |
| 8900 | Surfpool WebSocket |
| 5173 | Client dev server (Vite) |
| 5432 | Postgres (Docker) |
| 8001-8002 | ARX Node 1 |
| 8003-8004 | ARX Node 2 |
| 8012-8013 | ARX Node 1 callbacks |
| 8014-8015 | ARX Node 2 callbacks |
| 9091 | ARX Node 1 metrics |
| 9092 | ARX Node 2 metrics |

---

## Troubleshooting

**Surfpool won't start (port in use)**
```bash
lsof -ti:8899 | xargs kill -9
make dev
```

**ARX nodes exit immediately**
```bash
docker compose logs arx-node-1    # Check error output
ls arx-keys/node-1/*.json          # Verify keypairs exist
```

**`arcium build` fails**
```bash
rustup override set 1.89.0         # Ensure correct Rust version
cargo clean && arcium build         # Clean rebuild
```

**Circuit upload fails**
```bash
bun x wrangler login                # Re-authenticate
bun x wrangler r2 bucket list       # Verify bucket access
```

**`arcium init-arcium-network` fails**
- Ensure Surfpool is running and healthy: `curl http://localhost:8899/health`
- The admin keypair needs SOL: `solana airdrop 100 "$(solana address --keypair admin.json)" --url http://localhost:8899`
- This only needs to run once per Surfpool database; re-running on the same db will error (safe to ignore)

**`arcium finalize-mxe-keys` hangs or fails**
- The Docker ARX nodes must be running: `docker compose ps`
- Check ARX node logs: `docker compose logs arx-node-1`
- The cluster must be activated first (see Section 3)
- If the keygen expired from the mempool, re-queue: `arcium requeue-mxe-keygen`

**Client can't connect to Surfpool**
- Ensure Surfpool is running: `curl http://localhost:8899/health`
- Check the client's RPC URL config points to `http://localhost:8899`
