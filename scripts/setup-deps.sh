#!/usr/bin/env bash
# setup-deps.sh - Check and install Encrypted Forest development dependencies
#
# Supports: macOS (Intel + Apple Silicon), Linux (x86_64 + aarch64), Windows (via WSL2)
#
# Usage:
#   ./scripts/setup-deps.sh           # Interactive: prompts before each install
#   ./scripts/setup-deps.sh --yes     # Auto-install everything missing
#   ./scripts/setup-deps.sh --check   # Check only, don't install anything

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RUST_VERSION="1.89.0"
ARCUP_VERSION="0.6.3"

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
AUTO_YES=false
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y)    AUTO_YES=true ;;
    --check|-c)  CHECK_ONLY=true ;;
    --help|-h)
      echo "Usage: setup-deps.sh [--yes|-y] [--check|-c]"
      echo "  --yes    Auto-install all missing dependencies without prompting"
      echo "  --check  Only check what's installed/missing, don't install anything"
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
detect_platform() {
  OS="unknown"
  ARCH="unknown"
  DISTRO="unknown"
  PKG_MANAGER="unknown"

  case "$(uname -s)" in
    Darwin)
      OS="macos"
      ;;
    Linux)
      OS="linux"
      # Detect if running inside WSL
      if grep -qi microsoft /proc/version 2>/dev/null; then
        OS="wsl"
      fi
      # Detect distro
      if [ -f /etc/os-release ]; then
        DISTRO=$(. /etc/os-release && echo "$ID")
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      OS="windows"
      ;;
    *)
      echo "Error: Unsupported operating system: $(uname -s)"
      echo "This script supports macOS, Linux, and Windows (via WSL2)."
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)  ARCH="x86_64" ;;
    arm64|aarch64)  ARCH="aarch64" ;;
    *)
      echo "Error: Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac

  # Detect package manager (Linux)
  if [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
    if command -v apt-get &>/dev/null; then
      PKG_MANAGER="apt"
    elif command -v dnf &>/dev/null; then
      PKG_MANAGER="dnf"
    elif command -v yum &>/dev/null; then
      PKG_MANAGER="yum"
    elif command -v pacman &>/dev/null; then
      PKG_MANAGER="pacman"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}[ok]${NC}     $1"; }
miss() { echo -e "  ${RED}[missing]${NC} $1"; }
skip() { echo -e "  ${YELLOW}[skip]${NC}   $1"; }
info() { echo -e "  ${BLUE}[info]${NC}   $1"; }

confirm() {
  if [ "$AUTO_YES" = true ]; then
    return 0
  fi
  if [ "$CHECK_ONLY" = true ]; then
    return 1
  fi
  local prompt="$1"
  echo -en "  ${BOLD}Install ${prompt}?${NC} [Y/n] "
  read -r answer
  case "$answer" in
    [nN]*) return 1 ;;
    *)     return 0 ;;
  esac
}

ensure_build_essentials() {
  # Many tools need a C compiler and basic build tools
  if [ "$OS" = "macos" ]; then
    if ! xcode-select -p &>/dev/null; then
      info "Installing Xcode Command Line Tools (required for compiling)..."
      xcode-select --install 2>/dev/null || true
      echo "    Please complete the Xcode CLT installation popup, then re-run this script."
      exit 1
    fi
  elif [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
    case "$PKG_MANAGER" in
      apt)
        if ! dpkg -s build-essential &>/dev/null 2>&1; then
          info "Installing build-essential, pkg-config, libssl-dev, libudev-dev..."
          sudo apt-get update -qq
          sudo apt-get install -y -qq build-essential pkg-config libssl-dev libudev-dev
        fi
        ;;
      dnf|yum)
        if ! rpm -q gcc &>/dev/null 2>&1; then
          info "Installing Development Tools, openssl-devel..."
          sudo "$PKG_MANAGER" groupinstall -y "Development Tools"
          sudo "$PKG_MANAGER" install -y openssl-devel systemd-devel
        fi
        ;;
      pacman)
        if ! pacman -Qi base-devel &>/dev/null 2>&1; then
          info "Installing base-devel, openssl..."
          sudo pacman -S --noconfirm base-devel openssl
        fi
        ;;
    esac
  fi
}

# ---------------------------------------------------------------------------
# Dependency checks and installers
# ---------------------------------------------------------------------------
MISSING=0

check_rust() {
  echo ""
  echo -e "${BOLD}Rust${NC}"
  if command -v rustc &>/dev/null; then
    local ver
    ver=$(rustc --version | awk '{print $2}')
    ok "rustc $ver"
    # Check rustup is available for toolchain management
    if command -v rustup &>/dev/null; then
      ok "rustup available"
    else
      miss "rustup not found (rustc exists but can't manage toolchains)"
      MISSING=$((MISSING + 1))
    fi
  else
    miss "rustc not found"
    MISSING=$((MISSING + 1))
    if confirm "Rust (via rustup)"; then
      info "Installing Rust via rustup..."
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
      # Source cargo env for current shell
      # shellcheck disable=SC1091
      source "${HOME}/.cargo/env" 2>/dev/null || true
      ok "Rust installed: $(rustc --version 2>/dev/null || echo 'restart shell to use')"
    else
      skip "Rust"
    fi
  fi

  # Ensure the project's required toolchain is installed
  if command -v rustup &>/dev/null; then
    if ! rustup toolchain list | grep -q "$RUST_VERSION"; then
      info "Installing Rust toolchain $RUST_VERSION (required by rust-toolchain.toml)..."
      rustup install "$RUST_VERSION"
    fi
  fi
}

check_bun() {
  echo ""
  echo -e "${BOLD}Bun${NC}"
  if command -v bun &>/dev/null; then
    ok "bun $(bun --version)"
  else
    miss "bun not found"
    MISSING=$((MISSING + 1))
    if confirm "Bun"; then
      info "Installing Bun..."
      curl -fsSL https://bun.sh/install | bash
      # Source updated profile
      export BUN_INSTALL="${HOME}/.bun"
      export PATH="${BUN_INSTALL}/bin:${PATH}"
      if command -v bun &>/dev/null; then
        ok "Bun installed: $(bun --version)"
      else
        info "Bun installed. Restart your shell or run: export PATH=\"\$HOME/.bun/bin:\$PATH\""
      fi
    else
      skip "Bun"
    fi
  fi
}

check_solana() {
  echo ""
  echo -e "${BOLD}Solana CLI${NC}"
  if command -v solana &>/dev/null; then
    ok "solana $(solana --version 2>&1 | head -1)"
  else
    miss "solana not found"
    MISSING=$((MISSING + 1))
    if confirm "Solana CLI (Agave)"; then
      info "Installing Solana CLI..."
      sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
      export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
      if command -v solana &>/dev/null; then
        ok "Solana installed: $(solana --version 2>&1 | head -1)"
      else
        info "Solana installed. Restart your shell or add to PATH."
      fi
    else
      skip "Solana CLI"
    fi
  fi

  # Check for keypair
  if command -v solana &>/dev/null; then
    local kp="${HOME}/.config/solana/id.json"
    if [ -f "$kp" ]; then
      ok "Keypair exists at $kp"
    else
      info "No keypair at $kp"
      if [ "$CHECK_ONLY" = false ]; then
        if confirm "Generate a new Solana keypair (localnet only, no real funds)"; then
          solana-keygen new --no-bip39-passphrase -o "$kp"
          ok "Keypair generated at $kp"
        else
          skip "Keypair generation"
        fi
      fi
    fi
  fi
}

check_anchor() {
  echo ""
  echo -e "${BOLD}Anchor CLI${NC}"
  if command -v anchor &>/dev/null; then
    ok "anchor $(anchor --version 2>&1)"
  else
    miss "anchor not found"
    MISSING=$((MISSING + 1))
    if confirm "Anchor CLI"; then
      info "Installing Anchor CLI via cargo..."
      cargo install --git https://github.com/coral-xyz/anchor --tag v0.32.1 anchor-cli
      if command -v anchor &>/dev/null; then
        ok "Anchor installed: $(anchor --version 2>&1)"
      else
        info "Anchor installed. Restart your shell if not on PATH."
      fi
    else
      skip "Anchor CLI"
    fi
  fi
}

check_surfpool() {
  echo ""
  echo -e "${BOLD}Surfpool${NC}"
  if command -v surfpool &>/dev/null; then
    ok "surfpool $(surfpool --version 2>&1 | head -1)"
  else
    miss "surfpool not found"
    MISSING=$((MISSING + 1))
    if confirm "Surfpool"; then
      info "Installing Surfpool..."
      curl -sL https://run.surfpool.run/ | bash
      if command -v surfpool &>/dev/null; then
        ok "Surfpool installed: $(surfpool --version 2>&1 | head -1)"
      else
        info "Surfpool installed. Restart your shell or add to PATH."
      fi
    else
      skip "Surfpool"
    fi
  fi
}

check_arcium() {
  echo ""
  echo -e "${BOLD}Arcium CLI${NC}"

  if [ "$OS" = "windows" ]; then
    miss "Arcium is not supported on Windows natively. Use WSL2 with Ubuntu."
    MISSING=$((MISSING + 1))
    return
  fi

  if command -v arcium &>/dev/null; then
    ok "arcium $(arcium --version 2>&1 | head -1)"
  else
    miss "arcium not found"
    MISSING=$((MISSING + 1))
    if confirm "Arcium CLI (via arcup)"; then
      # Check if arcup is already installed
      if command -v arcup &>/dev/null; then
        info "arcup found, running arcup install..."
        arcup install
      else
        info "Installing arcup + Arcium CLI..."
        # Determine the right method
        if [ "$OS" = "macos" ] || [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
          curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
        fi
      fi
      # Source any updated env
      # shellcheck disable=SC1091
      source "${HOME}/.cargo/env" 2>/dev/null || true
      if command -v arcium &>/dev/null; then
        ok "Arcium installed: $(arcium --version 2>&1 | head -1)"
      else
        info "Arcium installed. Restart your shell or add ~/.cargo/bin to PATH."
      fi
    else
      skip "Arcium CLI"
    fi
  fi

  # Also check arcup
  if command -v arcup &>/dev/null; then
    ok "arcup $(arcup version 2>&1 | head -1)"
  elif command -v arcium &>/dev/null; then
    info "arcup not found separately (arcium CLI is present)"
  fi
}

check_docker() {
  echo ""
  echo -e "${BOLD}Docker${NC}"
  if command -v docker &>/dev/null; then
    local ver
    ver=$(docker --version 2>&1)
    ok "$ver"

    # Check Docker daemon is actually running
    if docker info &>/dev/null 2>&1; then
      ok "Docker daemon is running"
    else
      info "Docker is installed but the daemon is not running."
      info "Start Docker Desktop (macOS/Windows) or 'sudo systemctl start docker' (Linux)."
    fi
  else
    miss "docker not found"
    MISSING=$((MISSING + 1))
    case "$OS" in
      macos)
        if command -v brew &>/dev/null; then
          if confirm "Docker Desktop (via Homebrew cask)"; then
            info "Installing Docker Desktop..."
            brew install --cask docker
            ok "Docker Desktop installed. Launch it from Applications to start the daemon."
          else
            skip "Docker"
          fi
        else
          info "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
          skip "Docker (no Homebrew found for automated install)"
        fi
        ;;
      linux|wsl)
        if confirm "Docker Engine"; then
          info "Installing Docker Engine..."
          case "$PKG_MANAGER" in
            apt)
              # Docker official install script
              curl -fsSL https://get.docker.com | sh
              sudo usermod -aG docker "$USER"
              info "Docker installed. You may need to log out and back in for group membership."
              ;;
            dnf)
              sudo dnf install -y dnf-plugins-core
              sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
              sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
              sudo systemctl start docker
              sudo usermod -aG docker "$USER"
              ;;
            pacman)
              sudo pacman -S --noconfirm docker docker-compose
              sudo systemctl start docker
              sudo usermod -aG docker "$USER"
              ;;
            *)
              info "Install Docker manually: https://docs.docker.com/engine/install/"
              skip "Docker (unsupported package manager)"
              ;;
          esac
        else
          skip "Docker"
        fi
        ;;
      windows)
        info "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
        skip "Docker (manual install required on Windows)"
        ;;
    esac
  fi

  # Check Docker Compose (v2 plugin)
  if command -v docker &>/dev/null; then
    if docker compose version &>/dev/null 2>&1; then
      ok "docker compose $(docker compose version --short 2>&1)"
    else
      miss "docker compose plugin not found"
      info "Install the Docker Compose plugin: https://docs.docker.com/compose/install/"
      MISSING=$((MISSING + 1))
    fi
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  detect_platform

  echo ""
  echo -e "${BOLD}Encrypted Forest - Dependency Setup${NC}"
  echo "======================================="
  echo -e "  Platform:     ${BLUE}${OS}${NC}"
  echo -e "  Architecture: ${BLUE}${ARCH}${NC}"
  if [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
    echo -e "  Distro:       ${BLUE}${DISTRO}${NC}"
    echo -e "  Pkg manager:  ${BLUE}${PKG_MANAGER}${NC}"
  fi

  if [ "$OS" = "windows" ]; then
    echo ""
    echo -e "${YELLOW}Warning: Arcium does not support Windows natively.${NC}"
    echo "Please use WSL2 with Ubuntu and re-run this script inside WSL."
    echo "  Install WSL2: wsl --install"
    echo ""
  fi

  if [ "$CHECK_ONLY" = true ]; then
    echo -e "  Mode:         ${YELLOW}check only${NC}"
  elif [ "$AUTO_YES" = true ]; then
    echo -e "  Mode:         ${YELLOW}auto-install${NC}"
  else
    echo -e "  Mode:         interactive"
  fi

  # Ensure build tools are present before anything else
  if [ "$CHECK_ONLY" = false ]; then
    ensure_build_essentials
  fi

  check_rust
  check_bun
  check_solana
  check_anchor
  check_surfpool
  check_arcium
  check_docker

  # ---------------------------------------------------------------------------
  # Summary
  # ---------------------------------------------------------------------------
  echo ""
  echo "======================================="
  if [ $MISSING -eq 0 ]; then
    echo -e "${GREEN}${BOLD}All dependencies are installed.${NC}"
    echo ""
    echo "Next steps:"
    echo "  bun install                # Install JS dependencies"
    echo "  make dev-docker            # Start Surfpool + ARX nodes"
    echo "  make build                 # Build program + circuits"
    echo "  anchor deploy --provider.cluster http://localhost:8899"
  else
    echo -e "${YELLOW}${BOLD}${MISSING} dependency/dependencies still missing.${NC}"
    if [ "$CHECK_ONLY" = true ]; then
      echo "Re-run without --check to install them."
    else
      echo "Re-run this script after installing the remaining tools."
      echo "You may need to restart your shell for PATH changes to take effect."
    fi
  fi
  echo ""
}

main
