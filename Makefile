# Makefile - Encrypted Forest development commands
#
# Usage:
#   make dev          Start Surfpool for local development
#   make dev-docker   Start Surfpool + ARX nodes via Docker Compose
#   make stop         Stop all dev services
#   make build        Build the Arcium MXE program
#   make deploy       Build and deploy to local Surfpool
#   make test         Run arcium test (starts its own local cluster)
#   make clean        Remove build artifacts, databases, Docker volumes
#   make install      Install Bun dependencies

.PHONY: dev dev-watch dev-docker stop build deploy test test-local clean install

# ---------------------------------------------------------------------------
# Development environment
# ---------------------------------------------------------------------------

dev:
	@./scripts/dev-start.sh

dev-watch:
	@./scripts/dev-start.sh --watch

dev-docker:
	@./scripts/dev-start.sh --docker

stop:
	@./scripts/dev-stop.sh

# ---------------------------------------------------------------------------
# Build and deploy
# ---------------------------------------------------------------------------

build:
	arcium build

deploy:
	@./scripts/deploy-local.sh

# ---------------------------------------------------------------------------
# Testing
# ---------------------------------------------------------------------------

# arcium test starts its own local validator + ARX nodes (default behavior)
test:
	arcium test

# Run tests against an already-running Surfpool instance
test-local:
	arcium test --cluster devnet

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

install:
	bun install

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean:
	@echo "Cleaning build artifacts..."
	-rm -rf target/
	-rm -rf .anchor/
	-rm -rf node_modules/
	-rm -f dev.sqlite dev.sqlite-wal dev.sqlite-shm
	-rm -f test.sqlite test.sqlite-wal test.sqlite-shm
	-rm -rf logs/
	-rm -rf .pids/
	@echo "Cleaning Docker volumes..."
	-docker compose down -v 2>/dev/null || true
	@echo "Clean complete."
