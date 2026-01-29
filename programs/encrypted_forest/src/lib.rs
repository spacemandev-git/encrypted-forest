use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

// ---------------------------------------------------------------------------
// Computation definition offsets for each encrypted instruction
// ---------------------------------------------------------------------------
const COMP_DEF_OFFSET_CREATE_PLANET_KEY: u32 = comp_def_offset("create_planet_key");
const COMP_DEF_OFFSET_VERIFY_SPAWN_COORDINATES: u32 = comp_def_offset("verify_spawn_coordinates");
const COMP_DEF_OFFSET_RESOLVE_COMBAT: u32 = comp_def_offset("resolve_combat");

declare_id!("4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/// Maximum number of pending moves per planet
const MAX_PENDING_MOVES: usize = 32;
/// Maximum number of comets per celestial body
const MAX_COMETS: usize = 2;

// ---------------------------------------------------------------------------
// Hash-based noise helpers (on-chain, using blake3)
// ---------------------------------------------------------------------------

/// Compute the planet hash from coordinates and game_id using blake3.
/// This is the canonical hash used for PDA seeds and fog-of-war.
pub fn compute_planet_hash(x: i64, y: i64, game_id: u64) -> [u8; 32] {
    let mut input = [0u8; 24];
    input[0..8].copy_from_slice(&x.to_le_bytes());
    input[8..16].copy_from_slice(&y.to_le_bytes());
    input[16..24].copy_from_slice(&game_id.to_le_bytes());
    *blake3::hash(&input).as_bytes()
}

/// Determine celestial body properties from a planet hash and noise thresholds.
/// Returns None if the hash represents dead space.
pub fn determine_celestial_body(
    hash: &[u8; 32],
    thresholds: &NoiseThresholds,
) -> Option<CelestialBodyProperties> {
    let byte0 = hash[0];
    let byte1 = hash[1];
    let byte2 = hash[2];
    let byte3 = hash[3];
    let byte4 = hash[4];
    let byte5 = hash[5];

    // Byte 0: dead space check
    if byte0 < thresholds.dead_space_threshold {
        return None;
    }

    // Byte 1: body type
    let body_type = if byte1 < thresholds.planet_threshold {
        CelestialBodyType::Planet
    } else if byte1 < thresholds.quasar_threshold {
        CelestialBodyType::Quasar
    } else if byte1 < thresholds.spacetime_rip_threshold {
        CelestialBodyType::SpacetimeRip
    } else {
        CelestialBodyType::AsteroidBelt
    };

    // Byte 2: size (1-6)
    let size = if byte2 < thresholds.size_threshold_1 {
        1u8 // Miniscule
    } else if byte2 < thresholds.size_threshold_2 {
        2 // Tiny
    } else if byte2 < thresholds.size_threshold_3 {
        3 // Small
    } else if byte2 < thresholds.size_threshold_4 {
        4 // Medium
    } else if byte2 < thresholds.size_threshold_5 {
        5 // Large
    } else {
        6 // Gargantuan
    };

    // Byte 3: comets (0-216 = none, 217-242 = one, 243-255 = two)
    let num_comets = if byte3 <= 216 {
        0u8
    } else if byte3 <= 242 {
        1
    } else {
        2
    };

    // Bytes 4-5: which stats comets boost (mod 6 for each)
    let mut comets = Vec::new();
    if num_comets >= 1 {
        comets.push(comet_from_byte(byte4));
    }
    if num_comets >= 2 {
        let mut second = comet_from_byte(byte5);
        // Ensure second comet boosts a different stat
        if num_comets == 2 && second == comets[0] {
            second = comet_from_byte(byte5.wrapping_add(1));
        }
        comets.push(second);
    }

    Some(CelestialBodyProperties {
        body_type,
        size,
        comets,
    })
}

fn comet_from_byte(b: u8) -> CometBoost {
    match b % 6 {
        0 => CometBoost::ShipCapacity,
        1 => CometBoost::MetalCapacity,
        2 => CometBoost::ShipGenSpeed,
        3 => CometBoost::MetalGenSpeed,
        4 => CometBoost::Range,
        _ => CometBoost::LaunchVelocity,
    }
}

/// Properties derived from noise function
pub struct CelestialBodyProperties {
    pub body_type: CelestialBodyType,
    pub size: u8,
    pub comets: Vec<CometBoost>,
}

/// Compute base stats for a celestial body given its type and size.
/// Capacities scale quadratically with size, gen speeds scale linearly.
pub fn base_stats(body_type: &CelestialBodyType, size: u8) -> CelestialBodyStats {
    let s = size as u64;
    let s_sq = s * s;

    match body_type {
        CelestialBodyType::Planet => CelestialBodyStats {
            max_ship_capacity: 100 * s_sq,
            ship_gen_speed: 1 * s,
            max_metal_capacity: 0,
            metal_gen_speed: 0,
            range: 3 + s,
            launch_velocity: 1 + s,
            native_ships: if size == 1 { 0 } else { 10 * s },
        },
        CelestialBodyType::Quasar => CelestialBodyStats {
            max_ship_capacity: 500 * s_sq,
            ship_gen_speed: 0,
            max_metal_capacity: 500 * s_sq,
            metal_gen_speed: 0,
            range: 2 + s,
            launch_velocity: 1 + s,
            native_ships: 20 * s,
        },
        CelestialBodyType::SpacetimeRip => CelestialBodyStats {
            max_ship_capacity: 50 * s_sq,
            ship_gen_speed: 1 * s,
            max_metal_capacity: 0,
            metal_gen_speed: 0,
            range: 2 + s,
            launch_velocity: 1 + s,
            native_ships: 15 * s,
        },
        CelestialBodyType::AsteroidBelt => CelestialBodyStats {
            max_ship_capacity: 80 * s_sq,
            ship_gen_speed: 0,
            max_metal_capacity: 200 * s_sq,
            metal_gen_speed: 2 * s,
            range: 2 + s,
            launch_velocity: 1 + s,
            native_ships: 10 * s,
        },
    }
}

pub struct CelestialBodyStats {
    pub max_ship_capacity: u64,
    pub ship_gen_speed: u64,
    pub max_metal_capacity: u64,
    pub metal_gen_speed: u64,
    pub range: u64,
    pub launch_velocity: u64,
    pub native_ships: u64,
}

/// Apply comet boosts to stats. Each comet doubles one stat.
pub fn apply_comet_boosts(stats: &mut CelestialBodyStats, comets: &[CometBoost]) {
    for comet in comets {
        match comet {
            CometBoost::ShipCapacity => stats.max_ship_capacity *= 2,
            CometBoost::MetalCapacity => stats.max_metal_capacity *= 2,
            CometBoost::ShipGenSpeed => stats.ship_gen_speed *= 2,
            CometBoost::MetalGenSpeed => stats.metal_gen_speed *= 2,
            CometBoost::Range => stats.range *= 2,
            CometBoost::LaunchVelocity => stats.launch_velocity *= 2,
        }
    }
}

/// Compute current ship count via lazy generation.
pub fn compute_current_ships(
    last_ship_count: u64,
    max_capacity: u64,
    gen_speed: u64,
    last_updated_slot: u64,
    current_slot: u64,
    game_speed: u64,
) -> u64 {
    if gen_speed == 0 || current_slot <= last_updated_slot || game_speed == 0 {
        return last_ship_count;
    }
    let elapsed = current_slot.saturating_sub(last_updated_slot);
    let generated = gen_speed.saturating_mul(elapsed) / game_speed;
    std::cmp::min(max_capacity, last_ship_count.saturating_add(generated))
}

/// Compute current metal count via lazy generation.
pub fn compute_current_metal(
    last_metal_count: u64,
    max_capacity: u64,
    gen_speed: u64,
    last_updated_slot: u64,
    current_slot: u64,
    game_speed: u64,
) -> u64 {
    if gen_speed == 0 || current_slot <= last_updated_slot || game_speed == 0 {
        return last_metal_count;
    }
    let elapsed = current_slot.saturating_sub(last_updated_slot);
    let generated = gen_speed.saturating_mul(elapsed) / game_speed;
    std::cmp::min(max_capacity, last_metal_count.saturating_add(generated))
}

/// Flush all pending moves that have landed (landing_slot <= current_slot).
/// Moves are processed in landing_slot order.
pub fn flush_pending_moves(
    planet: &mut Account<CelestialBody>,
    pending: &mut Account<PendingMoves>,
    current_slot: u64,
    game_speed: u64,
) {
    // First, compute current ships and metal via generation
    // Only generate if planet has an owner (native population does not regenerate)
    if planet.owner.is_some() {
        planet.ship_count = compute_current_ships(
            planet.ship_count,
            planet.max_ship_capacity,
            planet.ship_gen_speed,
            planet.last_updated_slot,
            current_slot,
            game_speed,
        );
        planet.metal_count = compute_current_metal(
            planet.metal_count,
            planet.max_metal_capacity,
            planet.metal_gen_speed,
            planet.last_updated_slot,
            current_slot,
            game_speed,
        );
    }

    // Sort pending moves by landing_slot (ascending)
    pending.moves.sort_by_key(|m| m.landing_slot);

    // Process moves that have landed
    let mut i = 0;
    while i < pending.moves.len() {
        if pending.moves[i].landing_slot > current_slot {
            break;
        }

        let pending_move = &pending.moves[i];
        let is_friendly = planet.owner == Some(pending_move.attacker);

        if is_friendly {
            // Reinforcement: add ships and metal (capped)
            planet.ship_count = std::cmp::min(
                planet.max_ship_capacity,
                planet.ship_count.saturating_add(pending_move.ships_sent),
            );
            planet.metal_count = std::cmp::min(
                planet.max_metal_capacity,
                planet.metal_count.saturating_add(pending_move.metal_sent),
            );
        } else {
            // Combat: attacker ships vs defender ships
            if pending_move.ships_sent > planet.ship_count {
                // Attacker wins
                let remaining = pending_move.ships_sent - planet.ship_count;
                planet.ship_count = std::cmp::min(remaining, planet.max_ship_capacity);
                planet.owner = Some(pending_move.attacker);
                // Attacker gets the metal they sent
                planet.metal_count = std::cmp::min(
                    planet.max_metal_capacity,
                    pending_move.metal_sent,
                );
            } else {
                // Defender wins (or tie = defender wins)
                planet.ship_count -= pending_move.ships_sent;
                // Metal from attacker is lost in combat
            }
        }

        i += 1;
    }

    // Remove processed moves
    if i > 0 {
        pending.moves.drain(0..i);
    }

    planet.last_updated_slot = current_slot;
}

/// Compute distance between two 2D points (integer Manhattan approximation).
/// For simplicity we use Chebyshev distance as an upper bound.
pub fn compute_distance(x1: i64, y1: i64, x2: i64, y2: i64) -> u64 {
    let dx = (x1 - x2).unsigned_abs();
    let dy = (y1 - y2).unsigned_abs();
    // Euclidean approximation using integer sqrt would be ideal,
    // but for game purposes we use max(dx, dy) + min(dx, dy)/2
    let max_d = std::cmp::max(dx, dy);
    let min_d = std::cmp::min(dx, dy);
    max_d + min_d / 2
}

/// Compute ships remaining after distance decay.
/// Every `range` distance traveled, 1 ship is lost.
pub fn apply_distance_decay(ships: u64, distance: u64, range: u64) -> u64 {
    if range == 0 {
        return 0;
    }
    let lost = distance / range;
    ships.saturating_sub(lost)
}

/// Compute landing slot based on distance and launch velocity.
pub fn compute_landing_slot(current_slot: u64, distance: u64, launch_velocity: u64, game_speed: u64) -> u64 {
    if launch_velocity == 0 {
        return u64::MAX;
    }
    // Travel time in slots = distance * game_speed / launch_velocity
    let travel_time = distance.saturating_mul(game_speed) / launch_velocity;
    current_slot.saturating_add(travel_time)
}

/// Metal cost for upgrading a planet to the next level.
pub fn upgrade_cost(current_level: u8) -> u64 {
    // Exponential cost: 100 * 2^level
    100u64.saturating_mul(1u64 << (current_level as u32))
}

// ===========================================================================
// Program
// ===========================================================================

#[arcium_program]
pub mod encrypted_forest {
    use super::*;

    // -----------------------------------------------------------------------
    // Computation Definition Initializers
    // -----------------------------------------------------------------------

    pub fn init_comp_def_create_planet_key(
        ctx: Context<InitCreatePlanetKeyCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_comp_def_verify_spawn(
        ctx: Context<InitVerifySpawnCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_comp_def_resolve_combat(
        ctx: Context<InitResolveCombatCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Game Management
    // -----------------------------------------------------------------------

    /// Create a new game instance. Permissionless.
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        map_diameter: u64,
        game_speed: u64,
        start_slot: u64,
        end_slot: u64,
        win_condition: WinCondition,
        whitelist: bool,
        server_pubkey: Option<Pubkey>,
        noise_thresholds: NoiseThresholds,
    ) -> Result<()> {
        require!(map_diameter > 0, ErrorCode::InvalidMapDiameter);
        require!(game_speed > 0, ErrorCode::InvalidGameSpeed);
        require!(end_slot > start_slot, ErrorCode::InvalidTimeRange);
        if whitelist {
            require!(server_pubkey.is_some(), ErrorCode::WhitelistRequiresServer);
        }

        let game = &mut ctx.accounts.game;
        game.admin = ctx.accounts.admin.key();
        game.game_id = game_id;
        game.map_diameter = map_diameter;
        game.game_speed = game_speed;
        game.start_slot = start_slot;
        game.end_slot = end_slot;
        game.win_condition = win_condition;
        game.whitelist = whitelist;
        game.server_pubkey = server_pubkey;
        game.noise_thresholds = noise_thresholds;

        Ok(())
    }

    /// Initialize a player account for a game.
    pub fn init_player(ctx: Context<InitPlayer>, _game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;

        // If whitelist is enabled, server must co-sign
        if game.whitelist {
            require!(
                ctx.accounts.server.is_some(),
                ErrorCode::WhitelistServerRequired
            );
            if let Some(ref server) = ctx.accounts.server {
                require!(
                    Some(server.key()) == game.server_pubkey,
                    ErrorCode::InvalidServerKey
                );
            }
        }

        let player = &mut ctx.accounts.player;
        player.owner = ctx.accounts.owner.key();
        player.game_id = game.game_id;
        player.points = 0;
        player.has_spawned = false;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Spawn - Queue Arcium verify_spawn_coordinates computation
    // -----------------------------------------------------------------------

    /// Spawn into the game at encrypted coordinates.
    /// Queues an Arcium computation to verify the coordinates hash to a
    /// valid Miniscule Planet. The callback will finalize the spawn.
    pub fn spawn(
        ctx: Context<Spawn>,
        computation_offset: u64,
        // Encrypted SpawnInput fields
        ciphertext_x: [u8; 32],
        ciphertext_y: [u8; 32],
        ciphertext_game_id: [u8; 32],
        ciphertext_dead_space_threshold: [u8; 32],
        ciphertext_planet_threshold: [u8; 32],
        ciphertext_size_threshold_1: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let player = &ctx.accounts.player;
        require!(!player.has_spawned, ErrorCode::AlreadySpawned);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build args for verify_spawn_coordinates encrypted instruction
        // SpawnInput has: x(i64), y(i64), game_id(u64), dead_space_threshold(u8),
        //   planet_threshold(u8), size_threshold_1(u8)
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(ciphertext_x)        // x as i64 -> encrypted as u64
            .encrypted_u64(ciphertext_y)        // y as i64 -> encrypted as u64
            .encrypted_u64(ciphertext_game_id)
            .encrypted_u8(ciphertext_dead_space_threshold)
            .encrypted_u8(ciphertext_planet_threshold)
            .encrypted_u8(ciphertext_size_threshold_1)
            .build();

        // Callback will receive player + game accounts to finalize spawn
        let player_pda = ctx.accounts.player.key();
        let game_pda = ctx.accounts.game.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![VerifySpawnCoordinatesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: player_pda,
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: game_pda,
                        is_writable: false,
                    },
                ],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for verify_spawn_coordinates.
    /// On success, emits the encrypted spawn result.
    #[arcium_callback(encrypted_ix = "verify_spawn_coordinates")]
    pub fn verify_spawn_coordinates_callback(
        ctx: Context<VerifySpawnCoordinatesCallback>,
        output: SignedComputationOutputs<VerifySpawnCoordinatesOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(VerifySpawnCoordinatesOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Emit the encrypted spawn result for the client to decrypt
        // field_0 is SharedEncryptedStruct<5>: valid(u8), hash_0..3(u64)
        emit!(SpawnResultEvent {
            encrypted_valid: o.ciphertexts[0],
            encrypted_hash_0: o.ciphertexts[1],
            encrypted_hash_1: o.ciphertexts[2],
            encrypted_hash_2: o.ciphertexts[3],
            encrypted_hash_3: o.ciphertexts[4],
            encryption_key: o.encryption_key,
            nonce: o.nonce.to_le_bytes(),
        });

        // Mark player as spawned
        ctx.accounts.player.has_spawned = true;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Create Planet (on-chain, after player knows the hash)
    // -----------------------------------------------------------------------

    /// Create a celestial body account at known coordinates.
    /// The caller provides (x, y, game_id) in plaintext and the program
    /// verifies the hash matches, determines properties via noise function,
    /// and initializes the account.
    pub fn create_planet(
        ctx: Context<CreatePlanet>,
        _game_id: u64,
        x: i64,
        y: i64,
        planet_hash: [u8; 32],
    ) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        // Verify the hash matches coordinates
        let computed_hash = compute_planet_hash(x, y, game.game_id);
        require!(computed_hash == planet_hash, ErrorCode::InvalidPlanetHash);

        // Check coordinates are within map bounds
        let half = (game.map_diameter / 2) as i64;
        require!(
            x >= -half && x <= half && y >= -half && y <= half,
            ErrorCode::CoordinatesOutOfBounds
        );

        // Determine celestial body properties from hash
        let props = determine_celestial_body(&planet_hash, &game.noise_thresholds)
            .ok_or(ErrorCode::DeadSpace)?;

        let mut stats = base_stats(&props.body_type, props.size);
        apply_comet_boosts(&mut stats, &props.comets);

        let planet = &mut ctx.accounts.celestial_body;
        planet.body_type = props.body_type;
        planet.size = props.size;
        planet.owner = None;
        planet.ship_count = stats.native_ships;
        planet.max_ship_capacity = stats.max_ship_capacity;
        planet.ship_gen_speed = stats.ship_gen_speed;
        planet.metal_count = 0;
        planet.max_metal_capacity = stats.max_metal_capacity;
        planet.metal_gen_speed = stats.metal_gen_speed;
        planet.range = stats.range;
        planet.launch_velocity = stats.launch_velocity;
        planet.level = 1;
        planet.comets = props.comets;
        planet.last_updated_slot = clock.slot;
        planet.planet_hash = planet_hash;

        // Initialize pending moves account
        let pending = &mut ctx.accounts.pending_moves;
        pending.game_id = game.game_id;
        pending.planet_hash = planet_hash;
        pending.moves = Vec::new();

        Ok(())
    }

    /// Claim ownership of a planet during spawn.
    /// Called after create_planet, sets the spawning player as owner
    /// and resets the planet to spawn state (0 ships for Miniscule).
    pub fn claim_spawn_planet(
        ctx: Context<ClaimSpawnPlanet>,
        _game_id: u64,
        _planet_hash: [u8; 32],
    ) -> Result<()> {
        let player = &ctx.accounts.player;
        require!(player.has_spawned, ErrorCode::NotSpawned);

        let planet = &mut ctx.accounts.celestial_body;
        require!(planet.owner.is_none(), ErrorCode::PlanetAlreadyOwned);
        require!(planet.size == 1, ErrorCode::InvalidSpawnPlanet);
        require!(
            planet.body_type == CelestialBodyType::Planet,
            ErrorCode::InvalidSpawnPlanet
        );

        planet.owner = Some(player.owner);
        planet.ship_count = 0; // Miniscule planets start with 0 ships
        planet.last_updated_slot = Clock::get()?.slot;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Move Ships
    // -----------------------------------------------------------------------

    /// Move ships (and optionally metal) from source planet to target planet.
    /// Flushes pending moves on source before processing.
    pub fn move_ships(
        ctx: Context<MoveShips>,
        _game_id: u64,
        _source_hash: [u8; 32],
        _target_hash: [u8; 32],
        ships_to_send: u64,
        metal_to_send: u64,
        source_x: i64,
        source_y: i64,
        target_x: i64,
        target_y: i64,
    ) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);
        require!(ships_to_send > 0, ErrorCode::MustSendShips);

        let source = &mut ctx.accounts.source_planet;
        let source_pending = &mut ctx.accounts.source_pending;

        // Verify ownership
        require!(
            source.owner == Some(ctx.accounts.player_owner.key()),
            ErrorCode::NotPlanetOwner
        );

        // Flush pending moves on source planet first
        flush_pending_moves(source, source_pending, clock.slot, game.game_speed);

        // Check source has enough ships and metal
        require!(source.ship_count >= ships_to_send, ErrorCode::InsufficientShips);
        require!(source.metal_count >= metal_to_send, ErrorCode::InsufficientMetal);

        // Compute distance and apply range check
        let distance = compute_distance(source_x, source_y, target_x, target_y);
        let surviving_ships = apply_distance_decay(ships_to_send, distance, source.range);
        require!(surviving_ships > 0, ErrorCode::NoShipsSurviveDistance);

        // Compute landing slot
        let landing_slot = compute_landing_slot(
            clock.slot,
            distance,
            source.launch_velocity,
            game.game_speed,
        );

        // Deduct from source
        source.ship_count -= ships_to_send;
        source.metal_count -= metal_to_send;
        source.last_updated_slot = clock.slot;

        // Push to target's pending moves
        let target_pending = &mut ctx.accounts.target_pending;
        require!(
            target_pending.moves.len() < MAX_PENDING_MOVES,
            ErrorCode::TooManyPendingMoves
        );

        target_pending.moves.push(PendingMove {
            source_planet_hash: source.planet_hash,
            ships_sent: surviving_ships,
            metal_sent: metal_to_send,
            landing_slot,
            attacker: ctx.accounts.player_owner.key(),
        });

        emit!(MoveEvent {
            source_hash: source.planet_hash,
            target_hash: ctx.accounts.target_planet.planet_hash,
            ships_sent: ships_to_send,
            ships_arriving: surviving_ships,
            metal_sent: metal_to_send,
            landing_slot,
            player: ctx.accounts.player_owner.key(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Upgrade
    // -----------------------------------------------------------------------

    /// Upgrade a Planet-type celestial body. Spends metal to level up.
    /// Player chooses Range or LaunchVelocity focus.
    /// Both choices also double ship/metal capacities and ship gen speed.
    pub fn upgrade(
        ctx: Context<Upgrade>,
        _game_id: u64,
        _planet_hash: [u8; 32],
        focus: UpgradeFocus,
    ) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        let planet = &mut ctx.accounts.celestial_body;
        let pending = &mut ctx.accounts.pending_moves;

        // Only planets can be upgraded
        require!(
            planet.body_type == CelestialBodyType::Planet,
            ErrorCode::CannotUpgradeNonPlanet
        );

        // Must own the planet
        require!(
            planet.owner == Some(ctx.accounts.player_owner.key()),
            ErrorCode::NotPlanetOwner
        );

        // Flush pending moves first
        flush_pending_moves(planet, pending, clock.slot, game.game_speed);

        // Compute upgrade cost
        let cost = upgrade_cost(planet.level);
        require!(planet.metal_count >= cost, ErrorCode::InsufficientMetal);

        // Deduct metal and level up
        planet.metal_count -= cost;
        planet.level += 1;

        // Both options double caps and gen speed
        planet.max_ship_capacity *= 2;
        planet.max_metal_capacity *= 2;
        planet.ship_gen_speed *= 2;

        // Focus-specific bonus
        match focus {
            UpgradeFocus::Range => planet.range *= 2,
            UpgradeFocus::LaunchVelocity => planet.launch_velocity *= 2,
        }

        planet.last_updated_slot = clock.slot;

        emit!(UpgradeEvent {
            planet_hash: planet.planet_hash,
            new_level: planet.level,
            focus,
            player: ctx.accounts.player_owner.key(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Broadcast
    // -----------------------------------------------------------------------

    /// Broadcast planet coordinates publicly so all players can discover it.
    pub fn broadcast(
        ctx: Context<Broadcast>,
        _game_id: u64,
        x: i64,
        y: i64,
        planet_hash: [u8; 32],
    ) -> Result<()> {
        let game = &ctx.accounts.game;

        // Verify the hash
        let computed = compute_planet_hash(x, y, game.game_id);
        require!(computed == planet_hash, ErrorCode::InvalidPlanetHash);

        emit!(BroadcastEvent {
            x,
            y,
            game_id: game.game_id,
            planet_hash,
            broadcaster: ctx.accounts.broadcaster.key(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /// Close game-related accounts after the game has ended to reclaim rent.
    pub fn cleanup_game(ctx: Context<CleanupGame>, _game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot > game.end_slot, ErrorCode::GameNotEnded);
        // Account closing is handled by Anchor's close constraint
        Ok(())
    }

    pub fn cleanup_player(ctx: Context<CleanupPlayer>, _game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot > game.end_slot, ErrorCode::GameNotEnded);
        Ok(())
    }

    pub fn cleanup_planet(
        ctx: Context<CleanupPlanet>,
        _game_id: u64,
        _planet_hash: [u8; 32],
    ) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot > game.end_slot, ErrorCode::GameNotEnded);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue create_planet_key computation
    // -----------------------------------------------------------------------

    /// Queue an Arcium computation to create a planet encryption key.
    pub fn queue_create_planet_key(
        ctx: Context<QueueCreatePlanetKey>,
        computation_offset: u64,
        ciphertext_x: [u8; 32],
        ciphertext_y: [u8; 32],
        ciphertext_game_id: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(ciphertext_x)
            .encrypted_u64(ciphertext_y)
            .encrypted_u64(ciphertext_game_id)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CreatePlanetKeyCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for create_planet_key.
    #[arcium_callback(encrypted_ix = "create_planet_key")]
    pub fn create_planet_key_callback(
        ctx: Context<CreatePlanetKeyCallback>,
        output: SignedComputationOutputs<CreatePlanetKeyOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CreatePlanetKeyOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Emit encrypted planet key result
        emit!(PlanetKeyEvent {
            encrypted_hash_0: o.ciphertexts[0],
            encrypted_hash_1: o.ciphertexts[1],
            encrypted_hash_2: o.ciphertexts[2],
            encrypted_hash_3: o.ciphertexts[3],
            encryption_key: o.encryption_key,
            nonce: o.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue resolve_combat computation (for encrypted combat)
    // -----------------------------------------------------------------------

    /// Queue an Arcium computation to resolve combat.
    pub fn queue_resolve_combat(
        ctx: Context<QueueResolveCombat>,
        computation_offset: u64,
        ciphertext_attacker_ships: [u8; 32],
        ciphertext_defender_ships: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(ciphertext_attacker_ships)
            .encrypted_u64(ciphertext_defender_ships)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ResolveCombatCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    /// Callback for resolve_combat.
    #[arcium_callback(encrypted_ix = "resolve_combat")]
    pub fn resolve_combat_callback(
        ctx: Context<ResolveCombatCallback>,
        output: SignedComputationOutputs<ResolveCombatOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ResolveCombatOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(CombatResultEvent {
            encrypted_attacker_remaining: o.ciphertexts[0],
            encrypted_defender_remaining: o.ciphertexts[1],
            encrypted_attacker_wins: o.ciphertexts[2],
            encryption_key: o.encryption_key,
            nonce: o.nonce.to_le_bytes(),
        });

        Ok(())
    }
}

// ===========================================================================
// Account Structures - State
// ===========================================================================

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub admin: Pubkey,
    pub game_id: u64,
    pub map_diameter: u64,
    pub game_speed: u64,
    pub start_slot: u64,
    pub end_slot: u64,
    pub win_condition: WinCondition,
    pub whitelist: bool,
    pub server_pubkey: Option<Pubkey>,
    pub noise_thresholds: NoiseThresholds,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub owner: Pubkey,
    pub game_id: u64,
    pub points: u64,
    pub has_spawned: bool,
}

#[account]
pub struct CelestialBody {
    pub body_type: CelestialBodyType,
    pub size: u8,
    pub owner: Option<Pubkey>,
    pub ship_count: u64,
    pub max_ship_capacity: u64,
    pub ship_gen_speed: u64,
    pub metal_count: u64,
    pub max_metal_capacity: u64,
    pub metal_gen_speed: u64,
    pub range: u64,
    pub launch_velocity: u64,
    pub level: u8,
    pub comets: Vec<CometBoost>,
    pub last_updated_slot: u64,
    pub planet_hash: [u8; 32],
}

impl CelestialBody {
    pub const MAX_SIZE: usize = 8  // discriminator
        + 1   // body_type
        + 1   // size
        + 33  // owner (Option<Pubkey>)
        + 8   // ship_count
        + 8   // max_ship_capacity
        + 8   // ship_gen_speed
        + 8   // metal_count
        + 8   // max_metal_capacity
        + 8   // metal_gen_speed
        + 8   // range
        + 8   // launch_velocity
        + 1   // level
        + 4 + (MAX_COMETS * 1) // comets vec (4 byte len + max 2 entries)
        + 8   // last_updated_slot
        + 32; // planet_hash
}

#[account]
pub struct PendingMoves {
    pub game_id: u64,
    pub planet_hash: [u8; 32],
    pub moves: Vec<PendingMove>,
}

impl PendingMoves {
    pub const MAX_SIZE: usize = 8  // discriminator
        + 8   // game_id
        + 32  // planet_hash
        + 4 + (MAX_PENDING_MOVES * PendingMove::SIZE); // moves vec
}

// ===========================================================================
// Supporting Structs & Enums
// ===========================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PendingMove {
    pub source_planet_hash: [u8; 32],
    pub ships_sent: u64,
    pub metal_sent: u64,
    pub landing_slot: u64,
    pub attacker: Pubkey,
}

impl PendingMove {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 32;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CelestialBodyType {
    Planet,
    Quasar,
    SpacetimeRip,
    AsteroidBelt,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum WinCondition {
    PointsBurning { points_per_metal: u64 },
    RaceToCenter { min_spawn_distance: u64 },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum UpgradeFocus {
    Range,
    LaunchVelocity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CometBoost {
    ShipCapacity,
    MetalCapacity,
    ShipGenSpeed,
    MetalGenSpeed,
    Range,
    LaunchVelocity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct NoiseThresholds {
    pub dead_space_threshold: u8,
    pub planet_threshold: u8,
    pub quasar_threshold: u8,
    pub spacetime_rip_threshold: u8,
    pub asteroid_belt_threshold: u8,
    pub size_threshold_1: u8,
    pub size_threshold_2: u8,
    pub size_threshold_3: u8,
    pub size_threshold_4: u8,
    pub size_threshold_5: u8,
}

// ===========================================================================
// Events
// ===========================================================================

#[event]
pub struct SpawnResultEvent {
    pub encrypted_valid: [u8; 32],
    pub encrypted_hash_0: [u8; 32],
    pub encrypted_hash_1: [u8; 32],
    pub encrypted_hash_2: [u8; 32],
    pub encrypted_hash_3: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct PlanetKeyEvent {
    pub encrypted_hash_0: [u8; 32],
    pub encrypted_hash_1: [u8; 32],
    pub encrypted_hash_2: [u8; 32],
    pub encrypted_hash_3: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct CombatResultEvent {
    pub encrypted_attacker_remaining: [u8; 32],
    pub encrypted_defender_remaining: [u8; 32],
    pub encrypted_attacker_wins: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct MoveEvent {
    pub source_hash: [u8; 32],
    pub target_hash: [u8; 32],
    pub ships_sent: u64,
    pub ships_arriving: u64,
    pub metal_sent: u64,
    pub landing_slot: u64,
    pub player: Pubkey,
}

#[event]
pub struct UpgradeEvent {
    pub planet_hash: [u8; 32],
    pub new_level: u8,
    pub focus: UpgradeFocus,
    pub player: Pubkey,
}

#[event]
pub struct BroadcastEvent {
    pub x: i64,
    pub y: i64,
    pub game_id: u64,
    pub planet_hash: [u8; 32],
    pub broadcaster: Pubkey,
}

// ===========================================================================
// Error Codes
// ===========================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid map diameter")]
    InvalidMapDiameter,
    #[msg("Invalid game speed")]
    InvalidGameSpeed,
    #[msg("End slot must be after start slot")]
    InvalidTimeRange,
    #[msg("Whitelist games require a server pubkey")]
    WhitelistRequiresServer,
    #[msg("Whitelist server signature required")]
    WhitelistServerRequired,
    #[msg("Invalid server key")]
    InvalidServerKey,
    #[msg("Player has already spawned")]
    AlreadySpawned,
    #[msg("Player has not spawned yet")]
    NotSpawned,
    #[msg("Game has not started")]
    GameNotStarted,
    #[msg("Game has ended")]
    GameEnded,
    #[msg("Game has not ended yet")]
    GameNotEnded,
    #[msg("Invalid planet hash")]
    InvalidPlanetHash,
    #[msg("Coordinates are outside map bounds")]
    CoordinatesOutOfBounds,
    #[msg("Coordinate is dead space")]
    DeadSpace,
    #[msg("Invalid spawn planet - must be Miniscule Planet")]
    InvalidSpawnPlanet,
    #[msg("Planet already has an owner")]
    PlanetAlreadyOwned,
    #[msg("You do not own this planet")]
    NotPlanetOwner,
    #[msg("Insufficient ships")]
    InsufficientShips,
    #[msg("Insufficient metal")]
    InsufficientMetal,
    #[msg("Must send at least one ship")]
    MustSendShips,
    #[msg("No ships would survive the journey")]
    NoShipsSurviveDistance,
    #[msg("Too many pending moves on target planet")]
    TooManyPendingMoves,
    #[msg("Only Planet type can be upgraded")]
    CannotUpgradeNonPlanet,
    #[msg("Invalid spawn coordinates")]
    InvalidSpawnCoordinates,
}

// ===========================================================================
// Account Contexts
// ===========================================================================

// --- Computation Definition Initializers ---

#[init_computation_definition_accounts("create_planet_key", payer)]
#[derive(Accounts)]
pub struct InitCreatePlanetKeyCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("verify_spawn_coordinates", payer)]
#[derive(Accounts)]
pub struct InitVerifySpawnCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("resolve_combat", payer)]
#[derive(Accounts)]
pub struct InitResolveCombatCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// --- Game Management ---

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct InitPlayer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = owner,
        space = 8 + Player::INIT_SPACE,
        seeds = [b"player", game_id.to_le_bytes().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, Player>,
    /// Optional server signer for whitelist games
    pub server: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
}

// --- Spawn (queues Arcium computation) ---

#[queue_computation_accounts("verify_spawn_coordinates", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Spawn<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"game", player.game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player", player.game_id.to_le_bytes().as_ref(), player.owner.as_ref()],
        bump,
        constraint = player.owner == payer.key() @ ErrorCode::NotPlanetOwner,
    )]
    pub player: Account<'info, Player>,
    // Standard Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VERIFY_SPAWN_COORDINATES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("verify_spawn_coordinates")]
#[derive(Accounts)]
pub struct VerifySpawnCoordinatesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VERIFY_SPAWN_COORDINATES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    // Custom callback accounts
    #[account(mut)]
    pub player: Account<'info, Player>,
    pub game: Account<'info, Game>,
}

// --- Create Planet ---

#[derive(Accounts)]
#[instruction(game_id: u64, x: i64, y: i64, planet_hash: [u8; 32])]
pub struct CreatePlanet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = payer,
        space = CelestialBody::MAX_SIZE,
        seeds = [b"planet", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub celestial_body: Account<'info, CelestialBody>,
    #[account(
        init,
        payer = payer,
        space = PendingMoves::MAX_SIZE,
        seeds = [b"moves", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub pending_moves: Account<'info, PendingMoves>,
    pub system_program: Program<'info, System>,
}

// --- Claim Spawn Planet ---

#[derive(Accounts)]
#[instruction(game_id: u64, planet_hash: [u8; 32])]
pub struct ClaimSpawnPlanet<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"player", game_id.to_le_bytes().as_ref(), owner.key().as_ref()],
        bump,
        constraint = player.owner == owner.key() @ ErrorCode::NotPlanetOwner,
    )]
    pub player: Account<'info, Player>,
    #[account(
        mut,
        seeds = [b"planet", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub celestial_body: Account<'info, CelestialBody>,
}

// --- Move Ships ---

#[derive(Accounts)]
#[instruction(game_id: u64, source_hash: [u8; 32], target_hash: [u8; 32])]
pub struct MoveShips<'info> {
    pub player_owner: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"planet", game_id.to_le_bytes().as_ref(), source_hash.as_ref()],
        bump,
    )]
    pub source_planet: Account<'info, CelestialBody>,
    #[account(
        mut,
        seeds = [b"moves", game_id.to_le_bytes().as_ref(), source_hash.as_ref()],
        bump,
    )]
    pub source_pending: Account<'info, PendingMoves>,
    #[account(
        seeds = [b"planet", game_id.to_le_bytes().as_ref(), target_hash.as_ref()],
        bump,
    )]
    pub target_planet: Account<'info, CelestialBody>,
    #[account(
        mut,
        seeds = [b"moves", game_id.to_le_bytes().as_ref(), target_hash.as_ref()],
        bump,
    )]
    pub target_pending: Account<'info, PendingMoves>,
}

// --- Upgrade ---

#[derive(Accounts)]
#[instruction(game_id: u64, planet_hash: [u8; 32])]
pub struct Upgrade<'info> {
    pub player_owner: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"planet", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub celestial_body: Account<'info, CelestialBody>,
    #[account(
        mut,
        seeds = [b"moves", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub pending_moves: Account<'info, PendingMoves>,
}

// --- Broadcast ---

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct Broadcast<'info> {
    pub broadcaster: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
}

// --- Cleanup ---

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CleanupGame<'info> {
    #[account(mut)]
    pub closer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        close = closer,
    )]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CleanupPlayer<'info> {
    #[account(mut)]
    pub closer: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"player", game_id.to_le_bytes().as_ref(), player.owner.as_ref()],
        bump,
        close = closer,
    )]
    pub player: Account<'info, Player>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, planet_hash: [u8; 32])]
pub struct CleanupPlanet<'info> {
    #[account(mut)]
    pub closer: Signer<'info>,
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [b"planet", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
        close = closer,
    )]
    pub celestial_body: Account<'info, CelestialBody>,
    #[account(
        mut,
        seeds = [b"moves", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
        close = closer,
    )]
    pub pending_moves: Account<'info, PendingMoves>,
}

// --- Queue Create Planet Key ---

#[queue_computation_accounts("create_planet_key", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueCreatePlanetKey<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CREATE_PLANET_KEY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("create_planet_key")]
#[derive(Accounts)]
pub struct CreatePlanetKeyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CREATE_PLANET_KEY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
}

// --- Queue Resolve Combat ---

#[queue_computation_accounts("resolve_combat", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueResolveCombat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_RESOLVE_COMBAT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("resolve_combat")]
#[derive(Accounts)]
pub struct ResolveCombatCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_RESOLVE_COMBAT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
}
