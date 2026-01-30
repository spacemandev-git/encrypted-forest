use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // =========================================================================
    // Shared structs — split into Static (12 fields) + Dynamic (4 fields)
    // =========================================================================

    /// Static planet properties: set at init, only modified by upgrade.
    /// 12 fields => SharedEncryptedStruct<12>.
    pub struct PlanetStatic {
        pub body_type: u64,
        pub size: u64,
        pub max_ship_capacity: u64,
        pub ship_gen_speed: u64,
        pub max_metal_capacity: u64,
        pub metal_gen_speed: u64,
        pub range: u64,
        pub launch_velocity: u64,
        pub level: u64,
        pub comet_count: u64,
        pub comet_0: u64,
        pub comet_1: u64,
    }

    /// Dynamic planet properties: modified by flush/process_move/upgrade.
    /// 4 fields => SharedEncryptedStruct<4>.
    pub struct PlanetDynamic {
        pub ship_count: u64,
        pub metal_count: u64,
        pub owner_exists: u64,
        pub owner_id: u64,
    }

    // =========================================================================
    // Input structs
    // =========================================================================

    /// Encrypted coordinate input for init_planet.
    /// Only x, y are secret (fog-of-war). Thresholds + game_id are
    /// plaintext params sourced from the on-chain Game account.
    pub struct CoordInput {
        pub x: u64,  // i64 cast to u64 for MPC
        pub y: u64,
    }

    /// Encrypted input for init_spawn_planet.
    /// x, y are fog-of-war secret; player_id + source_planet_id are player secrets.
    /// Thresholds + game_id are plaintext params from the Game account.
    pub struct SpawnInput {
        pub x: u64,
        pub y: u64,
        pub player_id: u64,
        pub source_planet_id: u64,
    }

    pub struct ProcessMoveInput {
        pub player_id: u64,
        pub source_planet_id: u64,
        pub ships_to_send: u64,
        pub metal_to_send: u64,
        pub source_x: u64,
        pub source_y: u64,
        pub target_x: u64,
        pub target_y: u64,
    }

    pub struct FlushTimingInput {
        pub current_slot: u64,
        pub game_speed: u64,
        pub last_updated_slot: u64,
        pub flush_count: u64,
    }

    pub struct UpgradePlanetInput {
        pub player_id: u64,
        pub focus: u64,
        pub current_slot: u64,
        pub game_speed: u64,
        pub last_updated_slot: u64,
        pub metal_upgrade_cost: u64,
    }

    // =========================================================================
    // Revealed output structs
    // =========================================================================

    pub struct InitPlanetRevealed {
        pub planet_hash: u64,
        pub valid: u64,
    }

    pub struct SpawnPlanetRevealed {
        pub planet_hash: u64,
        pub valid: u64,
        pub is_spawn_valid: u64,
    }

    pub struct MoveRevealed {
        pub landing_slot: u64,
        pub surviving_ships: u64,
        pub valid: u64,
    }

    pub struct UpgradeRevealed {
        pub success: u64,
        pub new_level: u64,
    }

    // PendingMoveData: encrypted data about a move in transit (4 fields)
    pub struct PendingMoveData {
        pub ships_arriving: u64,
        pub metal_arriving: u64,
        pub attacking_planet_id: u64,
        pub attacking_player_id: u64,
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
    fn extract_byte(h: u64, index: u64) -> u64 {
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
        (h / divisor) % 256
    }

    /// Determine body type from hash byte.
    fn determine_body_type(
        byte1: u64,
        planet_threshold: u64,
        quasar_threshold: u64,
        spacetime_rip_threshold: u64,
    ) -> u64 {
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
        byte2: u64,
        t1: u64, t2: u64, t3: u64, t4: u64, t5: u64,
    ) -> u64 {
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
    fn determine_comet_count(byte3: u64) -> u64 {
        if byte3 <= 216 {
            0
        } else if byte3 <= 242 {
            1
        } else {
            2
        }
    }

    fn comet_from_byte(b: u64) -> u64 {
        b % 6
    }

    fn comet_from_byte_avoiding(b: u64, first: u64) -> u64 {
        let c = b % 6;
        if c == first {
            (b + 1) % 6
        } else {
            c
        }
    }

    /// Compute base stats for a celestial body.
    /// Returns (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity, native_ships)
    fn base_stats(body_type: u64, size: u64) -> (u64, u64, u64, u64, u64, u64, u64) {
        let s = size;
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
        comet_val: u64,
        active: u64,
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
    fn upgrade_cost(level: u64) -> u64 {
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

    /// Build PlanetStatic + PlanetDynamic from noise-derived properties.
    fn build_planet_state(
        body_type: u64,
        size: u64,
        comet_count: u64,
        comet_0: u64,
        comet_1: u64,
        owner_exists: u64,
        owner_id: u64,
    ) -> (PlanetStatic, PlanetDynamic) {
        let (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity, native_ships) =
            base_stats(body_type, size);

        let c0_active: u64 = if comet_count >= 1 { 1 } else { 0 };
        let (sc1, sg1, mc1, mg1, r1, v1) =
            apply_one_comet(comet_0, c0_active, ship_cap, ship_gen, metal_cap, metal_gen, range, velocity);

        let c1_active: u64 = if comet_count >= 2 { 1 } else { 0 };
        let (sc2, sg2, mc2, mg2, r2, v2) =
            apply_one_comet(comet_1, c1_active, sc1, sg1, mc1, mg1, r1, v1);

        let ship_count = if owner_exists == 1 { 0u64 } else { native_ships };

        let ps = PlanetStatic {
            body_type,
            size,
            max_ship_capacity: sc2,
            ship_gen_speed: sg2,
            max_metal_capacity: mc2,
            metal_gen_speed: mg2,
            range: r2,
            launch_velocity: v2,
            level: 1,
            comet_count,
            comet_0,
            comet_1,
        };

        let pd = PlanetDynamic {
            ship_count,
            metal_count: 0,
            owner_exists,
            owner_id,
        };

        (ps, pd)
    }

    /// Cap a value at a maximum.
    fn cap_at(val: u64, max: u64) -> u64 {
        if val > max { max } else { val }
    }

    /// Apply a single move to planet state (combat resolution).
    /// Returns (ships, metal, owner_exists, owner_id).
    fn apply_combat(
        ships: u64,
        metal: u64,
        max_ship_cap: u64,
        max_metal_cap: u64,
        owner_exists: u64,
        owner_id: u64,
        m_ships: u64,
        m_metal: u64,
        m_player_id: u64,
    ) -> (u64, u64, u64, u64) {
        let is_friendly: u64 = if owner_exists == 1 && owner_id == m_player_id { 1 } else { 0 };

        if is_friendly == 1 {
            let new_ships = cap_at(ships + m_ships, max_ship_cap);
            let new_metal = cap_at(metal + m_metal, max_metal_cap);
            (new_ships, new_metal, owner_exists, owner_id)
        } else if m_ships > ships {
            let remaining = cap_at(m_ships - ships, max_ship_cap);
            let new_metal = cap_at(m_metal, max_metal_cap);
            (remaining, new_metal, 1, m_player_id)
        } else {
            let def_remaining = ships - m_ships;
            (def_remaining, metal, owner_exists, owner_id)
        }
    }

    // =========================================================================
    // Encrypted Instructions (Circuits)
    // =========================================================================

    /// 1. init_planet: Create a new planet from encrypted coordinates.
    /// Output: (PlanetStatic, PlanetDynamic, InitPlanetRevealed)
    #[instruction]
    pub fn init_planet(
        input: Enc<Shared, CoordInput>,
        game_id: u64,
        dead_space_threshold: u64,
        planet_threshold: u64,
        quasar_threshold: u64,
        spacetime_rip_threshold: u64,
        size_threshold_1: u64,
        size_threshold_2: u64,
        size_threshold_3: u64,
        size_threshold_4: u64,
        size_threshold_5: u64,
        planet_key: Shared,
        observer: Shared,
    ) -> (Enc<Shared, PlanetStatic>, Enc<Shared, PlanetDynamic>, Enc<Shared, InitPlanetRevealed>) {
        let inp = input.to_arcis();

        let (h0, h1, h2, h3) = mix_hash(inp.x, inp.y, game_id);
        let planet_hash = h0 + h1 * 3 + h2 * 7 + h3 * 11;

        let byte0 = extract_byte(h0, 0);
        let byte1 = extract_byte(h0, 1);
        let byte2 = extract_byte(h0, 2);
        let byte3 = extract_byte(h0, 3);
        let byte4 = extract_byte(h0, 4);
        let byte5 = extract_byte(h0, 5);

        let is_body: u64 = if byte0 >= dead_space_threshold { 1 } else { 0 };

        let body_type = determine_body_type(
            byte1, planet_threshold, quasar_threshold, spacetime_rip_threshold,
        );

        let size = determine_size(
            byte2, size_threshold_1, size_threshold_2,
            size_threshold_3, size_threshold_4, size_threshold_5,
        );

        let comet_count = determine_comet_count(byte3);
        let comet_0 = comet_from_byte(byte4);
        let comet_1_raw = comet_from_byte_avoiding(byte5, comet_0);
        let comet_1 = if comet_count >= 2 { comet_1_raw } else { 255u64 };
        let comet_0_final = if comet_count >= 1 { comet_0 } else { 255u64 };

        let (ps, pd) = build_planet_state(
            body_type, size, comet_count, comet_0_final, comet_1,
            0, 0,
        );

        let revealed = InitPlanetRevealed {
            planet_hash,
            valid: is_body,
        };

        (
            input.owner.from_arcis(ps),
            planet_key.from_arcis(pd),
            observer.from_arcis(revealed),
        )
    }

    /// 2. init_spawn_planet: Create planet + validate spawn + set owner.
    /// Output: (PlanetStatic, PlanetDynamic, SpawnPlanetRevealed)
    #[instruction]
    pub fn init_spawn_planet(
        input: Enc<Shared, SpawnInput>,
        game_id: u64,
        dead_space_threshold: u64,
        planet_threshold: u64,
        quasar_threshold: u64,
        spacetime_rip_threshold: u64,
        size_threshold_1: u64,
        size_threshold_2: u64,
        size_threshold_3: u64,
        size_threshold_4: u64,
        size_threshold_5: u64,
        planet_key: Shared,
        observer: Shared,
    ) -> (Enc<Shared, PlanetStatic>, Enc<Shared, PlanetDynamic>, Enc<Shared, SpawnPlanetRevealed>) {
        let inp = input.to_arcis();

        let (h0, h1, h2, h3) = mix_hash(inp.x, inp.y, game_id);
        let planet_hash = h0 + h1 * 3 + h2 * 7 + h3 * 11;

        let byte0 = extract_byte(h0, 0);
        let byte1 = extract_byte(h0, 1);
        let byte2 = extract_byte(h0, 2);
        let byte3 = extract_byte(h0, 3);
        let byte4 = extract_byte(h0, 4);
        let byte5 = extract_byte(h0, 5);

        let is_body: u64 = if byte0 >= dead_space_threshold { 1 } else { 0 };

        let body_type = determine_body_type(
            byte1, planet_threshold, quasar_threshold, spacetime_rip_threshold,
        );

        let size = determine_size(
            byte2, size_threshold_1, size_threshold_2,
            size_threshold_3, size_threshold_4, size_threshold_5,
        );

        let comet_count = determine_comet_count(byte3);
        let comet_0 = comet_from_byte(byte4);
        let comet_1_raw = comet_from_byte_avoiding(byte5, comet_0);
        let comet_1 = if comet_count >= 2 { comet_1_raw } else { 255u64 };
        let comet_0_final = if comet_count >= 1 { comet_0 } else { 255u64 };

        let is_planet: u64 = if body_type == 0 { 1 } else { 0 };
        let is_miniscule: u64 = if size == 1 { 1 } else { 0 };
        let is_spawn_valid = is_body * is_planet * is_miniscule;

        let owner_exists = is_spawn_valid;
        let oid = if is_spawn_valid == 1 { inp.player_id } else { 0u64 };

        let (ps, pd) = build_planet_state(
            body_type, size, comet_count, comet_0_final, comet_1,
            owner_exists, oid,
        );

        let revealed = SpawnPlanetRevealed {
            planet_hash,
            valid: is_body,
            is_spawn_valid,
        };

        (
            input.owner.from_arcis(ps),
            planet_key.from_arcis(pd),
            observer.from_arcis(revealed),
        )
    }

    /// 3. process_move: Validate and process a ship movement from source planet.
    /// Input: (PlanetStatic, PlanetDynamic, ProcessMoveInput) + plaintext resource counts
    /// Output: (PlanetDynamic, PendingMoveData, MoveRevealed)
    /// Lazy resource generation is done on-chain before queueing; current_ships/current_metal
    /// and current_slot/game_speed are passed as plaintext params to avoid expensive MPC comparisons.
    /// State-affecting outputs (dynamic, move_data) remain conditional on validity.
    /// Revealed outputs are unconditional — the encrypted valid flag lets the client interpret.
    #[instruction]
    pub fn process_move(
        static_input: Enc<Shared, PlanetStatic>,
        dynamic_input: Enc<Shared, PlanetDynamic>,
        move_input: Enc<Shared, ProcessMoveInput>,
        current_ships: u64,
        current_metal: u64,
        current_slot: u64,
        game_speed: u64,
        observer: Shared,
    ) -> (Enc<Shared, PlanetDynamic>, Enc<Mxe, PendingMoveData>, Enc<Shared, MoveRevealed>) {
        let ps = static_input.to_arcis();
        let pd = dynamic_input.to_arcis();
        let mv = move_input.to_arcis();

        let owner_match: u64 = if pd.owner_exists == 1
            && pd.owner_id == mv.player_id
        {
            1
        } else {
            0
        };

        let has_ships: u64 = if current_ships >= mv.ships_to_send && mv.ships_to_send > 0 { 1 } else { 0 };
        let has_metal: u64 = if current_metal >= mv.metal_to_send { 1 } else { 0 };

        let distance = compute_distance(mv.source_x, mv.source_y, mv.target_x, mv.target_y);
        let surviving = apply_distance_decay(mv.ships_to_send, distance, ps.range);
        let ships_survive: u64 = if surviving > 0 { 1 } else { 0 };

        let valid = owner_match * has_ships * has_metal * ships_survive;

        let landing_slot = compute_landing_slot(
            current_slot, distance, ps.launch_velocity, game_speed,
        );

        // State updates are conditional — invalid moves must not corrupt planet state
        let new_ships = if valid == 1 { current_ships - mv.ships_to_send } else { current_ships };
        let new_metal = if valid == 1 { current_metal - mv.metal_to_send } else { current_metal };

        let updated_dynamic = PlanetDynamic {
            ship_count: new_ships,
            metal_count: new_metal,
            owner_exists: pd.owner_exists,
            owner_id: pd.owner_id,
        };

        let move_data = PendingMoveData {
            ships_arriving: if valid == 1 { surviving } else { 0 },
            metal_arriving: if valid == 1 { mv.metal_to_send } else { 0 },
            attacking_planet_id: mv.source_planet_id,
            attacking_player_id: mv.player_id,
        };

        // Revealed outputs are unconditional — saves 3 encrypted comparisons.
        // Client checks the encrypted valid flag to interpret results.
        let revealed = MoveRevealed {
            landing_slot,
            surviving_ships: surviving,
            valid,
        };

        (
            dynamic_input.owner.from_arcis(updated_dynamic),
            Mxe::get().from_arcis(move_data),
            observer.from_arcis(revealed),
        )
    }

    /// 4. flush_planet: Process a batch of up to 4 landed moves against planet state.
    /// Input: (PlanetStatic, PlanetDynamic, 4x PendingMoveData, FlushTimingInput)
    /// Output: PlanetDynamic — only dynamic fields change during flush
    #[instruction]
    pub fn flush_planet(
        static_input: Enc<Shared, PlanetStatic>,
        dynamic_input: Enc<Shared, PlanetDynamic>,
        m0: Enc<Mxe, PendingMoveData>,
        m1: Enc<Mxe, PendingMoveData>,
        m2: Enc<Mxe, PendingMoveData>,
        m3: Enc<Mxe, PendingMoveData>,
        flush_input: Enc<Shared, FlushTimingInput>,
    ) -> Enc<Shared, PlanetDynamic> {
        let ps = static_input.to_arcis();
        let pd = dynamic_input.to_arcis();
        let fi = flush_input.to_arcis();

        // Compute current resources via lazy generation
        let gen_ships = if pd.owner_exists == 1 {
            compute_current_resource(
                pd.ship_count,
                ps.max_ship_capacity,
                ps.ship_gen_speed,
                fi.last_updated_slot,
                fi.current_slot,
                fi.game_speed,
            )
        } else {
            pd.ship_count
        };
        let gen_metal = if pd.owner_exists == 1 {
            compute_current_resource(
                pd.metal_count,
                ps.max_metal_capacity,
                ps.metal_gen_speed,
                fi.last_updated_slot,
                fi.current_slot,
                fi.game_speed,
            )
        } else {
            pd.metal_count
        };

        // Decrypt all 4 move slots (MPC reads from on-chain accounts)
        let d0 = m0.to_arcis();
        let d1 = m1.to_arcis();
        let d2 = m2.to_arcis();
        let d3 = m3.to_arcis();

        // Apply combat sequentially for each active move
        let mut ships = gen_ships;
        let mut metal = gen_metal;
        let mut o_exists = pd.owner_exists;
        let mut o_id = pd.owner_id;

        // Move 0
        if fi.flush_count >= 1 {
            let (s, m, oe, oi) = apply_combat(
                ships, metal, ps.max_ship_capacity, ps.max_metal_capacity,
                o_exists, o_id, d0.ships_arriving, d0.metal_arriving, d0.attacking_player_id,
            );
            ships = s;
            metal = m;
            o_exists = oe;
            o_id = oi;
        }

        // Move 1
        if fi.flush_count >= 2 {
            let (s, m, oe, oi) = apply_combat(
                ships, metal, ps.max_ship_capacity, ps.max_metal_capacity,
                o_exists, o_id, d1.ships_arriving, d1.metal_arriving, d1.attacking_player_id,
            );
            ships = s;
            metal = m;
            o_exists = oe;
            o_id = oi;
        }

        // Move 2
        if fi.flush_count >= 3 {
            let (s, m, oe, oi) = apply_combat(
                ships, metal, ps.max_ship_capacity, ps.max_metal_capacity,
                o_exists, o_id, d2.ships_arriving, d2.metal_arriving, d2.attacking_player_id,
            );
            ships = s;
            metal = m;
            o_exists = oe;
            o_id = oi;
        }

        // Move 3
        if fi.flush_count >= 4 {
            let (s, m, oe, oi) = apply_combat(
                ships, metal, ps.max_ship_capacity, ps.max_metal_capacity,
                o_exists, o_id, d3.ships_arriving, d3.metal_arriving, d3.attacking_player_id,
            );
            ships = s;
            metal = m;
            o_exists = oe;
            o_id = oi;
        }

        let updated = PlanetDynamic {
            ship_count: ships,
            metal_count: metal,
            owner_exists: o_exists,
            owner_id: o_id,
        };

        dynamic_input.owner.from_arcis(updated)
    }

    /// 5. upgrade_planet: Upgrade a planet, spending metal.
    /// Input: (PlanetStatic, PlanetDynamic, UpgradePlanetInput)
    /// Output: (PlanetStatic, PlanetDynamic, UpgradeRevealed)
    #[instruction]
    pub fn upgrade_planet(
        static_input: Enc<Shared, PlanetStatic>,
        dynamic_input: Enc<Shared, PlanetDynamic>,
        upgrade_input: Enc<Shared, UpgradePlanetInput>,
    ) -> (Enc<Shared, PlanetStatic>, Enc<Shared, PlanetDynamic>, Enc<Shared, UpgradeRevealed>) {
        let ps = static_input.to_arcis();
        let pd = dynamic_input.to_arcis();
        let ui = upgrade_input.to_arcis();

        let owner_match: u64 = if pd.owner_exists == 1
            && pd.owner_id == ui.player_id
        {
            1
        } else {
            0
        };

        let is_planet: u64 = if ps.body_type == 0 { 1 } else { 0 };

        let current_metal = compute_current_resource(
            pd.metal_count,
            ps.max_metal_capacity,
            ps.metal_gen_speed,
            ui.last_updated_slot,
            ui.current_slot,
            ui.game_speed,
        );
        let current_ships = compute_current_resource(
            pd.ship_count,
            ps.max_ship_capacity,
            ps.ship_gen_speed,
            ui.last_updated_slot,
            ui.current_slot,
            ui.game_speed,
        );

        let cost = upgrade_cost(ps.level);
        let can_afford: u64 = if current_metal >= cost { 1 } else { 0 };

        let valid = owner_match * is_planet * can_afford;

        let new_level = if valid == 1 { ps.level + 1 } else { ps.level };
        let new_metal = if valid == 1 { current_metal - cost } else { current_metal };
        let new_ship_cap = if valid == 1 { ps.max_ship_capacity * 2 } else { ps.max_ship_capacity };
        let new_metal_cap = if valid == 1 { ps.max_metal_capacity * 2 } else { ps.max_metal_capacity };
        let new_ship_gen = if valid == 1 { ps.ship_gen_speed * 2 } else { ps.ship_gen_speed };

        let new_range = if valid == 1 && ui.focus == 0 {
            ps.range * 2
        } else {
            ps.range
        };
        let new_velocity = if valid == 1 && ui.focus == 1 {
            ps.launch_velocity * 2
        } else {
            ps.launch_velocity
        };

        let updated_static = PlanetStatic {
            body_type: ps.body_type,
            size: ps.size,
            max_ship_capacity: new_ship_cap,
            ship_gen_speed: new_ship_gen,
            max_metal_capacity: new_metal_cap,
            metal_gen_speed: ps.metal_gen_speed,
            range: new_range,
            launch_velocity: new_velocity,
            level: new_level,
            comet_count: ps.comet_count,
            comet_0: ps.comet_0,
            comet_1: ps.comet_1,
        };

        let updated_dynamic = PlanetDynamic {
            ship_count: current_ships,
            metal_count: new_metal,
            owner_exists: pd.owner_exists,
            owner_id: pd.owner_id,
        };

        let revealed = UpgradeRevealed {
            success: valid,
            new_level,
        };

        (
            static_input.owner.from_arcis(updated_static),
            dynamic_input.owner.from_arcis(updated_dynamic),
            upgrade_input.owner.from_arcis(revealed),
        )
    }
}
