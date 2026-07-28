#!/usr/bin/env bash
# deploy-local.sh - Build, upload circuits, and deploy Encrypted Forest to local Surfpool
#
# Circuit storage is chosen by env file:
#   .env       -> Cloudflare R2 (wrangler)
#   .env.local -> local S3 bucket (MinIO, brought up via docker compose)
# .env.local is sourced last, so its values win when present.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="${RPC_URL:-http://localhost:8899}"

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
for ENV_FILE in "${PROJECT_ROOT}/.env" "${PROJECT_ROOT}/.env.local"; do
  if [ -f "${ENV_FILE}" ]; then
    echo "Loading $(basename "${ENV_FILE}") ..."
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
done

CIRCUIT_BUCKET="${CIRCUIT_BUCKET:?CIRCUIT_BUCKET env var is required (set it in .env or .env.local)}"
CIRCUIT_S3_ENDPOINT="${CIRCUIT_S3_ENDPOINT:-}"

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
# Bring up the local S3 bucket (only when CIRCUIT_S3_ENDPOINT is configured)
# ---------------------------------------------------------------------------
if [ -n "${CIRCUIT_S3_ENDPOINT}" ]; then
  if ! command -v docker &>/dev/null; then
    echo "Error: docker not found, but CIRCUIT_S3_ENDPOINT is set."
    exit 1
  fi

  echo "Starting local S3 (MinIO) and ensuring bucket '${CIRCUIT_BUCKET}' exists ..."
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" up -d minio minio-init

  echo -n "Waiting for MinIO at ${CIRCUIT_S3_ENDPOINT} ..."
  MINIO_RETRY=0
  while [ $MINIO_RETRY -lt 30 ]; do
    if curl -sf "${CIRCUIT_S3_ENDPOINT%/}/minio/health/live" > /dev/null 2>&1; then
      echo " ready."
      break
    fi
    echo -n "."
    sleep 1
    MINIO_RETRY=$((MINIO_RETRY + 1))
  done

  if [ $MINIO_RETRY -ge 30 ]; then
    echo " timed out."
    echo "Check: docker compose logs minio"
    exit 1
  fi

  # minio-init is a one-shot; give it a moment to apply the bucket policy.
  docker wait ef-minio-init > /dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# Upload circuits
# ---------------------------------------------------------------------------
if [ -n "${CIRCUIT_S3_ENDPOINT}" ]; then
  echo "Uploading .arcis circuit files to local bucket '${CIRCUIT_BUCKET}' ..."
else
  echo "Uploading .arcis circuit files to R2 bucket '${CIRCUIT_BUCKET}' ..."
fi
"${PROJECT_ROOT}/scripts/upload-circuits.sh"

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
echo "Deploying program to ${RPC_URL} ..."
anchor deploy --provider.cluster "${RPC_URL}"
echo "Program deployed successfully."

# ---------------------------------------------------------------------------
# Initialize computation definitions (offchain circuits from R2)
# ---------------------------------------------------------------------------
INIT_SCRIPT="${PROJECT_ROOT}/scripts/init-comp-defs.ts"
if [ -f "$INIT_SCRIPT" ]; then
  echo "Initializing computation definitions (offchain from R2) ..."
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
echo "  RPC:      ${RPC_URL}"
if [ -n "${CIRCUIT_S3_ENDPOINT}" ]; then
  echo "  Circuits: local S3 bucket '${CIRCUIT_BUCKET}' (${CIRCUIT_S3_ENDPOINT})"
  echo "  Console:  http://localhost:9001"
else
  echo "  Circuits: R2 bucket '${CIRCUIT_BUCKET}'"
fi
echo "  Fetch URL: ${CIRCUIT_BASE_URL:-<unset>}/<circuit>.arcis"
echo "  Program deployed and ready."
