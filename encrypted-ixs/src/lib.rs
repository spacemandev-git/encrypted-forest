use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // =========================================================================
    // Shared structs
    // =========================================================================

    /// Full planet state stored encrypted on-chain.
    /// 19 fields => SharedEncryptedStruct<19>.
    pub struct PlanetState {
        pub body_type: u8,       // 0=Planet, 1=Quasar, 2=SpacetimeRip, 3=AsteroidBelt
        pub size: u8,            // 1-6
        pub owner_exists: u8,    // 0 or 1
        pub owner_0: u64,        // Pubkey split into 4 x u64
        pub owner_1: u64,
        pub owner_2: u64,
        pub owner_3: u64,
        pub ship_count: u64,
        pub max_ship_capacity: u64,
        pub ship_gen_speed: u64,
        pub metal_count: u64,
        pub max_metal_capacity: u64,
        pub metal_gen_speed: u64,
        pub range: u64,
        pub launch_velocity: u64,
        pub level: u8,
        pub comet_count: u8,
        pub comet_0: u8,         // CometBoost enum as u8 (0-5), 255 = none
        pub comet_1: u8,         // CometBoost enum as u8 (0-5), 255 = none
    }

    // =========================================================================
    // Input structs
    // =========================================================================

    pub struct InitPlanetInput {
        pub x: u64,  // i64 cast to u64 for MPC
        pub y: u64,
        pub game_id: u64,
        pub dead_space_threshold: u8,
        pub planet_threshold: u8,
        pub quasar_threshold: u8,
        pub spacetime_rip_threshold: u8,
        pub size_threshold_1: u8,
        pub size_threshold_2: u8,
        pub size_threshold_3: u8,
        pub size_threshold_4: u8,
        pub size_threshold_5: u8,
    }

    pub struct InitSpawnPlanetInput {
        pub x: u64,
        pub y: u64,
        pub game_id: u64,
        pub dead_space_threshold: u8,
        pub planet_threshold: u8,
        pub quasar_threshold: u8,
        pub spacetime_rip_threshold: u8,
        pub size_threshold_1: u8,
        pub size_threshold_2: u8,
        pub size_threshold_3: u8,
        pub size_threshold_4: u8,
        pub size_threshold_5: u8,
        pub player_key_0: u64,
        pub player_key_1: u64,
        pub player_key_2: u64,
        pub player_key_3: u64,
    }

    pub struct ProcessMoveInput {
        pub player_key_0: u64,
        pub player_key_1: u64,
        pub player_key_2: u64,
        pub player_key_3: u64,
        pub ships_to_send: u64,
        pub metal_to_send: u64,
        pub source_x: u64,
        pub source_y: u64,
        pub target_x: u64,
        pub target_y: u64,
        pub current_slot: u64,
        pub game_speed: u64,
        pub last_updated_slot: u64,
    }

    pub struct FlushPlanetInput {
        pub current_slot: u64,
        pub game_speed: u64,
        pub last_updated_slot: u64,
        // Move data (up to 1 move per flush call for simplicity)
        pub move_ships: u64,
        pub move_metal: u64,
        pub move_attacker_0: u64,
        pub move_attacker_1: u64,
        pub move_attacker_2: u64,
        pub move_attacker_3: u64,
        pub move_has_landed: u8,  // 1 if landing_slot <= current_slot
    }

    pub struct UpgradePlanetInput {
        pub player_key_0: u64,
        pub player_key_1: u64,
        pub player_key_2: u64,
        pub player_key_3: u64,
        pub focus: u8,           // 0=Range, 1=LaunchVelocity
        pub current_slot: u64,
        pub game_speed: u64,
        pub last_updated_slot: u64,
    }

    // =========================================================================
    // Revealed output structs
    // =========================================================================

    pub struct InitPlanetRevealed {
        pub hash_0: u64,
        pub hash_1: u64,
        pub hash_2: u64,
        pub hash_3: u64,
        pub valid: u8,
    }

    pub struct SpawnPlanetRevealed {
        pub hash_0: u64,
        pub hash_1: u64,
        pub hash_2: u64,
        pub hash_3: u64,
        pub valid: u8,
        pub is_spawn_valid: u8,
    }

    pub struct MoveRevealed {
        pub landing_slot: u64,
        pub surviving_ships: u64,
        pub valid: u8,
    }

    pub struct FlushRevealed {
        pub success: u8,
    }

    pub struct UpgradeRevealed {
        pub success: u8,
        pub new_level: u8,
    }

    // PendingMoveData: encrypted data about a move in transit
    pub struct PendingMoveData {
        pub ships_arriving: u64,
        pub metal_arriving: u64,
        pub attacker_0: u64,
        pub attacker_1: u64,
        pub attacker_2: u64,
        pub attacker_3: u64,
    }

    // =========================================================================
    // Helper functions (MPC-compatible: only add/sub/mul/div/mod, if/else)
    // NO return statements allowed in Arcis.
    // =========================================================================

    /// Deterministic hash mixing using only add/mul.
    /// Returns (h0, h1, h2, h3) as four u64 values.
    fn mix_hash(x: u64, y: u64, game_id: u64) -> (u64, u64, u64, u64) {
        let a = x * 31 + y * 37 + game_id * 41 + 7;
        let b = y * 43 + game_id * 47 + x * 53 + 13;
        let c = game_id * 59 + x * 61 + y * 67 + 17;
        let d = a * 3 + b * 5 + c * 7 + 19;
        (a, b, c, d)
    }

    /// Extract byte from u64: byte_index 0 = lowest byte
    fn extract_byte(h: u64, index: u8) -> u8 {
        let divisor: u64 = if index == 0 {
            1
        } else if index == 1 {
            256
        } else if index == 2 {
            65536
        } else if index == 3 {
            16777216
        } else if index == 4 {
            4294967296
        } else {
            1099511627776
        };
        ((h / divisor) % 256) as u8
    }

    /// Determine body type from hash byte.
    fn determine_body_type(
        byte1: u8,
        planet_threshold: u8,
        quasar_threshold: u8,
        spacetime_rip_threshold: u8,
    ) -> u8 {
        if byte1 < planet_threshold {
            0
        } else if byte1 < quasar_threshold {
            1
        } else if byte1 < spacetime_rip_threshold {
            2
        } else {
            3
        }
    }

    /// Determine size (1-6) from hash byte and thresholds.
    fn determine_size(
        byte2: u8,
        t1: u8, t2: u8, t3: u8, t4: u8, t5: u8,
    ) -> u8 {
        if byte2 < t1 {
            1
        } else if byte2 < t2 {
            2
        } else if byte2 < t3 {
            3
        } else if byte2 < t4 {
            4
        } else if byte2 < t5 {
            5
        } else {
            6
        }
    }

    /// Determine comets from hash byte3.
    fn determine_comet_count(byte3: u8) -> u8 {
        if byte3 <= 216 {
            0
        } else if byte3 <= 242 {
            1
        } else {
            2
        }
    }

    fn comet_from_byte(b: u8) -> u8 {
        (b % 6) as u8
    }

    fn comet_from_byte_avoiding(b: u8, first: u8) -> u8 {
        let c = (b % 6) as u8;
        if c == first {
            ((b + 1) % 6) as u8
        } else {
            c
        }
    }

    /// Compute base stats for a celestial body.
    /// Returns (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity, native_ships)
    fn base_stats(body_type: u8, size: u8) -> (u64, u64, u64, u64, u64, u64, u64) {
        let s = size as u64;
        let s_sq = s * s;

        if body_type == 0 {
            let native = if size == 1 { 0u64 } else { 10 * s };
            (100 * s_sq, 1 * s, 0, 0, 3 + s, 1 + s, native)
        } else if body_type == 1 {
            (500 * s_sq, 0, 500 * s_sq, 0, 2 + s, 1 + s, 20 * s)
        } else if body_type == 2 {
            (50 * s_sq, 1 * s, 0, 0, 2 + s, 1 + s, 15 * s)
        } else {
            (80 * s_sq, 0, 200 * s_sq, 2 * s, 2 + s, 1 + s, 10 * s)
        }
    }

    /// Apply comet boosts to stats. No early return - use if/else for active check.
    fn apply_one_comet(
        comet_val: u8,
        active: u8,
        ship_cap: u64,
        ship_gen: u64,
        metal_cap: u64,
        metal_gen: u64,
        range: u64,
        velocity: u64,
    ) -> (u64, u64, u64, u64, u64, u64) {
        if active == 0 {
            (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity)
        } else {
            let new_ship_cap = if comet_val == 0 { ship_cap * 2 } else { ship_cap };
            let new_metal_cap = if comet_val == 1 { metal_cap * 2 } else { metal_cap };
            let new_ship_gen = if comet_val == 2 { ship_gen * 2 } else { ship_gen };
            let new_metal_gen = if comet_val == 3 { metal_gen * 2 } else { metal_gen };
            let new_range = if comet_val == 4 { range * 2 } else { range };
            let new_velocity = if comet_val == 5 { velocity * 2 } else { velocity };
            (new_ship_cap, new_ship_gen, new_metal_cap, new_metal_gen, new_range, new_velocity)
        }
    }

    /// Compute current resource count via lazy generation. No early return.
    fn compute_current_resource(
        last_count: u64,
        max_capacity: u64,
        gen_speed: u64,
        last_updated_slot: u64,
        current_slot: u64,
        game_speed: u64,
    ) -> u64 {
        if gen_speed == 0 {
            last_count
        } else if game_speed == 0 {
            last_count
        } else if current_slot <= last_updated_slot {
            last_count
        } else {
            let elapsed = current_slot - last_updated_slot;
            let generated = gen_speed * elapsed / game_speed;
            let total = last_count + generated;
            if total > max_capacity {
                max_capacity
            } else {
                total
            }
        }
    }

    fn compute_abs_diff(a: u64, b: u64) -> u64 {
        if a > b { a - b } else { b - a }
    }

    fn compute_distance(sx: u64, sy: u64, tx: u64, ty: u64) -> u64 {
        let dx = compute_abs_diff(sx, tx);
        let dy = compute_abs_diff(sy, ty);
        let max_d = if dx > dy { dx } else { dy };
        let min_d = if dx > dy { dy } else { dx };
        max_d + min_d / 2
    }

    /// Apply distance decay. No early return.
    fn apply_distance_decay(ships: u64, distance: u64, range: u64) -> u64 {
        if range == 0 {
            0
        } else {
            let lost = distance / range;
            if ships > lost {
                ships - lost
            } else {
                0
            }
        }
    }

    /// Compute landing slot. No early return.
    fn compute_landing_slot(current_slot: u64, distance: u64, velocity: u64, game_speed: u64) -> u64 {
        if velocity == 0 {
            current_slot + 999999999
        } else {
            let travel_time = distance * game_speed / velocity;
            current_slot + travel_time
        }
    }

    /// Upgrade cost: 100 * 2^level
    fn upgrade_cost(level: u8) -> u64 {
        let base: u64 = 100;
        let mult: u64 = if level == 1 {
            2
        } else if level == 2 {
            4
        } else if level == 3 {
            8
        } else if level == 4 {
            16
        } else if level == 5 {
            32
        } else if level == 6 {
            64
        } else if level == 7 {
            128
        } else if level == 8 {
            256
        } else if level == 9 {
            512
        } else {
            1024
        };
        base * mult
    }

    /// Build a PlanetState from noise-derived properties.
    fn build_planet_state(
        body_type: u8,
        size: u8,
        comet_count: u8,
        comet_0: u8,
        comet_1: u8,
        owner_exists: u8,
        owner_0: u64,
        owner_1: u64,
        owner_2: u64,
        owner_3: u64,
    ) -> PlanetState {
        let (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity, native_ships) =
            base_stats(body_type, size);

        let c0_active: u8 = if comet_count >= 1 { 1 } else { 0 };
        let (sc1, sg1, mc1, mg1, r1, v1) =
            apply_one_comet(comet_0, c0_active, ship_cap, ship_gen, metal_cap, metal_gen, range, velocity);

        let c1_active: u8 = if comet_count >= 2 { 1 } else { 0 };
        let (sc2, sg2, mc2, mg2, r2, v2) =
            apply_one_comet(comet_1, c1_active, sc1, sg1, mc1, mg1, r1, v1);

        let ship_count = if owner_exists == 1 { 0u64 } else { native_ships };

        PlanetState {
            body_type,
            size,
            owner_exists,
            owner_0,
            owner_1,
            owner_2,
            owner_3,
            ship_count,
            max_ship_capacity: sc2,
            ship_gen_speed: sg2,
            metal_count: 0,
            max_metal_capacity: mc2,
            metal_gen_speed: mg2,
            range: r2,
            launch_velocity: v2,
            level: 1,
            comet_count,
            comet_0,
            comet_1,
        }
    }

    // =========================================================================
    // Encrypted Instructions (Circuits)
    // =========================================================================

    /// 1. init_planet: Create a new planet from encrypted coordinates.
    /// Uses extra `observer` Shared param so we can call from_arcis twice.
    #[instruction]
    pub fn init_planet(
        input: Enc<Shared, InitPlanetInput>,
        observer: Shared,
    ) -> (Enc<Shared, PlanetState>, Enc<Shared, InitPlanetRevealed>) {
        let inp = input.to_arcis();

        let (h0, h1, h2, h3) = mix_hash(inp.x, inp.y, inp.game_id);

        let byte0 = extract_byte(h0, 0);
        let byte1 = extract_byte(h0, 1);
        let byte2 = extract_byte(h0, 2);
        let byte3 = extract_byte(h0, 3);
        let byte4 = extract_byte(h0, 4);
        let byte5 = extract_byte(h0, 5);

        let is_body: u8 = if byte0 >= inp.dead_space_threshold { 1 } else { 0 };

        let body_type = determine_body_type(
            byte1, inp.planet_threshold, inp.quasar_threshold, inp.spacetime_rip_threshold,
        );

        let size = determine_size(
            byte2, inp.size_threshold_1, inp.size_threshold_2,
            inp.size_threshold_3, inp.size_threshold_4, inp.size_threshold_5,
        );

        let comet_count = determine_comet_count(byte3);
        let comet_0 = comet_from_byte(byte4);
        let comet_1_raw = comet_from_byte_avoiding(byte5, comet_0);
        let comet_1 = if comet_count >= 2 { comet_1_raw } else { 255u8 };
        let comet_0_final = if comet_count >= 1 { comet_0 } else { 255u8 };

        let state = build_planet_state(
            body_type, size, comet_count, comet_0_final, comet_1,
            0, 0, 0, 0, 0,
        );

        let revealed = InitPlanetRevealed {
            hash_0: h0,
            hash_1: h1,
            hash_2: h2,
            hash_3: h3,
            valid: is_body,
        };

        (
            input.owner.from_arcis(state),
            observer.from_arcis(revealed),
        )
    }

    /// 2. init_spawn_planet: Create planet + validate spawn + set owner.
    /// Uses extra `observer` Shared param for the second from_arcis call.
    #[instruction]
    pub fn init_spawn_planet(
        input: Enc<Shared, InitSpawnPlanetInput>,
        observer: Shared,
    ) -> (Enc<Shared, PlanetState>, Enc<Shared, SpawnPlanetRevealed>) {
        let inp = input.to_arcis();

        let (h0, h1, h2, h3) = mix_hash(inp.x, inp.y, inp.game_id);

        let byte0 = extract_byte(h0, 0);
        let byte1 = extract_byte(h0, 1);
        let byte2 = extract_byte(h0, 2);
        let byte3 = extract_byte(h0, 3);
        let byte4 = extract_byte(h0, 4);
        let byte5 = extract_byte(h0, 5);

        let is_body: u8 = if byte0 >= inp.dead_space_threshold { 1 } else { 0 };

        let body_type = determine_body_type(
            byte1, inp.planet_threshold, inp.quasar_threshold, inp.spacetime_rip_threshold,
        );

        let size = determine_size(
            byte2, inp.size_threshold_1, inp.size_threshold_2,
            inp.size_threshold_3, inp.size_threshold_4, inp.size_threshold_5,
        );

        let comet_count = determine_comet_count(byte3);
        let comet_0 = comet_from_byte(byte4);
        let comet_1_raw = comet_from_byte_avoiding(byte5, comet_0);
        let comet_1 = if comet_count >= 2 { comet_1_raw } else { 255u8 };
        let comet_0_final = if comet_count >= 1 { comet_0 } else { 255u8 };

        let is_planet: u8 = if body_type == 0 { 1 } else { 0 };
        let is_miniscule: u8 = if size == 1 { 1 } else { 0 };
        let is_spawn_valid = is_body * is_planet * is_miniscule;

        let owner_exists = is_spawn_valid;
        let o0 = if is_spawn_valid == 1 { inp.player_key_0 } else { 0u64 };
        let o1 = if is_spawn_valid == 1 { inp.player_key_1 } else { 0u64 };
        let o2 = if is_spawn_valid == 1 { inp.player_key_2 } else { 0u64 };
        let o3 = if is_spawn_valid == 1 { inp.player_key_3 } else { 0u64 };

        let state = build_planet_state(
            body_type, size, comet_count, comet_0_final, comet_1,
            owner_exists, o0, o1, o2, o3,
        );

        let revealed = SpawnPlanetRevealed {
            hash_0: h0,
            hash_1: h1,
            hash_2: h2,
            hash_3: h3,
            valid: is_body,
            is_spawn_valid,
        };

        (
            input.owner.from_arcis(state),
            observer.from_arcis(revealed),
        )
    }

    /// 3. process_move: Validate and process a ship movement from source planet.
    /// Uses state_input.owner for PlanetState, move_input.owner for PendingMoveData,
    /// and extra observer for MoveRevealed.
    #[instruction]
    pub fn process_move(
        state_input: Enc<Shared, PlanetState>,
        move_input: Enc<Shared, ProcessMoveInput>,
        observer: Shared,
    ) -> (Enc<Shared, PlanetState>, Enc<Shared, PendingMoveData>, Enc<Shared, MoveRevealed>) {
        let state = state_input.to_arcis();
        let mv = move_input.to_arcis();

        let owner_match: u8 = if state.owner_exists == 1
            && state.owner_0 == mv.player_key_0
            && state.owner_1 == mv.player_key_1
            && state.owner_2 == mv.player_key_2
            && state.owner_3 == mv.player_key_3
        {
            1
        } else {
            0
        };

        let current_ships = compute_current_resource(
            state.ship_count,
            state.max_ship_capacity,
            state.ship_gen_speed,
            mv.last_updated_slot,
            mv.current_slot,
            mv.game_speed,
        );
        let current_metal = compute_current_resource(
            state.metal_count,
            state.max_metal_capacity,
            state.metal_gen_speed,
            mv.last_updated_slot,
            mv.current_slot,
            mv.game_speed,
        );

        let has_ships: u8 = if current_ships >= mv.ships_to_send && mv.ships_to_send > 0 { 1 } else { 0 };
        let has_metal: u8 = if current_metal >= mv.metal_to_send { 1 } else { 0 };

        let distance = compute_distance(mv.source_x, mv.source_y, mv.target_x, mv.target_y);
        let surviving = apply_distance_decay(mv.ships_to_send, distance, state.range);
        let ships_survive: u8 = if surviving > 0 { 1 } else { 0 };

        let valid = owner_match * has_ships * has_metal * ships_survive;

        let landing_slot = compute_landing_slot(
            mv.current_slot, distance, state.launch_velocity, mv.game_speed,
        );

        let new_ships = if valid == 1 { current_ships - mv.ships_to_send } else { current_ships };
        let new_metal = if valid == 1 { current_metal - mv.metal_to_send } else { current_metal };

        let updated_source = PlanetState {
            body_type: state.body_type,
            size: state.size,
            owner_exists: state.owner_exists,
            owner_0: state.owner_0,
            owner_1: state.owner_1,
            owner_2: state.owner_2,
            owner_3: state.owner_3,
            ship_count: new_ships,
            max_ship_capacity: state.max_ship_capacity,
            ship_gen_speed: state.ship_gen_speed,
            metal_count: new_metal,
            max_metal_capacity: state.max_metal_capacity,
            metal_gen_speed: state.metal_gen_speed,
            range: state.range,
            launch_velocity: state.launch_velocity,
            level: state.level,
            comet_count: state.comet_count,
            comet_0: state.comet_0,
            comet_1: state.comet_1,
        };

        let move_data = PendingMoveData {
            ships_arriving: if valid == 1 { surviving } else { 0 },
            metal_arriving: if valid == 1 { mv.metal_to_send } else { 0 },
            attacker_0: mv.player_key_0,
            attacker_1: mv.player_key_1,
            attacker_2: mv.player_key_2,
            attacker_3: mv.player_key_3,
        };

        let revealed = MoveRevealed {
            landing_slot: if valid == 1 { landing_slot } else { 0 },
            surviving_ships: if valid == 1 { surviving } else { 0 },
            valid,
        };

        (
            state_input.owner.from_arcis(updated_source),
            move_input.owner.from_arcis(move_data),
            observer.from_arcis(revealed),
        )
    }

    /// 4. flush_planet: Process a single landed move against planet state.
    /// Uses state_input.owner for PlanetState, flush_input.owner for FlushRevealed.
    #[instruction]
    pub fn flush_planet(
        state_input: Enc<Shared, PlanetState>,
        flush_input: Enc<Shared, FlushPlanetInput>,
    ) -> (Enc<Shared, PlanetState>, Enc<Shared, FlushRevealed>) {
        let state = state_input.to_arcis();
        let fi = flush_input.to_arcis();

        let gen_ships = if state.owner_exists == 1 {
            compute_current_resource(
                state.ship_count,
                state.max_ship_capacity,
                state.ship_gen_speed,
                fi.last_updated_slot,
                fi.current_slot,
                fi.game_speed,
            )
        } else {
            state.ship_count
        };
        let gen_metal = if state.owner_exists == 1 {
            compute_current_resource(
                state.metal_count,
                state.max_metal_capacity,
                state.metal_gen_speed,
                fi.last_updated_slot,
                fi.current_slot,
                fi.game_speed,
            )
        } else {
            state.metal_count
        };

        // Determine combat outcome. If no move landed, just keep generated values.
        // If move landed, check friendly vs hostile.
        let is_friendly: u8 = if fi.move_has_landed == 1
            && state.owner_exists == 1
            && state.owner_0 == fi.move_attacker_0
            && state.owner_1 == fi.move_attacker_1
            && state.owner_2 == fi.move_attacker_2
            && state.owner_3 == fi.move_attacker_3
        {
            1
        } else {
            0
        };

        // Compute final state based on move_has_landed and combat outcome
        let (new_ships, new_metal, new_owner_exists, new_o0, new_o1, new_o2, new_o3) =
            if fi.move_has_landed == 0 {
                // No move to process, just update generation
                (gen_ships, gen_metal, state.owner_exists, state.owner_0, state.owner_1, state.owner_2, state.owner_3)
            } else if is_friendly == 1 {
                // Reinforcement: add ships and metal (capped)
                let added_ships = gen_ships + fi.move_ships;
                let capped_ships = if added_ships > state.max_ship_capacity {
                    state.max_ship_capacity
                } else {
                    added_ships
                };
                let added_metal = gen_metal + fi.move_metal;
                let capped_metal = if added_metal > state.max_metal_capacity {
                    state.max_metal_capacity
                } else {
                    added_metal
                };
                (capped_ships, capped_metal, state.owner_exists, state.owner_0, state.owner_1, state.owner_2, state.owner_3)
            } else if fi.move_ships > gen_ships {
                // Attacker wins
                let remaining = fi.move_ships - gen_ships;
                let capped = if remaining > state.max_ship_capacity {
                    state.max_ship_capacity
                } else {
                    remaining
                };
                let metal_capped = if fi.move_metal > state.max_metal_capacity {
                    state.max_metal_capacity
                } else {
                    fi.move_metal
                };
                (capped, metal_capped, 1u8, fi.move_attacker_0, fi.move_attacker_1, fi.move_attacker_2, fi.move_attacker_3)
            } else {
                // Defender wins (or tie = defender wins)
                let def_remaining = gen_ships - fi.move_ships;
                (def_remaining, gen_metal, state.owner_exists, state.owner_0, state.owner_1, state.owner_2, state.owner_3)
            };

        let updated = PlanetState {
            body_type: state.body_type,
            size: state.size,
            owner_exists: new_owner_exists,
            owner_0: new_o0,
            owner_1: new_o1,
            owner_2: new_o2,
            owner_3: new_o3,
            ship_count: new_ships,
            max_ship_capacity: state.max_ship_capacity,
            ship_gen_speed: state.ship_gen_speed,
            metal_count: new_metal,
            max_metal_capacity: state.max_metal_capacity,
            metal_gen_speed: state.metal_gen_speed,
            range: state.range,
            launch_velocity: state.launch_velocity,
            level: state.level,
            comet_count: state.comet_count,
            comet_0: state.comet_0,
            comet_1: state.comet_1,
        };

        (
            state_input.owner.from_arcis(updated),
            flush_input.owner.from_arcis(FlushRevealed { success: 1 }),
        )
    }

    /// 5. upgrade_planet: Upgrade a planet, spending metal.
    /// Uses state_input.owner for PlanetState, upgrade_input.owner for UpgradeRevealed.
    #[instruction]
    pub fn upgrade_planet(
        state_input: Enc<Shared, PlanetState>,
        upgrade_input: Enc<Shared, UpgradePlanetInput>,
    ) -> (Enc<Shared, PlanetState>, Enc<Shared, UpgradeRevealed>) {
        let state = state_input.to_arcis();
        let ui = upgrade_input.to_arcis();

        let owner_match: u8 = if state.owner_exists == 1
            && state.owner_0 == ui.player_key_0
            && state.owner_1 == ui.player_key_1
            && state.owner_2 == ui.player_key_2
            && state.owner_3 == ui.player_key_3
        {
            1
        } else {
            0
        };

        let is_planet: u8 = if state.body_type == 0 { 1 } else { 0 };

        let current_metal = compute_current_resource(
            state.metal_count,
            state.max_metal_capacity,
            state.metal_gen_speed,
            ui.last_updated_slot,
            ui.current_slot,
            ui.game_speed,
        );
        let current_ships = compute_current_resource(
            state.ship_count,
            state.max_ship_capacity,
            state.ship_gen_speed,
            ui.last_updated_slot,
            ui.current_slot,
            ui.game_speed,
        );

        let cost = upgrade_cost(state.level);
        let can_afford: u8 = if current_metal >= cost { 1 } else { 0 };

        let valid = owner_match * is_planet * can_afford;

        let new_level = if valid == 1 { state.level + 1 } else { state.level };
        let new_metal = if valid == 1 { current_metal - cost } else { current_metal };
        let new_ship_cap = if valid == 1 { state.max_ship_capacity * 2 } else { state.max_ship_capacity };
        let new_metal_cap = if valid == 1 { state.max_metal_capacity * 2 } else { state.max_metal_capacity };
        let new_ship_gen = if valid == 1 { state.ship_gen_speed * 2 } else { state.ship_gen_speed };

        let new_range = if valid == 1 && ui.focus == 0 {
            state.range * 2
        } else {
            state.range
        };
        let new_velocity = if valid == 1 && ui.focus == 1 {
            state.launch_velocity * 2
        } else {
            state.launch_velocity
        };

        let updated = PlanetState {
            body_type: state.body_type,
            size: state.size,
            owner_exists: state.owner_exists,
            owner_0: state.owner_0,
            owner_1: state.owner_1,
            owner_2: state.owner_2,
            owner_3: state.owner_3,
            ship_count: current_ships,
            max_ship_capacity: new_ship_cap,
            ship_gen_speed: new_ship_gen,
            metal_count: new_metal,
            max_metal_capacity: new_metal_cap,
            metal_gen_speed: state.metal_gen_speed,
            range: new_range,
            launch_velocity: new_velocity,
            level: new_level,
            comet_count: state.comet_count,
            comet_0: state.comet_0,
            comet_1: state.comet_1,
        };

        let revealed = UpgradeRevealed {
            success: valid,
            new_level,
        };

        (
            state_input.owner.from_arcis(updated),
            upgrade_input.owner.from_arcis(revealed),
        )
    }
}
