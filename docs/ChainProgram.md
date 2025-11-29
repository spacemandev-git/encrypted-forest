# Chain Program Specification

> **For Subagents**: This spec is designed for modular implementation. Complete each task in order within its phase. Write tests after each task. Do not proceed to the next phase until all tasks in the current phase are complete and tested. When tests have passed, mark the task as completed.

## Overview

The on-chain programs handle game logic, encrypted state management, and MPC coordination via Arcium. The program uses PDAs (Program Derived Addresses) to store game and planet state.

## Prerequisites

- Arcium SDK installed (`arcium init` to scaffold project)
- Solana CLI and Anchor framework
- Understanding of Solana PDAs and account model

---

## Phase 1: Project Setup & Core Types

### Task 1.1: Initialize Arcium Project

**Estimated Context**: Small

```bash
cd programs/
arcium init encrypted-forest
```

**Deliverables**:

- Scaffolded Arcium project structure
- Basic `Cargo.toml` with dependencies
- `lib.rs` entry point

**Tests**: Verify project compiles with `anchor build`

---

### Task 1.2: Define Core Data Structures

**Estimated Context**: Small

Create `state.rs` with the following account structures:

```rust
// Game configuration account (one per game instance)
pub struct GameConfig {
    pub admin: Pubkey,
    pub map_diameter: u32,      // Map extends from -diameter/2 to +diameter/2
    pub start_time: i64,        // Unix timestamp
    pub end_time: i64,          // Unix timestamp
    pub game_seed: [u8; 32],    // Seed for noise function
    pub bump: u8,
}

// Planet account (created on discovery/attack)
pub struct Planet {
    pub game: Pubkey,           // Reference to game config
    pub coord_hash: [u8; 32],   // Hash of (x, y) - NOT the actual coords
    pub level: u8,              // Planet level (1-5)
    pub owner: Option<Pubkey>,  // None = neutral
    pub ships: u64,             // Current ship count
    pub last_update_slot: u64,  // For ship generation calculation
    pub encrypted_key: Vec<u8>, // Arcium encrypted planet key
    pub bump: u8,
}

// Player account (tracks player state)
pub struct Player {
    pub game: Pubkey,
    pub authority: Pubkey,
    pub planets_owned: u32,
    pub bump: u8,
}
```

**Deliverables**:

- `src/state.rs` with account structs
- Proper `#[account]` derive macros
- Space calculations for each account

**Tests**: Unit tests verifying struct sizes and serialization

---

### Task 1.3: Define Error Types

**Estimated Context**: Small

Create `errors.rs`:

```rust
#[error_code]
pub enum GameError {
    #[msg("Game has not started yet")]
    GameNotStarted,
    #[msg("Game has already ended")]
    GameEnded,
    #[msg("Invalid coordinates - outside map bounds")]
    InvalidCoordinates,
    #[msg("Planet already exists")]
    PlanetAlreadyExists,
    #[msg("Not enough ships to attack")]
    InsufficientShips,
    #[msg("Cannot attack own planet")]
    CannotAttackOwnPlanet,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid planet level for spawn")]
    InvalidSpawnLevel,
    #[msg("Player already spawned")]
    AlreadySpawned,
}
```

**Deliverables**:

- `src/errors.rs` with comprehensive error enum

**Tests**: N/A (tested via instruction tests)

---

### Task 1.4: Define Events

**Estimated Context**: Small

Create `events.rs`:

```rust
#[event]
pub struct GameCreated {
    pub game: Pubkey,
    pub admin: Pubkey,
    pub map_diameter: u32,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct PlanetCreated {
    pub game: Pubkey,
    pub planet: Pubkey,
    pub coord_hash: [u8; 32],
    pub level: u8,
}

#[event]
pub struct PlayerSpawned {
    pub game: Pubkey,
    pub player: Pubkey,
    pub planet: Pubkey,
}

#[event]
pub struct AttackLaunched {
    pub game: Pubkey,
    pub attacker: Pubkey,
    pub from_planet: Pubkey,
    pub to_planet: Pubkey,
    pub ships_sent: u64,
    pub encrypted_result: Vec<u8>, // Encrypted attack outcome
}

#[event]
pub struct PlanetCaptured {
    pub game: Pubkey,
    pub planet: Pubkey,
    pub new_owner: Pubkey,
    pub encrypted_state: Vec<u8>,
}
```

**Deliverables**:

- `src/events.rs` with all game events

**Tests**: N/A (tested via instruction tests)

---

## Phase 2: Core Game Instructions

### Task 2.1: Initialize Game Instruction

**Estimated Context**: Medium

Create `instructions/initialize_game.rs`:

**Functionality**:

- Admin creates a new game instance
- Sets map diameter, start/end times
- Generates game seed for deterministic noise

**Accounts**:

- `game_config` (PDA, init)
- `admin` (signer, payer)
- `system_program`

**Validation**:

- `start_time < end_time`
- `map_diameter > 0`

**Deliverables**:

- `initialize_game` instruction handler
- Account validation logic
- Emit `GameCreated` event

**Tests**:

- ✅ Successfully create game
- ❌ Fail with invalid time range
- ❌ Fail with zero diameter

---

### Task 2.2: Noise Function Implementation

**Estimated Context**: Medium

Create `utils/noise.rs`:

**Functionality**:

- Implement deterministic noise function
- Given `(x, y, game_seed)` → determines if planet exists and level
- Must be reproducible client-side in TypeScript/WASM

```rust
pub fn calculate_planet(x: i32, y: i32, seed: &[u8; 32]) -> Option<u8> {
    // Hash (x, y, seed)
    // Apply noise threshold
    // Return None for empty space, Some(level) for planet
}

pub fn hash_coordinates(x: i32, y: i32, seed: &[u8; 32]) -> [u8; 32] {
    // Deterministic hash for PDA derivation
}
```

**Deliverables**:

- `noise.rs` with `calculate_planet` and `hash_coordinates`
- Consistent results across calls

**Tests**:

- ✅ Same inputs produce same outputs
- ✅ Distribution of planets is reasonable (~20-30% of coords)
- ✅ Level distribution matches design (more low-level planets)

---

### Task 2.3: Create Planet Instruction

**Estimated Context**: Medium

Create `instructions/create_planet.rs`:

**Functionality**:

- Creates a planet account when discovered
- Coordinates passed encrypted to Arcium MPC
- MPC verifies coords match the coord_hash
- Generates and stores encrypted planet key

**Accounts**:

- `game_config` (readonly)
- `planet` (PDA, init) - derived from coord_hash
- `creator` (signer, payer)
- `arcium_*` (Arcium MPC accounts)
- `system_program`

**Arcium Integration**:

- Encrypted input: `(x, y)`
- MPC computation: verify hash, generate planet key
- Encrypted output: planet key stored in account

**Deliverables**:

- `create_planet` instruction handler
- Arcium MPC integration for coordinate verification
- Planet key generation

**Tests**:

- ✅ Create planet at valid coordinates
- ❌ Fail for coordinates outside map bounds
- ❌ Fail if planet already exists
- ✅ Verify coord_hash matches PDA seed

---

### Task 2.4: Player Spawn Instruction

**Estimated Context**: Medium

Create `instructions/spawn_player.rs`:

**Functionality**:

- Player spawns into the game on a specific planet
- Planet must be level 1 (spawn-eligible)
- Planet must be neutral (no owner)
- Creates player account, assigns planet ownership

**Accounts**:

- `game_config` (readonly)
- `planet` (mut) - must exist
- `player` (PDA, init)
- `authority` (signer, payer)
- `system_program`

**Validation**:

- Game must be active (between start/end times)
- Planet level == 1
- Planet has no owner
- Player hasn't already spawned

**Deliverables**:

- `spawn_player` instruction handler
- Player account creation
- Planet ownership transfer
- Emit `PlayerSpawned` event

**Tests**:

- ✅ Successfully spawn on level 1 neutral planet
- ❌ Fail if player already spawned
- ❌ Fail if planet owned
- ❌ Fail if planet level != 1
- ❌ Fail if game not active

---

## Phase 3: Combat & Ship Mechanics

### Task 3.1: Ship Generation Logic

**Estimated Context**: Small

Create `utils/ships.rs`:

**Functionality**:

- Calculate ships generated since last update
- Based on planet level and time elapsed
- Cap at maximum per planet level

```rust
pub fn calculate_ship_generation(
    planet_level: u8,
    last_update_slot: u64,
    current_slot: u64,
) -> u64 {
    // Ships per slot based on level
    // Apply cap based on level
}

pub fn get_ship_cap(planet_level: u8) -> u64 {
    // Level 1: 50, Level 2: 100, etc.
}

pub fn get_neutral_ships(planet_level: u8) -> u64 {
    // Static ship count for neutral planets
}
```

**Deliverables**:

- Ship generation calculation
- Ship caps per level
- Neutral planet ship counts

**Tests**:

- ✅ Correct generation rates per level
- ✅ Caps are enforced
- ✅ Neutral ships match level

---

### Task 3.2: Attack Instruction

**Estimated Context**: Large

Create `instructions/attack.rs`:

**Functionality**:

- Player sends ships from owned planet to target
- Arcium MPC computes battle outcome (encrypted)
- Updates both planets' ship counts
- Handles ownership transfer if defender ships reach 0

**Accounts**:

- `game_config` (readonly)
- `attacker_player` (readonly)
- `from_planet` (mut)
- `to_planet` (mut)
- `authority` (signer)
- `arcium_*` (Arcium MPC accounts)

**Combat Logic** (in MPC):

```
attacker_ships = ships_sent
defender_ships = to_planet.ships + generated_since_last_update

if attacker_ships > defender_ships:
    to_planet.owner = attacker
    to_planet.ships = attacker_ships - defender_ships
else:
    to_planet.ships = defender_ships - attacker_ships
```

**Deliverables**:

- `attack` instruction handler
- Arcium MPC combat resolution
- Ship count updates
- Ownership transfer logic
- Emit `AttackLaunched` and optionally `PlanetCaptured`

**Tests**:

- ✅ Attacker wins and captures planet
- ✅ Defender wins and keeps planet
- ✅ Draw (both reach 0, defender keeps)
- ❌ Fail if not enough ships
- ❌ Fail if attacking own planet
- ❌ Fail if game not active

---

### Task 3.3: Get Planet Key Instruction

**Estimated Context**: Medium

Create `instructions/get_planet_key.rs`:

**Functionality**:

- Player requests planet key sealed to their public key
- Requires player to prove knowledge of coordinates
- Arcium MPC re-encrypts planet key for requesting player

**Accounts**:

- `planet` (readonly)
- `requester` (signer)
- `arcium_*` (Arcium MPC accounts)

**Arcium Integration**:

- Input: player's encryption pubkey, encrypted (x, y)
- MPC verifies coords match planet's coord_hash
- Output: planet key re-encrypted for player

**Deliverables**:

- `get_planet_key` instruction handler
- Arcium MPC key re-encryption

**Tests**:

- ✅ Successfully get key with correct coordinates
- ❌ Fail with incorrect coordinates

---

## Phase 4: Final Integration & E2E Tests

### Task 4.1: Module Organization

**Estimated Context**: Small

Organize `lib.rs`:

```rust
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

declare_id!("...");

#[program]
pub mod encrypted_forest {
    use super::*;

    pub fn initialize_game(...) -> Result<()> { ... }
    pub fn create_planet(...) -> Result<()> { ... }
    pub fn spawn_player(...) -> Result<()> { ... }
    pub fn attack(...) -> Result<()> { ... }
    pub fn get_planet_key(...) -> Result<()> { ... }
}
```

**Deliverables**:

- Clean module structure
- All instructions exported
- IDL generates correctly

**Tests**: `anchor build` succeeds, IDL is valid

---

### Task 4.2: Integration Tests

**Estimated Context**: Large

Create `tests/integration.rs`:

**Test Scenarios**:

1. Full game lifecycle

   - Admin creates game
   - Player A spawns
   - Player A discovers planets
   - Player A attacks neutral planet
   - Player B spawns
   - Player A attacks Player B's planet

2. Edge cases
   - Game time boundaries
   - Concurrent attacks
   - Max ship caps

**Deliverables**:

- Comprehensive integration test suite
- Test utilities for common operations

---

### Task 4.3: Deploy Scripts

**Estimated Context**: Small

Create deployment configuration:

```
Anchor.toml configuration
Devnet deployment script
Mainnet deployment checklist
```

**Deliverables**:

- `Anchor.toml` with network configs
- `scripts/deploy-devnet.sh`
- `DEPLOYMENT.md` checklist

---

## Testing Strategy Summary

| Task              | Unit Tests       | Integration Tests   |
| ----------------- | ---------------- | ------------------- |
| 1.2 State         | ✅ Serialization | -                   |
| 2.1 Init Game     | ✅ Validation    | ✅ Create game      |
| 2.2 Noise         | ✅ Determinism   | -                   |
| 2.3 Create Planet | ✅ Validation    | ✅ Discovery flow   |
| 2.4 Spawn         | ✅ Validation    | ✅ Spawn flow       |
| 3.1 Ships         | ✅ Calculations  | -                   |
| 3.2 Attack        | ✅ Combat logic  | ✅ Battle scenarios |
| 3.3 Get Key       | ✅ Validation    | ✅ Decrypt flow     |
| 4.2 Integration   | -                | ✅ Full lifecycle   |

---

## Dependencies Between Components

```
ChainProgram → Indexer: Events emitted are indexed
ChainProgram → Client: IDL used for transactions, noise function shared
```

## Notes for Subagent

1. **Start with Phase 1** completely before moving on
2. **Run tests after each task** before proceeding
3. **Arcium integration** requires their SDK - check their docs for exact patterns
4. **Noise function must be portable** - implement in Rust but design for TS port
5. **Events are critical** for indexer - ensure all state changes emit events
