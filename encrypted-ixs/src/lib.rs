use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // =========================================================================
    // Packed types — use Pack<T> directly (not wrapped in struct)
    // =========================================================================

    // Type aliases for readability
    type PlanetStatic = Pack<[u64; 11]>;
    type PlanetDynamic = Pack<[u64; 4]>;

    // PlanetStatic field indices (into [u64; 11])
    const PS_BODY_TYPE: usize = 0;
    const PS_SIZE: usize = 1;
    const PS_MAX_SHIP_CAP: usize = 2;
    const PS_SHIP_GEN: usize = 3;
    const PS_MAX_METAL_CAP: usize = 4;
    const PS_METAL_GEN: usize = 5;
    const PS_RANGE: usize = 6;
    const PS_VELOCITY: usize = 7;
    const PS_LEVEL: usize = 8;
    const PS_COMET_0: usize = 9;
    const PS_COMET_1: usize = 10;

    // PlanetDynamic field indices (into [u64; 4])
    const PD_SHIPS: usize = 0;
    const PD_METAL: usize = 1;
    const PD_OWNER_EXISTS: usize = 2;
    const PD_OWNER_ID: usize = 3;

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

    /// Comet value from byte. Returns 1-6 (never 0; 0 means "no comet").
    fn comet_from_byte(b: u64) -> u64 {
        (b % 6) + 1
    }

    /// Comet value from byte, avoiding a duplicate of `first`.
    fn comet_from_byte_avoiding(b: u64, first: u64) -> u64 {
        let c = (b % 6) + 1;
        if c == first {
            ((b + 1) % 6) + 1
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

    /// Apply comet boosts to stats. comet_val 0 = inactive (no boost).
    /// comet_val 1=ShipCapacity, 2=MetalCapacity, 3=ShipGenSpeed,
    /// 4=MetalGenSpeed, 5=Range, 6=LaunchVelocity.
    fn apply_one_comet(
        comet_val: u64,
        ship_cap: u64,
        ship_gen: u64,
        metal_cap: u64,
        metal_gen: u64,
        range: u64,
        velocity: u64,
    ) -> (u64, u64, u64, u64, u64, u64) {
        if comet_val == 0 {
            (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity)
        } else {
            let new_ship_cap = if comet_val == 1 { ship_cap * 2 } else { ship_cap };
            let new_metal_cap = if comet_val == 2 { metal_cap * 2 } else { metal_cap };
            let new_ship_gen = if comet_val == 3 { ship_gen * 2 } else { ship_gen };
            let new_metal_gen = if comet_val == 4 { metal_gen * 2 } else { metal_gen };
            let new_range = if comet_val == 5 { range * 2 } else { range };
            let new_velocity = if comet_val == 6 { velocity * 2 } else { velocity };
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
            let generated = gen_speed * elapsed * 10000 / game_speed;
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

    /// Compute landing slot. game_speed=10000 is 1x; lower = faster.
    /// Formula: current_slot + distance * game_speed / (velocity * 10000)
    fn compute_landing_slot(current_slot: u64, distance: u64, velocity: u64, game_speed: u64) -> u64 {
        if velocity == 0 {
            current_slot + 999999999
        } else {
            let travel_time = distance * game_speed / (velocity * 10000);
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
    /// comet_0/comet_1: 0=none, 1-6=boost type (inferred from value != 0).
    fn build_planet_state(
        body_type: u64,
        size: u64,
        comet_0: u64,
        comet_1: u64,
        owner_exists: u64,
        owner_id: u64,
    ) -> (PlanetStatic, PlanetDynamic) {
        let (ship_cap, ship_gen, metal_cap, metal_gen, range, velocity, native_ships) =
            base_stats(body_type, size);

        let (sc1, sg1, mc1, mg1, r1, v1) =
            apply_one_comet(comet_0, ship_cap, ship_gen, metal_cap, metal_gen, range, velocity);

        let (sc2, sg2, mc2, mg2, r2, v2) =
            apply_one_comet(comet_1, sc1, sg1, mc1, mg1, r1, v1);

        let ship_count = if owner_exists == 1 { 0u64 } else { native_ships };

        let ps: PlanetStatic = Pack::new([body_type, size, sc2, sg2, mc2, mg2, r2, v2, 1, comet_0, comet_1]);

        let pd: PlanetDynamic = Pack::new([ship_count, 0u64, owner_exists, owner_id]);

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

        // Comet determination: byte3 thresholds, values 1-6 (0 = none)
        let comet_0_raw = comet_from_byte(byte4);
        let comet_1_raw = comet_from_byte_avoiding(byte5, comet_0_raw);
        let comet_0 = if byte3 > 216 { comet_0_raw } else { 0u64 };
        let comet_1 = if byte3 > 242 { comet_1_raw } else { 0u64 };

        let (ps, pd) = build_planet_state(
            body_type, size, comet_0, comet_1,
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

        // Comet determination: byte3 thresholds, values 1-6 (0 = none)
        let comet_0_raw = comet_from_byte(byte4);
        let comet_1_raw = comet_from_byte_avoiding(byte5, comet_0_raw);
        let comet_0 = if byte3 > 216 { comet_0_raw } else { 0u64 };
        let comet_1 = if byte3 > 242 { comet_1_raw } else { 0u64 };

        let is_planet: u64 = if body_type == 0 { 1 } else { 0 };
        let is_miniscule: u64 = if size == 1 { 1 } else { 0 };
        let is_spawn_valid = is_body * is_planet * is_miniscule;

        let owner_exists = is_spawn_valid;
        let oid = if is_spawn_valid == 1 { inp.player_id } else { 0u64 };

        let (ps, pd) = build_planet_state(
            body_type, size, comet_0, comet_1,
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
        let ps_data: [u64; 11] = static_input.to_arcis().unpack();
        let pd_data: [u64; 4] = dynamic_input.to_arcis().unpack();
        let mv = move_input.to_arcis();

        let owner_match: u64 = if pd_data[PD_OWNER_EXISTS] == 1
            && pd_data[PD_OWNER_ID] == mv.player_id
        {
            1
        } else {
            0
        };

        let has_ships: u64 = if current_ships >= mv.ships_to_send && mv.ships_to_send > 0 { 1 } else { 0 };
        let has_metal: u64 = if current_metal >= mv.metal_to_send { 1 } else { 0 };

        let distance = compute_distance(mv.source_x, mv.source_y, mv.target_x, mv.target_y);
        let surviving = apply_distance_decay(mv.ships_to_send, distance, ps_data[PS_RANGE]);
        let ships_survive: u64 = if surviving > 0 { 1 } else { 0 };

        let valid = owner_match * has_ships * has_metal * ships_survive;

        let landing_slot = compute_landing_slot(
            current_slot, distance, ps_data[PS_VELOCITY], game_speed,
        );

        let new_ships = if valid == 1 { current_ships - mv.ships_to_send } else { current_ships };
        let new_metal = if valid == 1 { current_metal - mv.metal_to_send } else { current_metal };

        let updated_dynamic: PlanetDynamic = Pack::new([new_ships, new_metal, pd_data[PD_OWNER_EXISTS], pd_data[PD_OWNER_ID]]);

        let move_data = PendingMoveData {
            ships_arriving: if valid == 1 { surviving } else { 0 },
            metal_arriving: if valid == 1 { mv.metal_to_send } else { 0 },
            attacking_planet_id: mv.source_planet_id,
            attacking_player_id: mv.player_id,
        };

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

    /// 4. flush_planet: Process a single landed move against planet state.
    /// Input: (PlanetStatic, PlanetDynamic, PendingMoveData, FlushTimingInput)
    /// Output: PlanetDynamic -- only dynamic fields change during flush
    #[instruction]
    pub fn flush_planet(
        static_input: Enc<Shared, PlanetStatic>,
        dynamic_input: Enc<Shared, PlanetDynamic>,
        m0: Enc<Mxe, PendingMoveData>,
        flush_input: Enc<Shared, FlushTimingInput>,
    ) -> Enc<Shared, PlanetDynamic> {
        let ps_data: [u64; 11] = static_input.to_arcis().unpack();
        let pd_data: [u64; 4] = dynamic_input.to_arcis().unpack();
        let fi = flush_input.to_arcis();

        // Compute current resources via lazy generation
        let gen_ships = if pd_data[PD_OWNER_EXISTS] == 1 {
            compute_current_resource(
                pd_data[PD_SHIPS],
                ps_data[PS_MAX_SHIP_CAP],
                ps_data[PS_SHIP_GEN],
                fi.last_updated_slot,
                fi.current_slot,
                fi.game_speed,
            )
        } else {
            pd_data[PD_SHIPS]
        };
        let gen_metal = if pd_data[PD_OWNER_EXISTS] == 1 {
            compute_current_resource(
                pd_data[PD_METAL],
                ps_data[PS_MAX_METAL_CAP],
                ps_data[PS_METAL_GEN],
                fi.last_updated_slot,
                fi.current_slot,
                fi.game_speed,
            )
        } else {
            pd_data[PD_METAL]
        };

        // Decrypt the move slot (MPC reads from on-chain account)
        let d0 = m0.to_arcis();

        // Apply combat for the single move
        let (ships, metal, o_exists, o_id) = apply_combat(
            gen_ships, gen_metal, ps_data[PS_MAX_SHIP_CAP], ps_data[PS_MAX_METAL_CAP],
            pd_data[PD_OWNER_EXISTS], pd_data[PD_OWNER_ID],
            d0.ships_arriving, d0.metal_arriving, d0.attacking_player_id,
        );

        let updated: PlanetDynamic = Pack::new([ships, metal, o_exists, o_id]);

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
        let ps_data: [u64; 11] = static_input.to_arcis().unpack();
        let pd_data: [u64; 4] = dynamic_input.to_arcis().unpack();
        let ui = upgrade_input.to_arcis();

        let owner_match: u64 = if pd_data[PD_OWNER_EXISTS] == 1
            && pd_data[PD_OWNER_ID] == ui.player_id
        {
            1
        } else {
            0
        };

        let is_planet: u64 = if ps_data[PS_BODY_TYPE] == 0 { 1 } else { 0 };

        let current_metal = compute_current_resource(
            pd_data[PD_METAL],
            ps_data[PS_MAX_METAL_CAP],
            ps_data[PS_METAL_GEN],
            ui.last_updated_slot,
            ui.current_slot,
            ui.game_speed,
        );
        let current_ships = compute_current_resource(
            pd_data[PD_SHIPS],
            ps_data[PS_MAX_SHIP_CAP],
            ps_data[PS_SHIP_GEN],
            ui.last_updated_slot,
            ui.current_slot,
            ui.game_speed,
        );

        let cost = upgrade_cost(ps_data[PS_LEVEL]);
        let can_afford: u64 = if current_metal >= cost { 1 } else { 0 };

        let valid = owner_match * is_planet * can_afford;

        let new_level = if valid == 1 { ps_data[PS_LEVEL] + 1 } else { ps_data[PS_LEVEL] };
        let new_metal = if valid == 1 { current_metal - cost } else { current_metal };
        let new_ship_cap = if valid == 1 { ps_data[PS_MAX_SHIP_CAP] * 2 } else { ps_data[PS_MAX_SHIP_CAP] };
        let new_metal_cap = if valid == 1 { ps_data[PS_MAX_METAL_CAP] * 2 } else { ps_data[PS_MAX_METAL_CAP] };
        let new_ship_gen = if valid == 1 { ps_data[PS_SHIP_GEN] * 2 } else { ps_data[PS_SHIP_GEN] };

        let new_range = if valid == 1 && ui.focus == 0 {
            ps_data[PS_RANGE] * 2
        } else {
            ps_data[PS_RANGE]
        };
        let new_velocity = if valid == 1 && ui.focus == 1 {
            ps_data[PS_VELOCITY] * 2
        } else {
            ps_data[PS_VELOCITY]
        };

        let updated_static: PlanetStatic = Pack::new([
                ps_data[PS_BODY_TYPE],
                ps_data[PS_SIZE],
                new_ship_cap,
                new_ship_gen,
                new_metal_cap,
                ps_data[PS_METAL_GEN],
                new_range,
                new_velocity,
                new_level,
                ps_data[PS_COMET_0],
                ps_data[PS_COMET_1],
            ]);

        let updated_dynamic: PlanetDynamic = Pack::new([current_ships, new_metal, pd_data[PD_OWNER_EXISTS], pd_data[PD_OWNER_ID]]);

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
