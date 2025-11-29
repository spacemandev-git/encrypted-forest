# Encrypted Forest

A hidden-information strategy game on Solana using [Arcium](https://arcium.com/) MPC for trustless fog of war.

## Overview

Players explore a procedurally generated map, spawn into planets, build up ships, and compete to control the most territory. The twist: planet locations are hidden until discovered, and all sensitive game state is encrypted on-chain.

## Gameplay

### The Goal

Control the most planets when the game timer ends.

### Core Loop

1. **Explore** — Hash coordinates locally to discover planets hidden in the fog of war
2. **Spawn** — Find a valid spawn location and claim your starting planet
3. **Build** — Your planets continuously generate ships (up to a cap)
4. **Expand** — Send ships to attack neutral or enemy planets
5. **Conquer** — Reduce a planet's ships to zero to claim it

### Planet Types

| Type             | Ships   | Behavior                               |
| ---------------- | ------- | -------------------------------------- |
| **Neutral**      | Static  | Fixed ship count based on planet level |
| **Player-owned** | Dynamic | Continuously generates ships over time |

### Map Generation

The map uses a deterministic noise function—given any `(x, y)` coordinate, the game can determine if it's empty space or a planet (and what level). This means planets don't need to be pre-generated; they're discovered and created on-demand.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PLAYER CLIENT                           │
│                      (Svelte 5 + Three.js)                      │
│  • Coordinate hashing & planet discovery                        │
│  • Local fog of war rendering                                   │
│  • Transaction signing & submission                             │
│  • Event decryption & state management (IndexedDB)              │
└──────────────────┬─────────────────────────┬────────────────────┘
                   │ WebSocket               │ RPC
                   ▼                         ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│       BACKEND INDEXER        │  │     SOLANA + ARCIUM          │
│           (Bun)              │  │        PROGRAMS              │
│  • Chain event listener      │  │  • Game state (encrypted)    │
│  • Event storage & DB        │  │  • Planet accounts (PDAs)    │
│  • Client sync (catch-up)    │  │  • MPC key management        │
│  • Filtered event streaming  │  │  • Attack resolution         │
└──────────────────────────────┘  └──────────────────────────────┘
```

### Components

| Component    | Tech               | Role                                                       |
| ------------ | ------------------ | ---------------------------------------------------------- |
| **Programs** | Solana + Arcium    | On-chain game logic, encrypted state, MPC coordination     |
| **Client**   | Svelte 5, Three.js | Game UI, local computation, wallet integration             |
| **Indexer**  | Bun                | Event indexing, client synchronization, filtered streaming |

### Fog of War Flow

```
Player hashes (x,y) locally
         │
         ▼
   Noise function
   determines planet?
         │
    ┌────┴────┐
    │ Yes     │ No → Empty space
    ▼
Derive PDA seed
         │
         ▼
  Account exists?
    ┌────┴────┐
    │ Yes     │ No → Can create on attack/discovery
    ▼
Request planet key
(sealed to player)
         │
         ▼
Decrypt events locally
```

## Project Structure

```
encrypted-forest/
├── programs/       # Solana + Arcium on-chain programs
├── client/         # Svelte 5 + Three.js game client
└── indexer/        # Bun-based chain indexer & event server
```

## Status

🚧 **In Development** — This is a design document for a project being built.
