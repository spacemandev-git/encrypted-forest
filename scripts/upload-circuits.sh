#!/usr/bin/env bash
# upload-circuits.sh - Upload compiled .arcis circuit files to circuit storage
#
# Two backends, selected by whether CIRCUIT_S3_ENDPOINT is set:
#
#   1. Local S3 (MinIO)  - CIRCUIT_S3_ENDPOINT set (see .env.local)
#      Uploads with plain curl PUT against an anonymously-writable bucket.
#      No extra CLI needed.
#
#   2. Cloudflare R2      - CIRCUIT_S3_ENDPOINT unset (see .env)
#      Requires: wrangler CLI (bun add -g wrangler) authenticated with Cloudflare
#
# Environment variables:
#   CIRCUIT_BUCKET      - bucket name (required)
#   CIRCUIT_S3_ENDPOINT - S3 API endpoint, e.g. http://localhost:9000 (optional)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${PROJECT_ROOT}/build"
BUCKET="${CIRCUIT_BUCKET:?CIRCUIT_BUCKET env var is required}"
S3_ENDPOINT="${CIRCUIT_S3_ENDPOINT:-}"

if [ ! -d "${BUILD_DIR}" ]; then
  echo "Error: ${BUILD_DIR} does not exist. Run 'arcium build' first."
  exit 1
fi

shopt -s nullglob
ARCIS_FILES=("${BUILD_DIR}"/*.arcis)
shopt -u nullglob

if [ ${#ARCIS_FILES[@]} -eq 0 ]; then
  echo "No .arcis files found in ${BUILD_DIR}."
  exit 1
fi

# ---------------------------------------------------------------------------
# Local S3 (MinIO)
# ---------------------------------------------------------------------------
if [ -n "${S3_ENDPOINT}" ]; then
  S3_ENDPOINT="${S3_ENDPOINT%/}"

  if ! curl -sf "${S3_ENDPOINT}/minio/health/live" > /dev/null 2>&1; then
    echo "Error: no S3 endpoint responding at ${S3_ENDPOINT}."
    echo "Start it with: docker compose up -d minio minio-init"
    exit 1
  fi

  echo "Uploading ${#ARCIS_FILES[@]} circuit files to ${S3_ENDPOINT}/${BUCKET} ..."

  for f in "${ARCIS_FILES[@]}"; do
    FILENAME=$(basename "$f")
    SIZE=$(du -h "$f" | cut -f1)
    echo "  ${FILENAME} (${SIZE}) ..."
    curl -sf -X PUT \
      -H "Content-Type: application/octet-stream" \
      --upload-file "$f" \
      "${S3_ENDPOINT}/${BUCKET}/${FILENAME}" > /dev/null
  done

  # The ARX nodes fetch these anonymously — verify that actually works.
  PROBE=$(basename "${ARCIS_FILES[0]}")
  if ! curl -sfI "${S3_ENDPOINT}/${BUCKET}/${PROBE}" > /dev/null 2>&1; then
    echo "Error: uploaded objects are not anonymously readable."
    echo "Fix with: docker compose up -d minio-init"
    exit 1
  fi

  echo "All circuit files uploaded to local bucket '${BUCKET}'."
  echo "CIRCUIT_BASE_URL must point at this bucket from INSIDE arcium-net"
  echo "  (e.g. http://172.20.0.98:9000/${BUCKET}), not localhost."
  exit 0
fi

# ---------------------------------------------------------------------------
# Cloudflare R2
# ---------------------------------------------------------------------------
if ! command -v wrangler &>/dev/null; then
  echo "Error: wrangler CLI not found. Install with: bun add -g wrangler"
  echo "(Or set CIRCUIT_S3_ENDPOINT to upload to a local S3 bucket instead.)"
  exit 1
fi

echo "Uploading ${#ARCIS_FILES[@]} circuit files to R2 bucket '${BUCKET}' ..."

for f in "${ARCIS_FILES[@]}"; do
  FILENAME=$(basename "$f")
  SIZE=$(du -h "$f" | cut -f1)
  echo "  ${FILENAME} (${SIZE}) ..."
  wrangler r2 object put "${BUCKET}/${FILENAME}" --file "$f" --remote
done

echo "All circuit files uploaded to R2 bucket '${BUCKET}'."
echo "Set CIRCUIT_BASE_URL to the public URL of this bucket."
