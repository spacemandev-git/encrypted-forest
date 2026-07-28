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
#   3. Build program                      (arcium build)
#   4. Start Surfpool + deploy program    (via Surfpool runbook)
#   5. Initialize Arcium network on Surfpool
#   6. Start Docker ARX nodes
#   7. Deploy program & initialize MXE   (arcium deploy)
#   8. Initialize computation definitions (init-comp-defs.ts)
#   9. Copy IDL into SDK folders
#
# Usage:
#   ./scripts/run-local.sh [--skip-deps] [--skip-build] [--skip-deploy]

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="http://localhost:8899"
ADMIN_KP="${PROJECT_ROOT}/admin.json"
ARX_KEYS_DIR="${PROJECT_ROOT}/arx-keys"
CLUSTER_OFFSET=0
NUM_NODES=3
PROGRAM_KP="${PROJECT_ROOT}/keypairs/encrypted_forest-keypair.json"

# Node offsets start at 1 (offset 0 is reserved by the Arcium network program)
NODE_OFFSET_START=1

# Node IPs from docker-compose (Docker internal bridge network).
# Each node also binds its QUIC listener to this specific IP (not 0.0.0.0)
# to ensure QUIC source-IP is correct on the bridge interface.
NODE_IPS=("172.20.0.100" "172.20.0.101" "172.20.0.102")

# MXE recovery set. Since v0.11 this is NOT drawn from ARX nodes or clusters: it
# is a set of separately registered RecoveryPeerAccounts, each backed by its own
# staking account (a stake account cannot back both an ARX node and a recovery
# peer). `init-mxe` rejects anything smaller than 7 for a 3-node cluster.
RECOVERY_SET_SIZE=7
NUM_RECOVERY_PEERS=7
RECOVERY_PEER_OFFSET_START=1
RECOVERY_KEYS_DIR="${ARX_KEYS_DIR}/recovery-peers"

# Extra (non-cluster) ARX nodes. Kept at 0: an ARX process refuses to boot unless
# it belongs to a cluster, a cluster needs >= 2 nodes, and extra nodes no longer
# contribute to the MXE recovery set.
RECOVERY_CLUSTER_OFFSET=1
NUM_EXTRA_NODES=0
EXTRA_NODE_OFFSET_START=4
EXTRA_NODE_IPS=("172.20.0.103")

# Trusted Dealer config (keys used by Docker container)
TD_DIR="${ARX_KEYS_DIR}/trusted-dealer"

# Staking (v0.11+): a node only activates with a primary self-delegation of at
# least MIN_SELF_DELEGATION (1000 ARX). Amounts are in whole ARX.
#
# The released CLI is not compiled with the `staking` feature, so `arcium
# init-arcium-mint` / `arcium airdrop` both bail out with "unexpected command
# routed to staking handler". We don't need them: Surfpool forks mainnet, so the
# real ARX mint and staking program are already present, and we mint balances
# directly with Surfpool's surfnet_setTokenAccount cheatcode.
NODE_STAKE_ARX=1000
ARCIUM_PROGRAM_ID="Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
ARX_MINT="ARXwZkNAtzPfdcoqQiduJn8EPv9fKiDfGn2KyggyDrFs"
ARX_DECIMALS=9
ARX_FUND_AMOUNT=100000   # whole ARX given to each node authority

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
SKIP_DEPS=false
SKIP_BUILD=false
SKIP_DEPLOY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-deps)   SKIP_DEPS=true ;;
    --skip-build)  SKIP_BUILD=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    --help|-h)
      echo "Usage: run-local.sh [--skip-deps] [--skip-build] [--skip-deploy]"
      echo ""
      echo "  --skip-deps          Skip dependency checks (scripts/setup-deps.sh)"
      echo "  --skip-build         Skip arcium build step"
      echo "  --skip-deploy        Skip deploy + circuit upload"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1"
      exit 1
      ;;
  esac
  shift
done

RPC_HOST="host.docker.internal"

# ---------------------------------------------------------------------------
# Logging & Status System
# ---------------------------------------------------------------------------
SCRIPT_START=$(date +%s)
CURRENT_STEP=""
STEP_START_TIME=""
HEARTBEAT_PID=""
TASK_FILE="${PROJECT_ROOT}/.pids/current-task"
VERBOSE_LOG="${PROJECT_ROOT}/logs/run-local-verbose.log"

mkdir -p "${PROJECT_ROOT}/.pids" "${PROJECT_ROOT}/logs"
: > "$VERBOSE_LOG"

# Detect tty for color support
if [ -t 2 ]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  RED="\033[31m"
  CYAN="\033[36m"
  RESET="\033[0m"
else
  BOLD="" DIM="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

elapsed() {
  local now
  now=$(date +%s)
  local diff=$(( now - SCRIPT_START ))
  local mins=$(( diff / 60 ))
  local secs=$(( diff % 60 ))
  printf "%dm %02ds" "$mins" "$secs"
}

elapsed_since() {
  local start="$1"
  local now
  now=$(date +%s)
  local diff=$(( now - start ))
  local mins=$(( diff / 60 ))
  local secs=$(( diff % 60 ))
  if [ "$mins" -gt 0 ]; then
    printf "%dm %02ds" "$mins" "$secs"
  else
    printf "%ds" "$secs"
  fi
}

step_start() {
  local step_num="$1"
  local description="$2"
  CURRENT_STEP="$description"
  STEP_START_TIME=$(date +%s)
  echo "$description" > "$TASK_FILE"
  echo -e "${BOLD}${CYAN}[$(elapsed)]${RESET} ${BOLD}Step ${step_num}: ${description}${RESET}" >&2
}

step_done() {
  local duration
  duration=$(elapsed_since "$STEP_START_TIME")
  echo -e "${BOLD}${GREEN}  ✓${RESET} ${DIM}Done (${duration})${RESET}" >&2
  echo "" >&2
}

task() {
  local description="$1"
  echo "$description" > "$TASK_FILE"
  echo -e "  ${DIM}→ ${description}${RESET}" >&2
}

ok() {
  echo -e "  ${GREEN}✓ $*${RESET}" >&2
}

warn() {
  echo -e "  ${YELLOW}⚠ $*${RESET}" >&2
}

fail() {
  echo -e "${RED}${BOLD}✗ ERROR:${RESET}${RED} $*${RESET}" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Background heartbeat — prints status every 10s
# ---------------------------------------------------------------------------
start_heartbeat() {
  (
    while true; do
      sleep 10
      local current_task=""
      if [ -f "$TASK_FILE" ]; then
        current_task=$(cat "$TASK_FILE" 2>/dev/null || echo "")
      fi
      if [ -n "$current_task" ]; then
        echo -e "${DIM}[$(elapsed)] Still working on: ${current_task} ...${RESET}" >&2
      fi
    done
  ) &
  HEARTBEAT_PID=$!
}

stop_heartbeat() {
  if [ -n "$HEARTBEAT_PID" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    wait "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
  rm -f "$TASK_FILE"
}

trap stop_heartbeat EXIT

start_heartbeat

# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

# Generate Ed25519 identity PEM in PKCS#8 v1 format (with embedded public key).
# The arcium async-mpc QUIC library requires the public key to be present in the
# PEM structure. OpenSSL's `genpkey` only produces v0 (no pubkey), which causes
# the QUIC handshake to hang silently.
generate_identity_pem() {
  local output_path="$1"
  python3 -c "
import base64, os
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat, NoEncryption

key = Ed25519PrivateKey.generate()
priv = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

# Build PKCS#8 v1 DER (OneAsymmetricKey with public key)
version = bytes([0x02, 0x01, 0x01])
oid_seq = bytes([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70])
priv_octet = bytes([0x04, 0x22, 0x04, 0x20]) + priv
pub_tagged = bytes([0x81, 0x21, 0x00]) + pub
inner = version + oid_seq + priv_octet + pub_tagged
der = bytes([0x30, len(inner)]) + inner

b64 = base64.b64encode(der).decode()
wrapped = '\n'.join(b64[i:i+64] for i in range(0, len(b64), 64))
pem = f'-----BEGIN PRIVATE KEY-----\n{wrapped}\n-----END PRIVATE KEY-----\n'
with open('$output_path', 'w') as f:
    f.write(pem)
"
}

# Convert an existing PKCS#8 v0 Ed25519 PEM to v1 (add public key).
# Preserves the same key material so on-chain peer IDs remain valid.
upgrade_identity_pem() {
  local pem_path="$1"
  python3 -c "
import base64
from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PrivateFormat, PublicFormat, NoEncryption

with open('$pem_path', 'rb') as f:
    pem_data = f.read()

# Check if already v1 (81 bytes DER = has public key)
b64 = b''.join(l.strip() for l in pem_data.split(b'\n') if not l.startswith(b'-----'))
der = base64.b64decode(b64)
if len(der) > 60:
    exit(0)  # Already v1, skip

key = load_pem_private_key(pem_data, password=None)
priv = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

version = bytes([0x02, 0x01, 0x01])
oid_seq = bytes([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70])
priv_octet = bytes([0x04, 0x22, 0x04, 0x20]) + priv
pub_tagged = bytes([0x81, 0x21, 0x00]) + pub
inner = version + oid_seq + priv_octet + pub_tagged
new_der = bytes([0x30, len(inner)]) + inner

b64_out = base64.b64encode(new_der).decode()
wrapped = '\n'.join(b64_out[i:i+64] for i in range(0, len(b64_out), 64))
pem_out = f'-----BEGIN PRIVATE KEY-----\n{wrapped}\n-----END PRIVATE KEY-----\n'
with open('$pem_path', 'w') as f:
    f.write(pem_out)
"
}

wait_for_rpc() {
  local max_retries=${1:-60}
  local retry=0
  task "Waiting for RPC at ${RPC_URL}"
  # Poll a real JSON-RPC call: Surfpool binds the port well before it can serve
  # requests, and `GET /health` answers "HTTP method not allowed" the whole time,
  # which curl reports as success.
  while [ $retry -lt $max_retries ]; do
    if curl -s "$RPC_URL" -X POST -H 'Content-Type: application/json' \
         -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null \
         | grep -q '"result"'; then
      ok "RPC is ready"
      return 0
    fi
    sleep 1
    retry=$((retry + 1))
  done
  warn "RPC timed out after ${max_retries}s"
  return 1
}

airdrop_sol() {
  local keypair_path="$1"
  local amount_sol="${2:-100}"
  local addr
  addr=$(solana address --keypair "$keypair_path")
  solana airdrop "$amount_sol" "$addr" --url "$RPC_URL" --commitment confirmed >> "$VERBOSE_LOG" 2>&1 || true
}

# Iterate 1..N, emitting nothing for N < 1. BSD `seq` counts DOWN when the end is
# below the start (`seq 1 0` prints "1 0"), which silently runs zero-count loops.
seq_n() {
  if [ "${1:-0}" -ge 1 ]; then
    seq 1 "$1"
  fi
}

# Register one ARX node on-chain. `init-arx-accs` is not idempotent: on a re-run
# against a persisted Surfpool DB the primary stake account already exists and
# the whole command aborts, so retry once skipping the staking steps.
init_node_accounts() {
  local node_dir="$1"
  local node_offset="$2"
  local ip="$3"
  local common=(
    --keypair-path "${node_dir}/node-keypair.json"
    --callback-keypair-path "${node_dir}/callback-kp.json"
    --peer-keypair-path "${node_dir}/identity.pem"
    --bls-keypair-path "${node_dir}/bls-keypair.json"
    --x25519-keypair-path "${node_dir}/x25519-keypair.json"
    --amount "$NODE_STAKE_ARX"
    --node-offset "$node_offset"
    --ip-address "$ip"
    --rpc-url "$RPC_URL"
  )
  if arcium init-arx-accs "${common[@]}" >> "$VERBOSE_LOG" 2>&1; then
    return 0
  fi
  arcium init-arx-accs "${common[@]}" \
    --skip-steps init-stake,activate-stake >> "$VERBOSE_LOG" 2>&1
}

run_parallel() {
  local label="$1"
  shift
  local pids=("$@")
  echo "$label" > "$TASK_FILE"
  local failed=0
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || failed=$((failed + 1))
  done
  if [ $failed -gt 0 ]; then
    warn "${failed} sub-tasks had non-zero exit (may be OK if re-running)"
  fi
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo -e "${BOLD}${CYAN}" >&2
echo -e "  ╔═══════════════════════════════════════════╗" >&2
echo -e "  ║     Encrypted Forest — Local Bootstrap    ║" >&2
echo -e "  ╚═══════════════════════════════════════════╝${RESET}" >&2
echo -e "${DIM}  Verbose log: ${VERBOSE_LOG}${RESET}" >&2
echo "" >&2

# =========================================================================
# STEP 1: Check dependencies
# =========================================================================
if [ "$SKIP_DEPS" = false ]; then
  step_start 1 "Checking dependencies"
  if [ -x "${PROJECT_ROOT}/scripts/setup-deps.sh" ]; then
    "${PROJECT_ROOT}/scripts/setup-deps.sh" --check >> "$VERBOSE_LOG" 2>&1
    ok "All dependencies found"
  else
    fail "scripts/setup-deps.sh not found or not executable."
  fi

  task "Installing Bun dependencies"
  cd "$PROJECT_ROOT"
  bun install >> "$VERBOSE_LOG" 2>&1
  ok "Bun dependencies installed"
  step_done
else
  echo -e "${DIM}[$(elapsed)] Step 1: Skipped (--skip-deps)${RESET}" >&2
  echo "" >&2
fi

# =========================================================================
# STEP 2: Generate keypairs (admin + ARX nodes)
# =========================================================================
step_start 2 "Generating keypairs"

# --- Admin keypair (gitignored) ---
if [ ! -f "$ADMIN_KP" ]; then
  task "Generating admin keypair"
  solana-keygen new --outfile "$ADMIN_KP" --no-bip39-passphrase --force >> "$VERBOSE_LOG" 2>&1
  ok "Admin keypair created: ${ADMIN_KP}"
else
  ok "Admin keypair exists: ${ADMIN_KP}"
fi

# --- ARX node keypairs ---
generate_node_keys() {
  local node_num="$1"
  local node_offset="$2"
  local bind_ip="${3:-0.0.0.0}"
  local node_dir="${ARX_KEYS_DIR}/node-${node_num}"
  mkdir -p "$node_dir" "${node_dir}/private-shares" "${node_dir}/public-inputs"

  if [ ! -f "${node_dir}/node-keypair.json" ]; then
    solana-keygen new --outfile "${node_dir}/node-keypair.json" --no-bip39-passphrase --force >> "$VERBOSE_LOG" 2>&1
  fi
  if [ ! -f "${node_dir}/callback-kp.json" ]; then
    solana-keygen new --outfile "${node_dir}/callback-kp.json" --no-bip39-passphrase --force >> "$VERBOSE_LOG" 2>&1
  fi
  if [ ! -f "${node_dir}/identity.pem" ]; then
    generate_identity_pem "${node_dir}/identity.pem"
  else
    # Upgrade existing v0 PEM to v1 (adds public key if missing)
    upgrade_identity_pem "${node_dir}/identity.pem"
  fi
  if [ ! -f "${node_dir}/bls-keypair.json" ]; then
    arcium gen-bls-key "${node_dir}/bls-keypair.json" >> "$VERBOSE_LOG" 2>&1
  fi
  if [ ! -f "${node_dir}/x25519-keypair.json" ]; then
    arcium generate-x25519 --output "${node_dir}/x25519-keypair.json" >> "$VERBOSE_LOG" 2>&1
  fi

  # Remove directory placeholder if Docker created one, then generate config
  if [ -d "${node_dir}/node-config.toml" ]; then
    rm -rf "${node_dir}/node-config.toml"
  fi
  # v0.13 node-config format. The [network] section and the `cluster`,
  # `commitment`, `hardware_claim`, `starting_epoch`, `ending_epoch` fields were
  # removed after v0.7 — the node refuses to parse a config that still has them.
  # All six fields below are required; a missing one is a hard parse error.
  # ${bind_ip} is unused now (the node binds 0.0.0.0); the node's routable IP is
  # the one registered on-chain via `init-arx-accs --ip-address`.
  cat > "${node_dir}/node-config.toml" << NCEOF
[node]
offset = ${node_offset}
computations_limit = 10

[solana]
endpoint_rpc = "http://${RPC_HOST}:8899"
endpoint_wss = "ws://${RPC_HOST}:8900"
secondary_endpoint_rpc = "http://${RPC_HOST}:8899"
secondary_endpoint_wss = "ws://${RPC_HOST}:8900"
NCEOF
}

task "Generating keys for ${NUM_NODES} cluster nodes + ${NUM_EXTRA_NODES} extra node(s)"
for i in $(seq_n $NUM_NODES); do
  node_offset=$((NODE_OFFSET_START + i - 1))
  ip_idx=$((i - 1))
  generate_node_keys "$i" "$node_offset" "${NODE_IPS[$ip_idx]}"
done
for i in $(seq_n $NUM_EXTRA_NODES); do
  extra_num=$((NUM_NODES + i))
  node_offset=$((EXTRA_NODE_OFFSET_START + i - 1))
  ip_idx=$((i - 1))
  generate_node_keys "$extra_num" "$node_offset" "${EXTRA_NODE_IPS[$ip_idx]}"
done
ok "$((NUM_NODES + NUM_EXTRA_NODES)) node key sets ready"

# --- Trusted Dealer keypair + seed ---
task "Generating trusted dealer keys"
mkdir -p "$TD_DIR"

if [ ! -f "${TD_DIR}/td_identity.pem" ]; then
  generate_identity_pem "${TD_DIR}/td_identity.pem"
else
  # Upgrade existing v0 PEM to v1 (adds public key if missing)
  upgrade_identity_pem "${TD_DIR}/td_identity.pem"
fi
if [ ! -f "${TD_DIR}/td_master_seed.json" ]; then
  # Generate 32 random bytes as a JSON array (matching arcium localnet format)
  python3 -c "import os, json; print(json.dumps(list(os.urandom(32))))" > "${TD_DIR}/td_master_seed.json"
fi
ok "Trusted dealer keys ready"

# --- Generate trusted dealer config ---
task "Generating trusted dealer config"
cat > "${TD_DIR}/trusted_dealer_config.toml" << TDEOF
[dealer]
cluster_offsets = [${CLUSTER_OFFSET}]
local_ip = "172.20.0.99"
master_seed_path = "/usr/trusted-dealer/master_seed.json"
n_peers = ${NUM_NODES}
private_key_path = "/usr/trusted-dealer/identity.json"
rate_limit_initial_tokens = 10000000
rate_limit_max_tokens = 10000000
rate_limit_tokens_per_second = 100000
solana_rpc_url = "http://${RPC_HOST}:8899"
TDEOF
ok "Trusted dealer config generated"

step_done

# =========================================================================
# STEP 3: Build program (runs in parallel with Steps 4-6)
# =========================================================================
BUILD_LOG="${PROJECT_ROOT}/logs/arcium-build.log"
BUILD_PID=""

if [ "$SKIP_BUILD" = false ]; then
  step_start 3 "Building program (background)"
  task "Copying static program keypair to target/deploy/"
  mkdir -p "${PROJECT_ROOT}/target/deploy"
  cp "$PROGRAM_KP" "${PROJECT_ROOT}/target/deploy/encrypted_forest-keypair.json"
  ok "Static keypair in place"
  task "Running arcium build in background"
  cd "$PROJECT_ROOT"
  (
    arcium build >> "$BUILD_LOG" 2>&1
  ) &
  BUILD_PID=$!
  ok "Build started in background (PID ${BUILD_PID})"
  step_done
else
  echo -e "${DIM}[$(elapsed)] Step 3: Skipped (--skip-build)${RESET}" >&2
  echo "" >&2
fi

# =========================================================================
# STEP 4: Start Surfpool (parallel with build)
# =========================================================================
step_start 4 "Starting Surfpool"

# Stop any existing processes first
task "Stopping existing processes"
if [ -x "${PROJECT_ROOT}/scripts/dev-stop.sh" ]; then
  "${PROJECT_ROOT}/scripts/dev-stop.sh" >> "$VERBOSE_LOG" 2>&1 || true
fi
lsof -ti:8899 | xargs kill -9 2>/dev/null || true
sleep 1

SURFPOOL_LOG="${PROJECT_ROOT}/logs/surfpool.log"
AIRDROP_LAMPORTS=100000000000

task "Starting Surfpool validator"
surfpool start \
  --db "${PROJECT_ROOT}/dev.sqlite" \
  --block-production-mode clock \
  --port 8899 \
  --no-tui \
  --no-deploy \
  --airdrop-keypair-path "$ADMIN_KP" \
  --airdrop-amount "$AIRDROP_LAMPORTS" \
  > "$SURFPOOL_LOG" 2>&1 &

SURFPOOL_PID=$!
echo "${SURFPOOL_PID}" > "${PROJECT_ROOT}/.pids/surfpool.pid"
ok "Surfpool started (PID ${SURFPOOL_PID})"

wait_for_rpc 60 || fail "Surfpool did not become healthy. Check ${SURFPOOL_LOG}"

# Fund all ARX node keypairs in parallel (cluster + extra)
TOTAL_NODES=$((NUM_NODES + NUM_EXTRA_NODES))
task "Airdropping SOL to ${TOTAL_NODES} nodes"
AIRDROP_PIDS=()
for i in $(seq_n $TOTAL_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  airdrop_sol "${node_dir}/node-keypair.json" 100 &
  AIRDROP_PIDS+=($!)
  airdrop_sol "${node_dir}/callback-kp.json" 100 &
  AIRDROP_PIDS+=($!)
done
run_parallel "Airdropping SOL to nodes" "${AIRDROP_PIDS[@]}"
ok "All airdrops complete"

step_done

# =========================================================================
# STEP 5: Initialize Arcium network on Surfpool
# =========================================================================
step_start 5 "Initializing Arcium network"

# 5a. Deploy Arcium network programs
#
# Surfpool is a mainnet fork, so it lazily clones real mainnet accounts on
# demand — including the Arcium network's own state accounts. `init-arcium-network`
# then dies with "Allocate: account <addr> already in use" on the first one it
# tries to create, leaving the rest of the network state (e.g.
# permissioned_recovery_peers_acc) uncreated. Wipe each cloned account with
# Surfpool's surfnet_setAccount cheatcode and retry until init goes through.
task "Deploying Arcium network programs"
NETWORK_INIT_OK=false
for attempt in $(seq 1 15); do
  net_out=$(arcium init-arcium-network --keypair-path "$ADMIN_KP" --rpc-url "$RPC_URL" 2>&1) || true
  echo "$net_out" >> "$VERBOSE_LOG"
  if echo "$net_out" | grep -q "Arcium network initialized"; then
    NETWORK_INIT_OK=true
    break
  fi
  conflict_addr=$(echo "$net_out" \
    | grep -oE "Allocate: account Address \{ address: [1-9A-HJ-NP-Za-km-z]+" \
    | grep -oE "[1-9A-HJ-NP-Za-km-z]{32,44}$" | head -1) || true
  if [ -z "$conflict_addr" ]; then
    warn "init-arcium-network failed for a reason other than a cloned account — see ${VERBOSE_LOG}"
    break
  fi
  echo "  clearing mainnet-cloned account ${conflict_addr}" >> "$VERBOSE_LOG"
  curl -s "$RPC_URL" -X POST -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setAccount\",\"params\":[\"${conflict_addr}\",{\"lamports\":0,\"owner\":\"11111111111111111111111111111111\",\"data\":\"\",\"executable\":false,\"rentEpoch\":0}]}" \
    >> "$VERBOSE_LOG" 2>&1
done
if [ "$NETWORK_INIT_OK" = true ]; then
  ok "Arcium network initialized"
else
  fail "Could not initialize the Arcium network. See ${VERBOSE_LOG}"
fi

# 5a-bis. Fund every node authority with ARX.
# Staking is mandatory since v0.11: `init-arx-accs` opens + activates a primary
# stake account, which needs ARX tokens in the node authority's wallet.
task "Funding ${TOTAL_NODES} nodes with ${ARX_FUND_AMOUNT} ARX each"
ARX_BASE_UNITS=$(python3 -c "print(${ARX_FUND_AMOUNT} * 10**${ARX_DECIMALS})")
for i in $(seq_n $TOTAL_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_addr=$(solana address --keypair "${node_dir}/node-keypair.json")
  resp=$(curl -s "$RPC_URL" -X POST -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setTokenAccount\",\"params\":[\"${node_addr}\",\"${ARX_MINT}\",{\"amount\":${ARX_BASE_UNITS}}]}")
  echo "surfnet_setTokenAccount ${node_addr}: ${resp}" >> "$VERBOSE_LOG"
  case "$resp" in
    *'"error"'*) fail "Could not fund node ${i} with ARX: ${resp}" ;;
  esac
done
ok "ARX balances set"

# 5b. Initialize all ARX node accounts on-chain (cluster + extra, parallel)
task "Initializing on-chain accounts for ${TOTAL_NODES} nodes"
NODE_PIDS=()
for i in $(seq_n $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_offset=$((NODE_OFFSET_START + i - 1))
  ip_idx=$((i - 1))
  ip="${NODE_IPS[$ip_idx]}"

  init_node_accounts "$node_dir" "$node_offset" "$ip" &
  NODE_PIDS+=($!)
done
for i in $(seq_n $NUM_EXTRA_NODES); do
  extra_num=$((NUM_NODES + i))
  node_dir="${ARX_KEYS_DIR}/node-${extra_num}"
  node_offset=$((EXTRA_NODE_OFFSET_START + i - 1))
  ip_idx=$((i - 1))
  ip="${EXTRA_NODE_IPS[$ip_idx]}"

  init_node_accounts "$node_dir" "$node_offset" "$ip" &
  NODE_PIDS+=($!)
done
run_parallel "Initializing ARX node accounts" "${NODE_PIDS[@]}"

# Hard-fail here rather than limping on: without these accounts every later step
# (cluster join, BLS, activation) fails in ways that only surface as the ARX
# nodes never going active.
ALL_NODE_OFFSETS=()
for i in $(seq_n $NUM_NODES); do ALL_NODE_OFFSETS+=($((NODE_OFFSET_START + i - 1))); done
for i in $(seq_n $NUM_EXTRA_NODES); do ALL_NODE_OFFSETS+=($((EXTRA_NODE_OFFSET_START + i - 1))); done
for offset in "${ALL_NODE_OFFSETS[@]}"; do
  if ! arcium arx-info "$offset" --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1; then
    fail "ARX node account for offset ${offset} was not created. See ${VERBOSE_LOG}"
  fi
done
ok "All node accounts initialized"

# Get trusted dealer peer ID for cluster registration
# NOTE: arcium CLI expects IP and peer ID in byte-array format: [a,b,c,d]
TD_PEER_ID=$(arcium get-peer-id "${TD_DIR}/td_identity.pem" 2>/dev/null)
task "Trusted dealer peer ID: ${TD_PEER_ID}"

# 5c. Create main cluster
task "Creating main cluster (offset=${CLUSTER_OFFSET})"
arcium init-cluster \
  --keypair-path "$ADMIN_KP" \
  --offset "$CLUSTER_OFFSET" \
  --max-nodes "$NUM_NODES" \
  --td-ip "[172,20,0,99]" \
  --td-p-id "$TD_PEER_ID" \
  --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1 || {
    warn "Cluster may already exist (OK if re-running)"
  }
ok "Main cluster created"

# 5d. Propose all nodes, then accept all (parallel within each batch)
task "Proposing ${NUM_NODES} nodes to main cluster"
PROPOSE_PIDS=()
for i in $(seq_n $NUM_NODES); do
  node_offset=$((NODE_OFFSET_START + i - 1))
  (
    arcium propose-join-cluster \
      --keypair-path "$ADMIN_KP" \
      --cluster-offset "$CLUSTER_OFFSET" \
      --node-offset "$node_offset" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  PROPOSE_PIDS+=($!)
done
run_parallel "Proposing nodes to cluster" "${PROPOSE_PIDS[@]}"

task "Nodes accepting main cluster join"
JOIN_PIDS=()
for i in $(seq_n $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_offset=$((NODE_OFFSET_START + i - 1))
  (
    arcium join-cluster true \
      --keypair-path "${node_dir}/node-keypair.json" \
      --node-offset "$node_offset" \
      --cluster-offset "$CLUSTER_OFFSET" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  JOIN_PIDS+=($!)
done
run_parallel "Nodes joining cluster" "${JOIN_PIDS[@]}"
ok "All nodes joined main cluster"

# 5e. Submit aggregated BLS key (each node submits, parallel)
task "Submitting aggregated BLS keys for main cluster"
BLS_PIDS=()
for i in $(seq_n $NUM_NODES); do
  node_dir="${ARX_KEYS_DIR}/node-${i}"
  node_offset=$((NODE_OFFSET_START + i - 1))

  (
    arcium submit-aggregated-bls-key \
      --keypair-path "${node_dir}/node-keypair.json" \
      --cluster-offset "$CLUSTER_OFFSET" \
      --node-offset "$node_offset" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  BLS_PIDS+=($!)
done
run_parallel "Submitting BLS keys" "${BLS_PIDS[@]}"
ok "BLS keys submitted"

# 5f. Activate the main cluster
task "Activating main cluster"
arcium activate-cluster \
  --keypair-path "$ADMIN_KP" \
  --cluster-offset "$CLUSTER_OFFSET" \
  --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1 || {
    warn "Cluster may already be active"
  }
ok "Main cluster active"

# 5g. Create recovery cluster for extra node(s) — ARX nodes must belong to a cluster to boot.
#
# A cluster needs at least 2 nodes (InitCluster rejects max-nodes=1 with
# InvalidMaxSize), so this block is skipped for a single extra node. Note that
# since v0.11 the MXE recovery set is NOT drawn from cluster members: it is built
# from separately registered RecoveryPeerAccounts (`arcium init-recovery-peer`),
# so an extra node in a recovery cluster no longer contributes to it.
if [ "$NUM_EXTRA_NODES" -lt 2 ]; then
  warn "Skipping recovery cluster: needs >= 2 nodes, have ${NUM_EXTRA_NODES}"
  warn "Extra node(s) stay registered + active on-chain, but their ARX process will not boot ('Node is not part of any cluster')"
else
task "Creating recovery cluster (offset=${RECOVERY_CLUSTER_OFFSET})"
arcium init-cluster \
  --keypair-path "$ADMIN_KP" \
  --offset "$RECOVERY_CLUSTER_OFFSET" \
  --max-nodes "$NUM_EXTRA_NODES" \
  --td-ip "[172,20,0,99]" \
  --td-p-id "$TD_PEER_ID" \
  --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1 || {
    warn "Recovery cluster may already exist (OK if re-running)"
  }
ok "Recovery cluster created"

# 5h. Propose extra nodes to recovery cluster, accept, submit BLS, activate
task "Proposing ${NUM_EXTRA_NODES} extra node(s) to recovery cluster"
EXTRA_PROPOSE_PIDS=()
for i in $(seq_n $NUM_EXTRA_NODES); do
  node_offset=$((EXTRA_NODE_OFFSET_START + i - 1))
  (
    arcium propose-join-cluster \
      --keypair-path "$ADMIN_KP" \
      --cluster-offset "$RECOVERY_CLUSTER_OFFSET" \
      --node-offset "$node_offset" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  EXTRA_PROPOSE_PIDS+=($!)
done
run_parallel "Proposing extra nodes to recovery cluster" "${EXTRA_PROPOSE_PIDS[@]}"

task "Extra nodes accepting recovery cluster join"
EXTRA_JOIN_PIDS=()
for i in $(seq_n $NUM_EXTRA_NODES); do
  extra_num=$((NUM_NODES + i))
  node_dir="${ARX_KEYS_DIR}/node-${extra_num}"
  node_offset=$((EXTRA_NODE_OFFSET_START + i - 1))
  (
    arcium join-cluster true \
      --keypair-path "${node_dir}/node-keypair.json" \
      --node-offset "$node_offset" \
      --cluster-offset "$RECOVERY_CLUSTER_OFFSET" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  EXTRA_JOIN_PIDS+=($!)
done
run_parallel "Extra nodes joining recovery cluster" "${EXTRA_JOIN_PIDS[@]}"
ok "Extra nodes joined recovery cluster"

task "Submitting BLS keys for recovery cluster"
EXTRA_BLS_PIDS=()
for i in $(seq_n $NUM_EXTRA_NODES); do
  extra_num=$((NUM_NODES + i))
  node_dir="${ARX_KEYS_DIR}/node-${extra_num}"
  node_offset=$((EXTRA_NODE_OFFSET_START + i - 1))
  (
    arcium submit-aggregated-bls-key \
      --keypair-path "${node_dir}/node-keypair.json" \
      --cluster-offset "$RECOVERY_CLUSTER_OFFSET" \
      --node-offset "$node_offset" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  EXTRA_BLS_PIDS+=($!)
done
run_parallel "Submitting BLS keys for recovery cluster" "${EXTRA_BLS_PIDS[@]}"
ok "Recovery cluster BLS keys submitted"

task "Activating recovery cluster"
arcium activate-cluster \
  --keypair-path "$ADMIN_KP" \
  --cluster-offset "$RECOVERY_CLUSTER_OFFSET" \
  --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1 || {
    warn "Recovery cluster may already be active"
  }
ok "Recovery cluster active"
fi

# 5i. Register the MXE recovery peers.
#
# `init-mxe --recovery-set-size N` needs N RecoveryPeerAccounts, each backed by
# its own primary stake account. Registering one requires the peer to be on the
# network's permissioned-recovery-peers allowlist, and the two instructions that
# manage that allowlist are gated on the Arcium program's upgrade authority — so
# hand that authority to admin.json first (Surfpool cheatcode), then allowlist
# the peers from TypeScript (the CLI exposes no command for it).
task "Handing Arcium program upgrade authority to admin"
ADMIN_PUBKEY_FOR_AUTH=$(solana address --keypair "$ADMIN_KP")
auth_resp=$(curl -s "$RPC_URL" -X POST -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setProgramAuthority\",\"params\":[\"${ARCIUM_PROGRAM_ID}\",\"${ADMIN_PUBKEY_FOR_AUTH}\"]}")
echo "surfnet_setProgramAuthority: ${auth_resp}" >> "$VERBOSE_LOG"
case "$auth_resp" in
  *'"error"'*) fail "Could not set Arcium program upgrade authority: ${auth_resp}" ;;
esac
ok "Upgrade authority set to ${ADMIN_PUBKEY_FOR_AUTH}"

task "Generating + funding ${NUM_RECOVERY_PEERS} recovery peers"
mkdir -p "$RECOVERY_KEYS_DIR"
RECOVERY_PUBKEYS=""
for i in $(seq_n $NUM_RECOVERY_PEERS); do
  peer_dir="${RECOVERY_KEYS_DIR}/peer-${i}"
  mkdir -p "$peer_dir"
  if [ ! -f "${peer_dir}/keypair.json" ]; then
    solana-keygen new --outfile "${peer_dir}/keypair.json" --no-bip39-passphrase --force >> "$VERBOSE_LOG" 2>&1
  fi
  if [ ! -f "${peer_dir}/x25519-keypair.json" ]; then
    arcium generate-x25519 --output "${peer_dir}/x25519-keypair.json" >> "$VERBOSE_LOG" 2>&1
  fi
  peer_addr=$(solana address --keypair "${peer_dir}/keypair.json")
  RECOVERY_PUBKEYS="${RECOVERY_PUBKEYS}${RECOVERY_PUBKEYS:+,}${peer_addr}"
  airdrop_sol "${peer_dir}/keypair.json" 100
  curl -s "$RPC_URL" -X POST -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setTokenAccount\",\"params\":[\"${peer_addr}\",\"${ARX_MINT}\",{\"amount\":${ARX_BASE_UNITS}}]}" \
    >> "$VERBOSE_LOG" 2>&1
done
ok "${NUM_RECOVERY_PEERS} recovery peers funded"

task "Adding recovery peers to the permissioned allowlist"
if ADMIN_KEYPAIR="$ADMIN_KP" \
   ANCHOR_PROVIDER_URL="$RPC_URL" \
   RECOVERY_PEER_PUBKEYS="$RECOVERY_PUBKEYS" \
   bun run "${PROJECT_ROOT}/scripts/init-recovery-peers.ts" >> "$VERBOSE_LOG" 2>&1; then
  ok "Recovery peers permissioned"
else
  fail "Could not permission the recovery peers. See ${VERBOSE_LOG}"
fi

task "Staking + registering ${NUM_RECOVERY_PEERS} recovery peers"
RP_PIDS=()
for i in $(seq_n $NUM_RECOVERY_PEERS); do
  peer_dir="${RECOVERY_KEYS_DIR}/peer-${i}"
  peer_offset=$((RECOVERY_PEER_OFFSET_START + i - 1))
  (
    # Idempotent: the stake account survives a re-run against a persisted DB.
    arcium init-primary-stake \
      --keypair-path "${peer_dir}/keypair.json" \
      --amount "$NODE_STAKE_ARX" \
      --fee-basis-points 0 \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1 || true
    arcium init-recovery-peer \
      --keypair-path "${peer_dir}/keypair.json" \
      --peer-offset "$peer_offset" \
      --x25519-keypair-path "${peer_dir}/x25519-keypair.json" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1
  ) &
  RP_PIDS+=($!)
done
run_parallel "Registering recovery peers" "${RP_PIDS[@]}"

for i in $(seq_n $NUM_RECOVERY_PEERS); do
  peer_offset=$((RECOVERY_PEER_OFFSET_START + i - 1))
  if ! arcium recovery-peer-info --peer-offset "$peer_offset" --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1; then
    fail "Recovery peer ${peer_offset} was not registered. See ${VERBOSE_LOG}"
  fi
done
ok "All ${NUM_RECOVERY_PEERS} recovery peers registered"

step_done

# =========================================================================
# STEP 6: Start Docker ARX nodes
# =========================================================================
step_start 6 "Starting Docker ARX nodes"

if ! command -v docker &>/dev/null; then
  fail "docker not found. Install Docker to run ARX nodes."
fi

task "Cleaning up old Docker resources"
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" down >> "$VERBOSE_LOG" 2>&1 || true
for net in $(docker network ls --filter driver=bridge --format '{{.Name}}' 2>/dev/null); do
  subnet=$(docker network inspect "$net" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo "")
  if [ "$subnet" = "172.20.0.0/16" ]; then
    docker network rm "$net" >> "$VERBOSE_LOG" 2>&1 || true
  fi
done

task "Running docker compose up"
docker compose -f "${PROJECT_ROOT}/docker-compose.yml" up -d >> "$VERBOSE_LOG" 2>&1
ok "Docker services started (or starting)"

# Wait for all nodes (including extra nodes outside the cluster) to become active
task "Waiting for all ARX nodes to become active"
ALL_OFFSETS=()
for i in $(seq_n $NUM_NODES); do
  ALL_OFFSETS+=($((NODE_OFFSET_START + i - 1)))
done
for i in $(seq_n $NUM_EXTRA_NODES); do
  ALL_OFFSETS+=($((EXTRA_NODE_OFFSET_START + i - 1)))
done

ARX_ACTIVE_MAX=60
ARX_ACTIVE_ATTEMPT=0
ALL_ACTIVE=false
while [ $ARX_ACTIVE_ATTEMPT -lt $ARX_ACTIVE_MAX ]; do
  ALL_ACTIVE=true
  for offset in "${ALL_OFFSETS[@]}"; do
    if ! arcium arx-active --rpc-url "$RPC_URL" "$offset" 2>/dev/null | grep -qi "true"; then
      ALL_ACTIVE=false
      break
    fi
  done
  if [ "$ALL_ACTIVE" = true ]; then
    break
  fi
  ARX_ACTIVE_ATTEMPT=$((ARX_ACTIVE_ATTEMPT + 1))
  sleep 5
done
if [ "$ALL_ACTIVE" = true ]; then
  ok "All ${#ALL_OFFSETS[@]} ARX nodes are active"
else
  warn "Not all nodes became active after $((ARX_ACTIVE_MAX * 5))s — deploy may fail"
  for offset in "${ALL_OFFSETS[@]}"; do
    status=$(arcium arx-active --rpc-url "$RPC_URL" "$offset" 2>&1 || echo "error")
    echo -e "  ${DIM}  offset ${offset}: ${status}${RESET}" >&2
  done
fi

step_done

# =========================================================================
# WAIT: Ensure build has finished before deploying
# =========================================================================
if [ -n "$BUILD_PID" ]; then
  task "Waiting for background build to finish (PID ${BUILD_PID})"
  if wait "$BUILD_PID"; then
    ok "Background build completed successfully"
  else
    fail "arcium build failed. Check ${BUILD_LOG}"
  fi
  BUILD_PID=""
fi

# =========================================================================
# STEP 7: Deploy program + Initialize MXE
# =========================================================================
if [ "$SKIP_DEPLOY" = false ]; then
  step_start 7 "Deploying program & initializing MXE"

  # Load .env if it exists (for CIRCUIT_BUCKET, CIRCUIT_BASE_URL)
  if [ -f "${PROJECT_ROOT}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "${PROJECT_ROOT}/.env"
    set +a
  fi

  # Deploy program only (skip MXE init — we do it separately with explicit --authority)
  task "Deploying program (skip-init)"
  DEPLOY_OK=false
  arcium deploy \
    --keypair-path "$ADMIN_KP" \
    --cluster-offset "$CLUSTER_OFFSET" \
    --recovery-set-size "$RECOVERY_SET_SIZE" \
    --program-name encrypted_forest \
    --skip-init \
    --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1 || {
    warn "arcium deploy exited with error (may be OK if program already deployed)"
  }
  ok "Program deploy step complete"

  # Initialize MXE separately. Since v0.13 there is no --authority flag: the
  # signer becomes the MXE authority, and it must also be the program's upgrade
  # authority. admin.json is both (it deployed the program), so init-comp-defs.ts
  # (which signs with admin.json) passes the authority check.
  PROGRAM_ID=$(solana address --keypair "$PROGRAM_KP" 2>/dev/null || echo "")
  ADMIN_PUBKEY=$(solana address --keypair "$ADMIN_KP" 2>/dev/null || echo "")
  if [ -n "$PROGRAM_ID" ] && [ -n "$ADMIN_PUBKEY" ]; then
    task "Initializing MXE (authority=${ADMIN_PUBKEY})"
    if arcium init-mxe \
      --callback-program "$PROGRAM_ID" \
      --cluster-offset "$CLUSTER_OFFSET" \
      --recovery-set-size "$RECOVERY_SET_SIZE" \
      --keypair-path "$ADMIN_KP" \
      --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1; then
      DEPLOY_OK=true
      ok "MXE initialized with admin authority"
    else
      warn "MXE init failed — may already be initialized or check ${VERBOSE_LOG}"
      # If init-mxe failed because account already exists, we can still proceed
      DEPLOY_OK=true
    fi
  else
    warn "Could not determine program ID or admin pubkey. MXE init skipped."
  fi

  # Finalize MXE keys — ARX nodes must complete DKG first, so retry with backoff
  # Only attempt if deploy/init-mxe actually succeeded (MXE account must exist)
  PROGRAM_ID=$(solana address --keypair "$PROGRAM_KP" 2>/dev/null || echo "")
  if [ "$DEPLOY_OK" = true ] && [ -n "$PROGRAM_ID" ]; then
    task "Waiting for DKG completion, then finalizing MXE keys"
    FINALIZE_MAX=30
    FINALIZE_ATTEMPT=0
    FINALIZE_OK=false
    while [ $FINALIZE_ATTEMPT -lt $FINALIZE_MAX ]; do
      if arcium finalize-mxe-keys "$PROGRAM_ID" \
           --keypair-path "$ADMIN_KP" \
           --cluster-offset "$CLUSTER_OFFSET" \
           --rpc-url "$RPC_URL" >> "$VERBOSE_LOG" 2>&1; then
        FINALIZE_OK=true
        break
      fi
      FINALIZE_ATTEMPT=$((FINALIZE_ATTEMPT + 1))
      sleep 10
    done
    if [ "$FINALIZE_OK" = true ]; then
      ok "MXE keys finalized"
    else
      warn "finalize-mxe-keys failed after ${FINALIZE_MAX} attempts"
      warn "Retry manually: arcium finalize-mxe-keys ${PROGRAM_ID} --keypair-path admin.json --cluster-offset 0 --rpc-url $RPC_URL"
    fi
  else
    warn "Could not determine program ID. Skipping finalize-mxe-keys."
    warn "Run manually: arcium finalize-mxe-keys <PROGRAM_ID> --keypair-path admin.json --cluster-offset 0 --rpc-url $RPC_URL"
  fi

  # Upload circuits to R2 (if CIRCUIT_BUCKET is set), skipping if unchanged
  if [ -n "${CIRCUIT_BUCKET:-}" ]; then
    CIRCUITS_HASH_FILE="${PROJECT_ROOT}/.pids/circuits-hash"
    CURRENT_CIRCUITS_HASH=""
    if compgen -G "${PROJECT_ROOT}/build/*.arcis" > /dev/null 2>&1; then
      CURRENT_CIRCUITS_HASH=$(shasum -a 256 "${PROJECT_ROOT}"/build/*.arcis | shasum -a 256 | cut -d' ' -f1)
    fi
    PREVIOUS_CIRCUITS_HASH=""
    if [ -f "$CIRCUITS_HASH_FILE" ]; then
      PREVIOUS_CIRCUITS_HASH=$(cat "$CIRCUITS_HASH_FILE" 2>/dev/null || echo "")
    fi

    if [ -n "$CURRENT_CIRCUITS_HASH" ] && [ "$CURRENT_CIRCUITS_HASH" = "$PREVIOUS_CIRCUITS_HASH" ]; then
      ok "Circuits unchanged — skipping upload"
    else
      task "Uploading circuits to R2 bucket '${CIRCUIT_BUCKET}'"
      "${PROJECT_ROOT}/scripts/upload-circuits.sh" >> "$VERBOSE_LOG" 2>&1
      echo "$CURRENT_CIRCUITS_HASH" > "$CIRCUITS_HASH_FILE"
      ok "Circuits uploaded"
    fi
  else
    warn "CIRCUIT_BUCKET not set — skipping circuit upload"
  fi

  step_done
else
  echo -e "${DIM}[$(elapsed)] Step 7: Skipped (--skip-deploy)${RESET}" >&2
  echo "" >&2
fi

# =========================================================================
# STEP 8: Initialize computation definitions
# Always runs (comp defs must be initialized after every DB reset / deploy)
# =========================================================================
step_start 8 "Initializing computation definitions"

# Load .env if not already loaded (needed for CIRCUIT_BASE_URL)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_ROOT}/.env"
  set +a
fi

INIT_SCRIPT="${PROJECT_ROOT}/scripts/init-comp-defs.ts"
if [ -f "$INIT_SCRIPT" ]; then
  task "Running init-comp-defs.ts"
  cd "${PROJECT_ROOT}"
  if ARCIUM_CLUSTER_OFFSET="${CLUSTER_OFFSET}" \
     ADMIN_KEYPAIR="${ADMIN_KP}" \
     ANCHOR_PROVIDER_URL="${RPC_URL}" \
     bun run "$INIT_SCRIPT" 2>&1 | tee -a "$VERBOSE_LOG" >&2; then
    ok "All computation definitions initialized"
  else
    warn "init-comp-defs.ts exited with error — some comp defs may not be initialized"
    warn "Run manually: bun run scripts/init-comp-defs.ts"
  fi
else
  warn "No init-comp-defs.ts found — comp defs must be initialized manually"
fi

step_done

# =========================================================================
# STEP 9: Copy IDL into SDK folders
# =========================================================================
step_start 9 "Copying IDL to sdk/core (single source of truth)"

IDL_JSON="${PROJECT_ROOT}/target/idl/encrypted_forest.json"
IDL_TYPES="${PROJECT_ROOT}/target/types/encrypted_forest.ts"

if [ -f "$IDL_JSON" ]; then
  mkdir -p "${PROJECT_ROOT}/sdk/core/src/idl"
  cp "$IDL_JSON" "${PROJECT_ROOT}/sdk/core/src/idl/encrypted_forest.json"
  ok "IDL JSON copied to sdk/core/src/idl/"
else
  warn "IDL JSON not found at ${IDL_JSON} — run arcium build first"
fi

if [ -f "$IDL_TYPES" ]; then
  cp "$IDL_TYPES" "${PROJECT_ROOT}/sdk/core/src/idl/encrypted_forest.ts"
  ok "IDL types copied to sdk/core/src/idl/"
else
  warn "IDL types not found at ${IDL_TYPES} — run arcium build first"
fi

ok "All downstream packages import IDL from @encrypted-forest/core"

step_done

# =========================================================================
# Final Summary
# =========================================================================
stop_heartbeat

FINAL_ELAPSED=$(elapsed)
FINAL_PROGRAM_ID=$(solana address --keypair "$PROGRAM_KP" 2>/dev/null || echo 'unknown')

echo -e "" >&2
echo -e "${BOLD}${GREEN}  ╔═══════════════════════════════════════════════════╗${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║   Encrypted Forest — Local Environment Ready     ║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ╠═══════════════════════════════════════════════════╣${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}                                                   ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Total time${RESET}    : ${CYAN}${FINAL_ELAPSED}${RESET}                          ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Program ID${RESET}    : ${DIM}${FINAL_PROGRAM_ID}${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Surfpool RPC${RESET}  : ${RPC_URL}                ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Surfpool WS${RESET}   : ws://localhost:8900          ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Admin keypair${RESET} : ${DIM}${ADMIN_KP}${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Cluster${RESET}       : offset=${CLUSTER_OFFSET}, nodes=${NUM_NODES}             ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}                                                   ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}  ${BOLD}Next steps:${RESET}                                    ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}    ${CYAN}cd client && bun run dev${RESET}  — Start game client ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}    ${CYAN}make test-local${RESET}           — Run tests         ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}    ${CYAN}./scripts/dev-stop.sh${RESET}     — Stop everything   ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ║${RESET}                                                   ${BOLD}${GREEN}║${RESET}" >&2
echo -e "${BOLD}${GREEN}  ╚═══════════════════════════════════════════════════╝${RESET}" >&2
echo "" >&2
