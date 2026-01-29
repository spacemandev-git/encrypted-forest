#!/usr/bin/env bash
# dev-stop.sh - Stop the Encrypted Forest local development environment

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDDIR="${PROJECT_ROOT}/.pids"

# ---------------------------------------------------------------------------
# Stop Surfpool
# ---------------------------------------------------------------------------
if [ -f "${PIDDIR}/surfpool.pid" ]; then
  SURFPOOL_PID=$(cat "${PIDDIR}/surfpool.pid")
  if kill -0 "$SURFPOOL_PID" 2>/dev/null; then
    echo "Stopping Surfpool (PID ${SURFPOOL_PID}) ..."
    kill "$SURFPOOL_PID"
    WAIT=0
    while kill -0 "$SURFPOOL_PID" 2>/dev/null && [ $WAIT -lt 10 ]; do
      sleep 1
      WAIT=$((WAIT + 1))
    done
    if kill -0 "$SURFPOOL_PID" 2>/dev/null; then
      echo "Force-killing Surfpool ..."
      kill -9 "$SURFPOOL_PID" 2>/dev/null || true
    fi
    echo "Surfpool stopped."
  else
    echo "Surfpool (PID ${SURFPOOL_PID}) is not running."
  fi
  rm -f "${PIDDIR}/surfpool.pid"
else
  echo "No Surfpool PID file found."
fi

# ---------------------------------------------------------------------------
# Stop Docker Compose services
# ---------------------------------------------------------------------------
if [ -f "${PROJECT_ROOT}/docker-compose.yml" ]; then
  if command -v docker &>/dev/null; then
    if docker compose -f "${PROJECT_ROOT}/docker-compose.yml" ps -q 2>/dev/null | grep -q .; then
      echo "Stopping Docker Compose services ..."
      docker compose -f "${PROJECT_ROOT}/docker-compose.yml" down
      echo "Docker services stopped."
    else
      echo "No Docker Compose services running."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
rmdir "${PIDDIR}" 2>/dev/null || true

echo "Dev environment stopped."
