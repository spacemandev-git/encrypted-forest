use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // -----------------------------------------------------------------------
    // Input / Output structs
    // -----------------------------------------------------------------------

    /// Coordinates + game id for planet key derivation
    pub struct PlanetCoords {
        pub x: i64,
        pub y: i64,
        pub game_id: u64,
    }

    /// Result of planet key creation: the 32-byte hash split into 4xu64
    pub struct PlanetKeyResult {
        pub hash_0: u64,
        pub hash_1: u64,
        pub hash_2: u64,
        pub hash_3: u64,
    }

    /// Input for spawn verification
    pub struct SpawnInput {
        pub x: i64,
        pub y: i64,
        pub game_id: u64,
        /// Threshold: byte0 of hash must be >= this value for a celestial body to exist
        pub dead_space_threshold: u8,
        /// Threshold ranges for body type determination on byte1
        pub planet_threshold: u8,
        /// Size threshold boundaries (byte2): values below each threshold map to sizes 1-6
        pub size_threshold_1: u8,
    }

    /// Result of spawn coordinate verification
    pub struct SpawnResult {
        /// 1 if valid (is a Miniscule Planet), 0 otherwise
        pub valid: u8,
        pub hash_0: u64,
        pub hash_1: u64,
        pub hash_2: u64,
        pub hash_3: u64,
    }

    /// Input for combat resolution
    pub struct CombatInput {
        pub attacker_ships: u64,
        pub defender_ships: u64,
    }

    /// Result of combat resolution
    pub struct CombatResult {
        pub attacker_remaining: u64,
        pub defender_remaining: u64,
        /// 1 if attacker wins, 0 otherwise
        pub attacker_wins: u8,
    }

    // -----------------------------------------------------------------------
    // Helper: deterministic hash mixing for MPC circuits
    // Uses only addition, subtraction, multiplication (Arcis supported ops).
    // No XOR, no shifts, no wrapping_mul.
    // -----------------------------------------------------------------------

    fn mix_hash(x: u64, y: u64, game_id: u64) -> (u64, u64, u64, u64) {
        // Simple multiplicative mixing using only supported operations.
        // Constants chosen as small primes to avoid overflow in MPC field arithmetic.
        let a = x * 31 + y * 37 + game_id * 41 + 7;
        let b = y * 43 + game_id * 47 + x * 53 + 13;
        let c = game_id * 59 + x * 61 + y * 67 + 17;
        let d = a * 3 + b * 5 + c * 7 + 19;
        (a, b, c, d)
    }

    // -----------------------------------------------------------------------
    // Encrypted Instructions
    // -----------------------------------------------------------------------

    /// Create a planet key by hashing (x, y, game_id).
    /// Returns the hash split into 4 x u64 values.
    #[instruction]
    pub fn create_planet_key(input: Enc<Shared, PlanetCoords>) -> Enc<Shared, PlanetKeyResult> {
        let coords = input.to_arcis();

        let x_val = coords.x as u64;
        let y_val = coords.y as u64;
        let game_id = coords.game_id;

        let (h0, h1, h2, h3) = mix_hash(x_val, y_val, game_id);

        input.owner.from_arcis(PlanetKeyResult {
            hash_0: h0,
            hash_1: h1,
            hash_2: h2,
            hash_3: h3,
        })
    }

    /// Verify that encrypted (x, y) coordinates hash to a valid spawn planet.
    /// A valid spawn planet is a Miniscule (size 1) Planet type celestial body.
    #[instruction]
    pub fn verify_spawn_coordinates(input: Enc<Shared, SpawnInput>) -> Enc<Shared, SpawnResult> {
        let si = input.to_arcis();

        let x_val = si.x as u64;
        let y_val = si.y as u64;
        let game_id = si.game_id;

        let (h0, h1, h2, h3) = mix_hash(x_val, y_val, game_id);

        // Extract byte0 from h0 using modulo (% 256 extracts lowest 8 bits)
        let byte0 = (h0 % 256) as u8;
        // Extract byte1: divide by 256, then mod 256
        let byte1 = ((h0 / 256) % 256) as u8;
        // Extract byte2: divide by 65536, then mod 256
        let byte2 = ((h0 / 65536) % 256) as u8;

        // Check: is celestial body? byte0 >= dead_space_threshold
        let is_body: u8 = if byte0 >= si.dead_space_threshold { 1 } else { 0 };

        // Check: is Planet type? byte1 < planet_threshold
        let is_planet: u8 = if byte1 < si.planet_threshold { 1 } else { 0 };

        // Check: is Miniscule (size 1)? byte2 < size_threshold_1
        let is_miniscule: u8 = if byte2 < si.size_threshold_1 { 1 } else { 0 };

        // Combine: valid = is_body AND is_planet AND is_miniscule
        let valid = is_body * is_planet * is_miniscule;

        input.owner.from_arcis(SpawnResult {
            valid,
            hash_0: h0,
            hash_1: h1,
            hash_2: h2,
            hash_3: h3,
        })
    }

    /// Resolve combat between attacker and defender ships.
    /// Ships already have distance decay applied before this call.
    #[instruction]
    pub fn resolve_combat(input: Enc<Shared, CombatInput>) -> Enc<Shared, CombatResult> {
        let ci = input.to_arcis();

        let attacker = ci.attacker_ships;
        let defender = ci.defender_ships;

        // attacker_wins = 1 if attacker > defender, else 0
        let attacker_wins: u8 = if attacker > defender { 1 } else { 0 };
        let aw = attacker_wins as u64;
        let dw = 1u64 - aw;

        // Compute absolute difference (both branches execute in MPC)
        let abs_diff = if attacker > defender {
            attacker - defender
        } else {
            defender - attacker
        };

        // Select result based on who won (using multiplication as selector)
        let attacker_remaining = aw * abs_diff;
        let defender_remaining = dw * abs_diff;

        input.owner.from_arcis(CombatResult {
            attacker_remaining,
            defender_remaining,
            attacker_wins,
        })
    }
}
