#!/usr/bin/env bash
# deploy-local.sh - Build and deploy Encrypted Forest to local Surfpool

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="${RPC_URL:-http://localhost:8899}"

# ---------------------------------------------------------------------------
# Wait for RPC health
# ---------------------------------------------------------------------------
echo "Waiting for Surfpool RPC at ${RPC_URL} ..."
MAX_RETRIES=60
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s "${RPC_URL}/health" > /dev/null 2>&1; then
    echo "RPC is healthy."
    break
  fi
  sleep 1
  RETRY=$((RETRY + 1))
done

if [ $RETRY -ge $MAX_RETRIES ]; then
  echo "Error: RPC at ${RPC_URL} did not become healthy within ${MAX_RETRIES}s."
  echo "Make sure Surfpool is running (./scripts/dev-start.sh)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "Building program with arcium build ..."
cd "${PROJECT_ROOT}"
arcium build

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
echo "Deploying program to ${RPC_URL} ..."
anchor deploy --provider.cluster "${RPC_URL}"
echo "Program deployed successfully."

# ---------------------------------------------------------------------------
# Initialize computation definitions
# ---------------------------------------------------------------------------
INIT_SCRIPT="${PROJECT_ROOT}/scripts/init-comp-defs.ts"
if [ -f "$INIT_SCRIPT" ]; then
  echo "Initializing computation definitions ..."
  cd "${PROJECT_ROOT}"
  bun run "${INIT_SCRIPT}"
  echo "Computation definitions initialized."
else
  echo ""
  echo "NOTE: No init-comp-defs.ts script found at ${INIT_SCRIPT}."
  echo "Computation definitions must be initialized manually or via tests."
fi

echo ""
echo "=== Deployment Complete ==="
echo "  RPC: ${RPC_URL}"
echo "  Program deployed and ready."
