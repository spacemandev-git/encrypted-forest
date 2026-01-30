#!/usr/bin/env bash
# upload-circuits.sh - Upload compiled .arcis circuit files to Cloudflare R2
#
# Requires: wrangler CLI (bun add -g wrangler) authenticated with Cloudflare
#
# Environment variables (required):
#   CIRCUIT_BUCKET - R2 bucket name

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${PROJECT_ROOT}/build"
BUCKET="${CIRCUIT_BUCKET:?CIRCUIT_BUCKET env var is required}"

if [ ! -d "${BUILD_DIR}" ]; then
  echo "Error: ${BUILD_DIR} does not exist. Run 'arcium build' first."
  exit 1
fi

if ! command -v wrangler &>/dev/null; then
  echo "Error: wrangler CLI not found. Install with: bun add -g wrangler"
  exit 1
fi

ARCIS_FILES=("${BUILD_DIR}"/*.arcis)
if [ ${#ARCIS_FILES[@]} -eq 0 ]; then
  echo "No .arcis files found in ${BUILD_DIR}."
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
