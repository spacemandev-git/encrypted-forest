#!/usr/bin/env bash
# run-local.sh - Full local dev bootstrap for Encrypted Forest
#
# Does everything needed to go from a clean state to a fully running
# local environment with Surfpool, Arcium network, ARX nodes, and the
# deployed game program.
#
# Steps:
#   1. Check/install dependencies        (scripts/setup-deps.sh)
#   2. Generate admin keypair + ARX node keys (if missing)
#   3. Start Surfpool + Docker ARX nodes  (airdrop 100 SOL to admin)
#   4. Initialize Arcium network on Surfpool
#   5. Build program                      (arcium build)
#   6. Deploy program + circuits          (scripts/deploy-local.sh)
#   7. Copy IDL into SDK folders
#
# Usage:
#   ./scripts/run-local.sh [--skip-deps] [--skip-build] [--skip-deploy]

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="http://localhost:8899"
ADMIN_KP="${PROJECT_ROOT}/admin.json"
ARX_KEYS_DIR="${PROJECT_ROOT}/arx-keys"
CLUSTER_OFFSET=0
NUM_NODES=2

# Node IPs from Arcium.toml / docker-compose (Docker internal network)
NODE_IPS=("172.20.0.100" "172.20.0.101")

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
SKIP_DEPS=false
SKIP_BUILD=false
SKIP_DEPLOY=false

for arg in "$@"; do
  case "$arg" in
    --skip-deps)   SKIP_DEPS=true ;;
    --skip-build)  SKIP_BUILD=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    --help|-h)
      echo "Usage: run-local.sh [--skip-deps] [--skip-build] [--skip-deploy]"
      echo ""
      echo "  --skip-deps     Skip dependency checks (scripts/setup-deps.sh)"
      echo "  --skip-build    Skip arcium build step"
      echo "  --skip-deploy   Skip deploy + circuit upload"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "==> $*"; }
info() { echo "    $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

wait_for_rpc() {
  local max_retries=${1:-60}
  local retry=0
  echo -n "    Waiting for RPC at ${RPC_URL} ..."
  while [ $retry -lt $max_retries ]; do
    if curl -s "${RPC_URL}/health" > /dev/null 2>&1; then
      echo " ready."
      return 0
    fi
    echo -n "."
    sleep 1
    retry=$((retry + 1))
  done
  echo " timed out after ${max_retries}s."
  return 1
}

airdrop_sol() {
  local keypair_path="$1"
  local amount_sol="${2:-100}"
  local addr
  addr=$(solana address --keypair "$keypair_path")
  info "Airdropping ${amount_sol} SOL to ${addr} ..."
  # Surfpool airdrop (uses lamports internally, the CLI takes SOL)
  solana airdrop "$amount_sol" "$addr" --url "$RPC_URL" --commitment confirmed || true
}

# =========================================================================
# STEP 1: Check dependencies
# =========================================================================
if [ "$SKIP_DEPS" = false ]; then
  log "Step 1: Checking dependencies ..."
  if [ -x "${PROJECT_ROOT}/scripts/setup-deps.sh" ]; then
    "${PROJECT_ROOT}/scripts/setup-deps.sh" --check
  else
    fail "scripts/setup-deps.sh not found or not executable."
  fi
else
  log "Step 1: Skipping dependency checks (--skip-deps)"
fi

# =========================================================================
# STEP 2: Generate keypairs (admin + ARX nodes)
# =========================================================================
log "Step 2: Generating keypairs (if missing) ..."

# --- Admin keypair (gitignored) ---
if [ ! -f "$ADMIN_KP" ]; then
  info "Generating admin keypair at ${ADMIN_KP} ..."
  solana-keygen new --outfile "$ADMIN_KP" --no-bip39-passphrase --force
else
  info "Admin keypair already exists: ${ADMIN_KP}"
fi

# --- ARX node keypairs ---
generate_node_keys() {
  local node_num="$1"
  local node_dir="${ARX_KEYS_DIR}/node-${node_num}"
  mkdir -p "$node_dir"

  info "Generating keys for ARX node ${node_num} in ${node_dir}/ ..."

  # Node keypair (Solana keypair)
  if [ ! -f "${node_dir}/node-keypair.json" ]; then
    solana-keygen new --outfile "${node_dir}/node-keypair.json" --no-bip39-passphrase --force
    info "  Created node-keypair.json"
  else
    info "  node-keypair.json already exists"
  fi

  # Callback authority keypair (Solana keypair)
  if [ ! -f "${node_dir}/callback-kp.json" ]; then
    solana-keygen new --outfile "${node_dir}/callback-kp.json" --no-bip39-passphrase --force
    info "  Created callback-kp.json"
  else
    info "  callback-kp.json already exists"
  fi

  # Identity keypair (Ed25519 PEM via OpenSSL)
  if [ ! -f "${node_dir}/identity.pem" ]; then
    openssl genpkey -algorithm Ed25519 -out "${node_dir}/identity.pem"
    info "  Created identity.pem"
  else
    info "  identity.pem already exists"
  fi

  # BLS keypair (via Arcium CLI)
  if [ ! -f "${node_dir}/bls-keypair.json" ]; then
    arcium gen-bls-key "${node_dir}/bls-keypair.json"
    info "  Created bls-keypair.json"
  else
    info "  bls-keypair.json already exists"
  fi

  # X25519 keypair (via Arcium CLI)
  if [ ! -f "${node_dir}/x25519-keypair.json" ]; then
    arcium generate-x25519 --output "${node_dir}/x25519-keypair.json"
    info "  Created x25519-keypair.json"
  else
    info "  x25519-keypair.json already exists"
  fi
}

for i in $(seq 1 $NUM_NODES); do
  generate_node_keys "$i"
done

# =========================================================================
# STEP 3: Start Surfpool + Docker ARX nodes
# =========================================================================
log "Step 3: Starting Surfpool + Docker services ..."

# Stop any existing processes first
if [ -x "${PROJECT_ROOT}/scripts/dev-stop.sh" ]; then
  "${PROJECT_ROOT}/scripts/dev-stop.sh" 2>/dev/null || true
fi

# Start Surfpool with airdrop to admin keypair
mkdir -p "${PROJECT_ROOT}/.pids" "${PROJECT_ROOT}/logs"
SURFPOOL_LOG="${PROJECT_ROOT}/logs/surfpool.log"

# Calculate airdrop amount: 100 SOL = 100_000_000_000 lamports
AIRDROP_LAMPORTS=100000000000

surfpool start \
  --db "${PROJECT_ROOT}/dev.sqlite" \
  --block-production-mode transaction \
  --port 8899 \
  --no-tui \
  --airdrop-keypair-path "$ADMIN_KP" \
  --airdrop-amount "$AIRDROP_LAMPORTS" \
  > "$SURFPOOL_LOG" 2>&1 &

SURFPOOL_PID=$!
echo "${SURFPOOL_PID}" > "${PROJECT_ROOT}/.pids/surfpool.pid"
info "Surfpool started (PID ${SURFPOOL_PID}). Logs: ${SURFPOOL_LOG}"

wait_for_rpc 60 || fail "Surfpool did not become healthy. Check ${SURFPOOL_LOG}"

# Airdrop to ARX node keypairs (they need SOL for on-chain txs)
for i in $(seq 1 $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  airdrop_sol "${node_dir}/node-keypair.json" 100
  airdrop_sol "${node_dir}/callback-kp.json" 100
done

# =========================================================================
# STEP 4: Initialize Arcium network on Surfpool
# =========================================================================
log "Step 4: Initializing Arcium network on Surfpool ..."

# 4a. Deploy Arcium network program
info "Running init-arcium-network ..."
arcium init-arcium-network \
  --keypair-path "$ADMIN_KP" \
  --rpc-url "$RPC_URL" || {
    info "init-arcium-network may have already been run (OK if re-running)."
  }

# 4b. Initialize ARX node accounts on-chain
for i in $(seq 1 $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_offset=$((i - 1))
  ip="${NODE_IPS[$node_offset]}"

  info "Initializing on-chain accounts for ARX node ${i} (offset=${node_offset}, ip=${ip}) ..."
  arcium init-arx-accs \
    --keypair-path "${node_dir}/node-keypair.json" \
    --callback-keypair-path "${node_dir}/callback-kp.json" \
    --peer-keypair-path "${node_dir}/identity.pem" \
    --bls-keypair-path "${node_dir}/bls-keypair.json" \
    --x25519-keypair-path "${node_dir}/x25519-keypair.json" \
    --node-offset "$node_offset" \
    --ip-address "$ip" \
    --rpc-url "$RPC_URL" || {
      info "init-arx-accs for node ${i} may have already been run (OK if re-running)."
    }
done

# 4c. Create cluster
info "Creating cluster (offset=${CLUSTER_OFFSET}, max-nodes=${NUM_NODES}) ..."
arcium init-cluster \
  --keypair-path "$ADMIN_KP" \
  --offset "$CLUSTER_OFFSET" \
  --max-nodes "$NUM_NODES" \
  --rpc-url "$RPC_URL" || {
    info "Cluster may already exist (OK if re-running)."
  }

# 4d. Propose and accept each node into the cluster
for i in $(seq 1 $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_offset=$((i - 1))

  info "Proposing node ${i} (offset=${node_offset}) to join cluster ${CLUSTER_OFFSET} ..."
  arcium propose-join-cluster \
    --keypair-path "$ADMIN_KP" \
    --cluster-offset "$CLUSTER_OFFSET" \
    --node-offset "$node_offset" \
    --rpc-url "$RPC_URL" || {
      info "Propose for node ${i} may have already been done."
    }

  info "Node ${i} accepting cluster join ..."
  arcium join-cluster true \
    --keypair-path "${node_dir}/node-keypair.json" \
    --node-offset "$node_offset" \
    --cluster-offset "$CLUSTER_OFFSET" \
    --rpc-url "$RPC_URL" || {
      info "Join for node ${i} may have already been done."
    }
done

# 4e. Submit aggregated BLS key (each node submits)
for i in $(seq 1 $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_offset=$((i - 1))

  info "Node ${i} submitting aggregated BLS key ..."
  arcium submit-aggregated-bls-key \
    --keypair-path "${node_dir}/node-keypair.json" \
    --cluster-offset "$CLUSTER_OFFSET" \
    --node-offset "$node_offset" \
    --rpc-url "$RPC_URL" || {
      info "BLS key submission for node ${i} may have already been done."
    }
done

# 4f. Activate the cluster
info "Activating cluster ${CLUSTER_OFFSET} ..."
arcium activate-cluster \
  --keypair-path "$ADMIN_KP" \
  --cluster-offset "$CLUSTER_OFFSET" \
  --rpc-url "$RPC_URL" || {
    info "Cluster may already be active."
  }

# 4g. Start Docker ARX nodes (now that on-chain accounts exist)
info "Starting Docker services (ARX nodes + Postgres) ..."
if ! command -v docker &>/dev/null; then
  fail "docker not found. Install Docker to run ARX nodes."
fi
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" up -d
info "Docker services started."

# =========================================================================
# STEP 5: Build the program
# =========================================================================
if [ "$SKIP_BUILD" = false ]; then
  log "Step 5: Building program with arcium build ..."
  cd "$PROJECT_ROOT"
  arcium build
  info "Build complete."
else
  log "Step 5: Skipping build (--skip-build)"
fi

# =========================================================================
# STEP 6: Deploy program + circuits
# =========================================================================
if [ "$SKIP_DEPLOY" = false ]; then
  log "Step 6: Deploying program ..."

  # Load .env if it exists (for CIRCUIT_BUCKET, CIRCUIT_BASE_URL)
  if [ -f "${PROJECT_ROOT}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "${PROJECT_ROOT}/.env"
    set +a
  fi

  # Deploy the game program + initialize MXE
  info "Deploying program and initializing MXE ..."
  arcium deploy \
    --keypair-path "$ADMIN_KP" \
    --cluster-offset "$CLUSTER_OFFSET" \
    --recovery-set-size "$NUM_NODES" \
    --program-name encrypted_forest \
    --rpc-url "$RPC_URL"
  info "Program deployed and MXE initialized."

  # Finalize MXE keys (triggers DKG on the running ARX nodes)
  PROGRAM_ID=$(solana address --keypair "${PROJECT_ROOT}/target/deploy/encrypted_forest-keypair.json" 2>/dev/null || echo "")
  if [ -n "$PROGRAM_ID" ]; then
    info "Finalizing MXE keys for program ${PROGRAM_ID} ..."
    arcium finalize-mxe-keys "$PROGRAM_ID" \
      --keypair-path "$ADMIN_KP" \
      --cluster-offset "$CLUSTER_OFFSET" \
      --rpc-url "$RPC_URL" || {
        info "finalize-mxe-keys may need ARX nodes to complete DKG. Check Docker logs."
      }
  else
    info "WARNING: Could not determine program ID. Skipping finalize-mxe-keys."
    info "Run manually: arcium finalize-mxe-keys <PROGRAM_ID> --keypair-path admin.json --cluster-offset 0 --rpc-url $RPC_URL"
  fi

  # Upload circuits to R2 (if CIRCUIT_BUCKET is set)
  if [ -n "${CIRCUIT_BUCKET:-}" ]; then
    info "Uploading circuits to R2 bucket '${CIRCUIT_BUCKET}' ..."
    "${PROJECT_ROOT}/scripts/upload-circuits.sh"
  else
    info "CIRCUIT_BUCKET not set. Skipping circuit upload."
    info "Set CIRCUIT_BUCKET in .env to enable circuit uploads."
  fi

  # Init computation definitions (if script exists)
  INIT_SCRIPT="${PROJECT_ROOT}/scripts/init-comp-defs.ts"
  if [ -f "$INIT_SCRIPT" ]; then
    info "Initializing computation definitions ..."
    cd "${PROJECT_ROOT}"
    bun run "$INIT_SCRIPT"
    info "Computation definitions initialized."
  else
    info "No init-comp-defs.ts found. Comp defs must be initialized via tests or manually."
  fi
else
  log "Step 6: Skipping deploy (--skip-deploy)"
fi

# =========================================================================
# STEP 7: Copy IDL into SDK folders
# =========================================================================
log "Step 7: Copying IDL to SDK packages ..."

IDL_JSON="${PROJECT_ROOT}/target/idl/encrypted_forest.json"
IDL_TYPES="${PROJECT_ROOT}/target/types/encrypted_forest.ts"

if [ -f "$IDL_JSON" ]; then
  # Copy IDL JSON
  mkdir -p "${PROJECT_ROOT}/sdk/core/src/idl"
  mkdir -p "${PROJECT_ROOT}/sdk/client/src/idl"
  cp "$IDL_JSON" "${PROJECT_ROOT}/sdk/core/src/idl/encrypted_forest.json"
  cp "$IDL_JSON" "${PROJECT_ROOT}/sdk/client/src/idl/encrypted_forest.json"
  info "Copied encrypted_forest.json -> sdk/core/src/idl/ and sdk/client/src/idl/"
else
  info "WARNING: IDL JSON not found at ${IDL_JSON}. Run arcium build first."
fi

if [ -f "$IDL_TYPES" ]; then
  # Copy TypeScript types
  cp "$IDL_TYPES" "${PROJECT_ROOT}/sdk/core/src/idl/encrypted_forest.ts"
  cp "$IDL_TYPES" "${PROJECT_ROOT}/sdk/client/src/idl/encrypted_forest.ts"
  info "Copied encrypted_forest.ts -> sdk/core/src/idl/ and sdk/client/src/idl/"
else
  info "WARNING: IDL types not found at ${IDL_TYPES}. Run arcium build first."
fi

# =========================================================================
# Summary
# =========================================================================
echo ""
echo "=============================================="
echo "  Encrypted Forest - Local Environment Ready  "
echo "=============================================="
echo ""
echo "  Surfpool RPC  : ${RPC_URL}"
echo "  Surfpool WS   : ws://localhost:8900"
echo "  Admin keypair : ${ADMIN_KP}"
echo "  Cluster       : offset=${CLUSTER_OFFSET}, nodes=${NUM_NODES}"
echo "  Docker        : docker compose ps"
echo ""
echo "  Program ID    : $(solana address --keypair "${PROJECT_ROOT}/target/deploy/encrypted_forest-keypair.json" 2>/dev/null || echo 'unknown')"
echo ""
echo "  Next steps:"
echo "    cd client && bun run dev    # Start the game client"
echo "    make test-local             # Run tests against this env"
echo ""
echo "  Stop everything:"
echo "    ./scripts/dev-stop.sh"
echo ""
