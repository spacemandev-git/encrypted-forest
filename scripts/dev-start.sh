#!/usr/bin/env bash
# dev-start.sh - Start the Encrypted Forest local development environment
# Launches Surfpool with SQLite persistence and transaction-only block production.
# Optionally starts Arcium ARX nodes via Docker Compose.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDDIR="${PROJECT_ROOT}/.pids"
DB_PATH="${PROJECT_ROOT}/dev.sqlite"
SURFPOOL_LOG="${PROJECT_ROOT}/logs/surfpool.log"

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
WITH_DOCKER=false
WATCH=false

for arg in "$@"; do
  case "$arg" in
    --docker) WITH_DOCKER=true ;;
    --watch)  WATCH=true ;;
    --help|-h)
      echo "Usage: dev-start.sh [--docker] [--watch]"
      echo "  --docker  Also start ARX nodes and Postgres via Docker Compose"
      echo "  --watch   Enable Surfpool file watcher for auto-redeploy on .so changes"
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
mkdir -p "${PIDDIR}" "${PROJECT_ROOT}/logs"

cleanup_stale_pid() {
  local pidfile="$1"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Process $pid from $pidfile is still running. Stop it first with dev-stop.sh."
      exit 1
    else
      rm -f "$pidfile"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if ! command -v surfpool &>/dev/null; then
  echo "Error: surfpool CLI not found. Install it first."
  exit 1
fi

cleanup_stale_pid "${PIDDIR}/surfpool.pid"

# ---------------------------------------------------------------------------
# Start Surfpool
# ---------------------------------------------------------------------------
SURFPOOL_ARGS=(
  start
  --db "${DB_PATH}"
  --block-production-mode clock
  --port 8899
  --no-tui
)

if [ "$WATCH" = true ]; then
  SURFPOOL_ARGS+=(--watch)
fi

echo "Starting Surfpool (RPC on http://localhost:8899) ..."
echo "  Database: ${DB_PATH}"
echo "  Block mode: transaction"

surfpool "${SURFPOOL_ARGS[@]}" > "${SURFPOOL_LOG}" 2>&1 &
SURFPOOL_PID=$!
echo "${SURFPOOL_PID}" > "${PIDDIR}/surfpool.pid"
echo "Surfpool started (PID ${SURFPOOL_PID}). Logs: ${SURFPOOL_LOG}"

# Wait for RPC to become responsive
echo -n "Waiting for RPC..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:8899/health > /dev/null 2>&1; then
    echo " ready."
    break
  fi
  echo -n "."
  sleep 1
  RETRY=$((RETRY + 1))
done

if [ $RETRY -ge $MAX_RETRIES ]; then
  echo " timed out after ${MAX_RETRIES}s. Check ${SURFPOOL_LOG} for errors."
  exit 1
fi

# ---------------------------------------------------------------------------
# Optionally start Docker services (ARX nodes, Postgres)
# ---------------------------------------------------------------------------
if [ "$WITH_DOCKER" = true ]; then
  if ! command -v docker &>/dev/null; then
    echo "Error: docker not found. Install Docker to use --docker flag."
    exit 1
  fi
  echo "Starting Docker services (ARX nodes, Postgres) ..."
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" up -d
  echo "Docker services started."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Encrypted Forest Dev Environment ==="
echo "  Surfpool RPC : http://localhost:8899"
echo "  Surfpool WS  : ws://localhost:8900"
echo "  Surfpool PID : ${SURFPOOL_PID}"
if [ "$WITH_DOCKER" = true ]; then
  echo "  Docker       : running (docker compose ps for details)"
fi
echo ""
echo "Stop with: ./scripts/dev-stop.sh"
