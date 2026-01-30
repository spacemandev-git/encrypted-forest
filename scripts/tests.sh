#!/usr/bin/env bash
# tests.sh - Run Encrypted Forest test suites
#
# Runs the full test battery:
#   1. Unit tests (vitest — no Arcium required)
#   2. E2E game scenario (full Arcium MPC flow, 2 players)
#
# Requires:
#   - Surfpool running at localhost:8899
#   - Arcium ARX nodes running (via Docker)
#   - Program deployed and MXE initialized
#   - Computation definitions initialized
#
# Usage:
#   ./scripts/tests.sh                    # Run all tests
#   ./scripts/tests.sh --unit-only        # Unit tests only (no Arcium needed)
#   ./scripts/tests.sh --e2e-only         # E2E game scenario only
#   ./scripts/tests.sh --skip-unit        # Skip unit tests, run E2E only

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
RUN_UNIT=true
RUN_E2E=true

while [ $# -gt 0 ]; do
  case "$1" in
    --unit-only)   RUN_E2E=false ;;
    --e2e-only)    RUN_UNIT=false ;;
    --skip-unit)   RUN_UNIT=false ;;
    --help|-h)
      echo "Usage: tests.sh [--unit-only] [--e2e-only] [--skip-unit]"
      echo ""
      echo "  --unit-only    Run only vitest unit/integration tests"
      echo "  --e2e-only     Run only the E2E game scenario"
      echo "  --skip-unit    Skip unit tests (same as --e2e-only)"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1"
      exit 1
      ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Terminal formatting
# ---------------------------------------------------------------------------
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

SCRIPT_START=$(date +%s)

elapsed() {
  local now
  now=$(date +%s)
  local diff=$(( now - SCRIPT_START ))
  local mins=$(( diff / 60 ))
  local secs=$(( diff % 60 ))
  printf "%dm %02ds" "$mins" "$secs"
}

step_start() {
  local step_num="$1"
  local description="$2"
  STEP_START=$(date +%s)
  echo -e "${BOLD}${CYAN}[$(elapsed)]${RESET} ${BOLD}Step ${step_num}: ${description}${RESET}" >&2
}

step_done() {
  local now
  now=$(date +%s)
  local dur=$(( now - STEP_START ))
  local mins=$(( dur / 60 ))
  local secs=$(( dur % 60 ))
  local durStr
  if [ "$mins" -gt 0 ]; then
    durStr="${mins}m $(printf '%02d' "$secs")s"
  else
    durStr="${secs}s"
  fi
  echo -e "${BOLD}${GREEN}  ✓${RESET} ${DIM}Done (${durStr})${RESET}" >&2
  echo "" >&2
}

step_fail() {
  echo -e "${BOLD}${RED}  ✗ FAILED${RESET}" >&2
  echo "" >&2
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo -e "${BOLD}${CYAN}" >&2
echo -e "  ╔══════════════════════════════════════════════════╗" >&2
echo -e "  ║     Encrypted Forest — Test Suite                ║" >&2
echo -e "  ╚══════════════════════════════════════════════════╝${RESET}" >&2
echo "" >&2

STEP_NUM=0
UNIT_OK=true
E2E_OK=true

# ---------------------------------------------------------------------------
# Source .env if present (CIRCUIT_BASE_URL, etc.)
# ---------------------------------------------------------------------------
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Default ARCIUM_CLUSTER_OFFSET to 0 for localnet if not set
export ARCIUM_CLUSTER_OFFSET="${ARCIUM_CLUSTER_OFFSET:-0}"

# Anchor provider env vars (so the e2e script can construct Connection)
export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://localhost:8899}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

# =========================================================================
# Pre-flight: check Surfpool is running
# =========================================================================
STEP_NUM=$((STEP_NUM + 1))
step_start $STEP_NUM "Pre-flight checks"

if curl -s "http://localhost:8899/health" > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓ Surfpool RPC is healthy${RESET}" >&2
else
  echo -e "  ${RED}✗ Surfpool not running at localhost:8899${RESET}" >&2
  echo -e "  ${YELLOW}⚠ Start with: ./scripts/run-local.sh${RESET}" >&2
  if [ "$RUN_E2E" = true ]; then
    echo -e "  ${YELLOW}⚠ E2E tests require Surfpool + Arcium. Exiting.${RESET}" >&2
    exit 1
  fi
fi

# Check if Arcium env vars are set
if [ -z "${ARCIUM_CLUSTER_OFFSET:-}" ]; then
  echo -e "  ${YELLOW}⚠ ARCIUM_CLUSTER_OFFSET not set — MPC tests may be skipped${RESET}" >&2
fi
if [ -z "${CIRCUIT_BASE_URL:-}" ]; then
  echo -e "  ${YELLOW}⚠ CIRCUIT_BASE_URL not set — comp defs may not work${RESET}" >&2
fi

step_done

# =========================================================================
# Step: Unit + Integration Tests (vitest)
# =========================================================================
if [ "$RUN_UNIT" = true ]; then
  STEP_NUM=$((STEP_NUM + 1))
  step_start $STEP_NUM "Running unit & integration tests (vitest)"

  cd "$PROJECT_ROOT"
  if bun run vitest run --reporter=verbose 2>&1 | while IFS= read -r line; do
    echo -e "  ${DIM}${line}${RESET}" >&2
  done; then
    step_done
  else
    step_fail
    UNIT_OK=false
    echo -e "  ${RED}Unit tests had failures — see output above${RESET}" >&2
    echo "" >&2
  fi
else
  echo -e "${DIM}[$(elapsed)] Skipping unit tests${RESET}" >&2
  echo "" >&2
fi

# =========================================================================
# Step: E2E Game Scenario
# =========================================================================
if [ "$RUN_E2E" = true ]; then
  STEP_NUM=$((STEP_NUM + 1))
  step_start $STEP_NUM "Running E2E game scenario (2 players, full lifecycle)"

  cd "$PROJECT_ROOT"

  # The e2e script uses Anchor provider from env, same as vitest
  if bun run scripts/e2e-game.ts 2>&1 | while IFS= read -r line; do
    # Pass through — the e2e script has its own formatting
    echo "$line" >&2
  done; then
    step_done
  else
    step_fail
    E2E_OK=false
    echo -e "  ${RED}E2E game scenario failed — see output above${RESET}" >&2
    echo "" >&2
  fi
else
  echo -e "${DIM}[$(elapsed)] Skipping E2E game scenario${RESET}" >&2
  echo "" >&2
fi

# =========================================================================
# Final Summary
# =========================================================================
TOTAL_ELAPSED=$(elapsed)
ALL_OK=true
if [ "$UNIT_OK" = false ] || [ "$E2E_OK" = false ]; then
  ALL_OK=false
fi

if [ "$ALL_OK" = true ]; then
  STATUS_COLOR="$GREEN"
  STATUS_ICON="✓"
  STATUS_TEXT="ALL TESTS PASSED"
else
  STATUS_COLOR="$RED"
  STATUS_ICON="✗"
  STATUS_TEXT="SOME TESTS FAILED"
fi

echo "" >&2
echo -e "${BOLD}${STATUS_COLOR}  ╔══════════════════════════════════════════════════╗${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ║   Encrypted Forest — Test Results                ║${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ╠══════════════════════════════════════════════════╣${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}                                                  ${BOLD}${STATUS_COLOR}║${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}  ${BOLD}Total time${RESET}  : ${CYAN}${TOTAL_ELAPSED}${RESET}                            ${BOLD}${STATUS_COLOR}║${RESET}" >&2

if [ "$RUN_UNIT" = true ]; then
  if [ "$UNIT_OK" = true ]; then
    echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}  ${BOLD}Unit tests${RESET}  : ${GREEN}✓ passed${RESET}                          ${BOLD}${STATUS_COLOR}║${RESET}" >&2
  else
    echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}  ${BOLD}Unit tests${RESET}  : ${RED}✗ failed${RESET}                          ${BOLD}${STATUS_COLOR}║${RESET}" >&2
  fi
fi

if [ "$RUN_E2E" = true ]; then
  if [ "$E2E_OK" = true ]; then
    echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}  ${BOLD}E2E game${RESET}    : ${GREEN}✓ passed${RESET}                          ${BOLD}${STATUS_COLOR}║${RESET}" >&2
  else
    echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}  ${BOLD}E2E game${RESET}    : ${RED}✗ failed${RESET}                          ${BOLD}${STATUS_COLOR}║${RESET}" >&2
  fi
fi

echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}                                                  ${BOLD}${STATUS_COLOR}║${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}  ${BOLD}Result${RESET}      : ${STATUS_COLOR}${STATUS_ICON} ${STATUS_TEXT}${RESET}                ${BOLD}${STATUS_COLOR}║${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ║${RESET}                                                  ${BOLD}${STATUS_COLOR}║${RESET}" >&2
echo -e "${BOLD}${STATUS_COLOR}  ╚══════════════════════════════════════════════════╝${RESET}" >&2
echo "" >&2

if [ "$ALL_OK" = true ]; then
  exit 0
else
  exit 1
fi
