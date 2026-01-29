use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

// ---------------------------------------------------------------------------
// Computation definition offsets for each encrypted instruction
// ---------------------------------------------------------------------------
const COMP_DEF_OFFSET_INIT_PLANET: u32 = comp_def_offset("init_planet");
const COMP_DEF_OFFSET_INIT_SPAWN_PLANET: u32 = comp_def_offset("init_spawn_planet");
const COMP_DEF_OFFSET_PROCESS_MOVE: u32 = comp_def_offset("process_move");
const COMP_DEF_OFFSET_FLUSH_PLANET: u32 = comp_def_offset("flush_planet");
const COMP_DEF_OFFSET_UPGRADE_PLANET: u32 = comp_def_offset("upgrade_planet");

declare_id!("4R4Pxo65rnESAbndivR76UXP9ahX7WxczsZDWcryaM3c");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_PENDING_MOVES: usize = 16;
const PLANET_STATE_FIELDS: usize = 19;
const _PENDING_MOVE_DATA_FIELDS: usize = 6;

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------
pub fn compute_planet_hash(x: i64, y: i64, game_id: u64) -> [u8; 32] {
    let mut input = [0u8; 24];
    input[0..8].copy_from_slice(&x.to_le_bytes());
    input[8..16].copy_from_slice(&y.to_le_bytes());
    input[16..24].copy_from_slice(&game_id.to_le_bytes());
    *blake3::hash(&input).as_bytes()
}

// ---------------------------------------------------------------------------
// Helper: extract [u8; 32] from a Vec<u8> at index i
// ---------------------------------------------------------------------------
fn extract_ct(data: &[u8], index: usize) -> [u8; 32] {
    let start = index * 32;
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[start..start + 32]);
    out
}

// ---------------------------------------------------------------------------
// Helper: build ArgBuilder for PlanetState (19 fields) from packed ciphertexts
// ---------------------------------------------------------------------------
fn append_planet_state_args(mut builder: ArgBuilder, cts: &[u8]) -> ArgBuilder {
    // body_type(u8), size(u8), owner_exists(u8)
    builder = builder
        .encrypted_u8(extract_ct(cts, 0))
        .encrypted_u8(extract_ct(cts, 1))
        .encrypted_u8(extract_ct(cts, 2));
    // owner_0..3(u64)
    builder = builder
        .encrypted_u64(extract_ct(cts, 3))
        .encrypted_u64(extract_ct(cts, 4))
        .encrypted_u64(extract_ct(cts, 5))
        .encrypted_u64(extract_ct(cts, 6));
    // ship_count, max_ship_capacity, ship_gen_speed
    builder = builder
        .encrypted_u64(extract_ct(cts, 7))
        .encrypted_u64(extract_ct(cts, 8))
        .encrypted_u64(extract_ct(cts, 9));
    // metal_count, max_metal_capacity, metal_gen_speed
    builder = builder
        .encrypted_u64(extract_ct(cts, 10))
        .encrypted_u64(extract_ct(cts, 11))
        .encrypted_u64(extract_ct(cts, 12));
    // range, launch_velocity
    builder = builder
        .encrypted_u64(extract_ct(cts, 13))
        .encrypted_u64(extract_ct(cts, 14));
    // level(u8), comet_count(u8), comet_0(u8), comet_1(u8)
    builder = builder
        .encrypted_u8(extract_ct(cts, 15))
        .encrypted_u8(extract_ct(cts, 16))
        .encrypted_u8(extract_ct(cts, 17))
        .encrypted_u8(extract_ct(cts, 18));
    builder
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

    pub fn init_comp_def_init_planet(
        ctx: Context<InitInitPlanetCompDef>,
        circuit_base_url: String,
    ) -> Result<()> {
        let source_url = format!("{}/init_planet.arcis", circuit_base_url);
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: source_url,
                hash: circuit_hash!("init_planet"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_comp_def_init_spawn_planet(
        ctx: Context<InitInitSpawnPlanetCompDef>,
        circuit_base_url: String,
    ) -> Result<()> {
        let source_url = format!("{}/init_spawn_planet.arcis", circuit_base_url);
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: source_url,
                hash: circuit_hash!("init_spawn_planet"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_comp_def_process_move(
        ctx: Context<InitProcessMoveCompDef>,
        circuit_base_url: String,
    ) -> Result<()> {
        let source_url = format!("{}/process_move.arcis", circuit_base_url);
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: source_url,
                hash: circuit_hash!("process_move"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_comp_def_flush_planet(
        ctx: Context<InitFlushPlanetCompDef>,
        circuit_base_url: String,
    ) -> Result<()> {
        let source_url = format!("{}/flush_planet.arcis", circuit_base_url);
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: source_url,
                hash: circuit_hash!("flush_planet"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_comp_def_upgrade_planet(
        ctx: Context<InitUpgradePlanetCompDef>,
        circuit_base_url: String,
    ) -> Result<()> {
        let source_url = format!("{}/upgrade_planet.arcis", circuit_base_url);
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: source_url,
                hash: circuit_hash!("upgrade_planet"),
            })),
            None,
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Game Management
    // -----------------------------------------------------------------------

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

    pub fn init_player(ctx: Context<InitPlayer>, _game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;

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
    // Queue init_planet
    // Packed params: ciphertexts = 12 * 32 bytes, pubkey = 32, nonce = 16, observer = 32
    // -----------------------------------------------------------------------

    pub fn queue_init_planet(
        ctx: Context<QueueInitPlanet>,
        computation_offset: u64,
        planet_hash: [u8; 32],
        // All 12 ciphertexts packed: x, y, game_id, dead_space, planet, quasar, spacetime, s1-s5
        ciphertexts: Vec<u8>,
        pubkey: [u8; 32],
        nonce: u128,
        observer_pubkey: [u8; 32],
    ) -> Result<()> {
        require!(ciphertexts.len() == 12 * 32, ErrorCode::InvalidInitPlanet);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        let body = &mut ctx.accounts.celestial_body;
        body.planet_hash = planet_hash;
        body.last_updated_slot = clock.slot;
        body.last_flushed_slot = clock.slot;

        let pending = &mut ctx.accounts.pending_moves;
        pending.game_id = game.game_id;
        pending.planet_hash = planet_hash;
        pending.move_count = 0;
        pending.moves = Vec::new();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(extract_ct(&ciphertexts, 0))  // x
            .encrypted_u64(extract_ct(&ciphertexts, 1))  // y
            .encrypted_u64(extract_ct(&ciphertexts, 2))  // game_id
            .encrypted_u8(extract_ct(&ciphertexts, 3))   // dead_space
            .encrypted_u8(extract_ct(&ciphertexts, 4))   // planet_thresh
            .encrypted_u8(extract_ct(&ciphertexts, 5))   // quasar_thresh
            .encrypted_u8(extract_ct(&ciphertexts, 6))   // spacetime_thresh
            .encrypted_u8(extract_ct(&ciphertexts, 7))   // size_1
            .encrypted_u8(extract_ct(&ciphertexts, 8))   // size_2
            .encrypted_u8(extract_ct(&ciphertexts, 9))   // size_3
            .encrypted_u8(extract_ct(&ciphertexts, 10))  // size_4
            .encrypted_u8(extract_ct(&ciphertexts, 11))  // size_5
            .x25519_pubkey(observer_pubkey)
            .build();

        let body_pda = ctx.accounts.celestial_body.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitPlanetCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: body_pda,
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_planet")]
    pub fn init_planet_callback(
        ctx: Context<InitPlanetCallback>,
        output: SignedComputationOutputs<InitPlanetOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;
        planet.enc_pubkey = enc_state.encryption_key;
        planet.enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        planet.last_updated_slot = Clock::get()?.slot;

        emit!(InitPlanetEvent {
            encrypted_hash_0: revealed.ciphertexts[0],
            encrypted_hash_1: revealed.ciphertexts[1],
            encrypted_hash_2: revealed.ciphertexts[2],
            encrypted_hash_3: revealed.ciphertexts[3],
            encrypted_valid: revealed.ciphertexts[4],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue init_spawn_planet
    // Packed params: ciphertexts = 16 * 32 bytes
    // -----------------------------------------------------------------------

    pub fn queue_init_spawn_planet(
        ctx: Context<QueueInitSpawnPlanet>,
        computation_offset: u64,
        planet_hash: [u8; 32],
        // 16 ciphertexts packed: x, y, game_id, 9 thresholds, 4 player_key parts
        ciphertexts: Vec<u8>,
        pubkey: [u8; 32],
        nonce: u128,
        observer_pubkey: [u8; 32],
    ) -> Result<()> {
        require!(ciphertexts.len() == 16 * 32, ErrorCode::InvalidSpawnValidation);

        let player = &ctx.accounts.player;
        require!(!player.has_spawned, ErrorCode::AlreadySpawned);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        let body = &mut ctx.accounts.celestial_body;
        body.planet_hash = planet_hash;
        body.last_updated_slot = clock.slot;
        body.last_flushed_slot = clock.slot;

        let pending = &mut ctx.accounts.pending_moves;
        pending.game_id = game.game_id;
        pending.planet_hash = planet_hash;
        pending.move_count = 0;
        pending.moves = Vec::new();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(extract_ct(&ciphertexts, 0))   // x
            .encrypted_u64(extract_ct(&ciphertexts, 1))   // y
            .encrypted_u64(extract_ct(&ciphertexts, 2))   // game_id
            .encrypted_u8(extract_ct(&ciphertexts, 3))    // dead_space
            .encrypted_u8(extract_ct(&ciphertexts, 4))    // planet
            .encrypted_u8(extract_ct(&ciphertexts, 5))    // quasar
            .encrypted_u8(extract_ct(&ciphertexts, 6))    // spacetime
            .encrypted_u8(extract_ct(&ciphertexts, 7))    // s1
            .encrypted_u8(extract_ct(&ciphertexts, 8))    // s2
            .encrypted_u8(extract_ct(&ciphertexts, 9))    // s3
            .encrypted_u8(extract_ct(&ciphertexts, 10))   // s4
            .encrypted_u8(extract_ct(&ciphertexts, 11))   // s5
            .encrypted_u64(extract_ct(&ciphertexts, 12))  // player_key_0
            .encrypted_u64(extract_ct(&ciphertexts, 13))  // player_key_1
            .encrypted_u64(extract_ct(&ciphertexts, 14))  // player_key_2
            .encrypted_u64(extract_ct(&ciphertexts, 15))  // player_key_3
            .x25519_pubkey(observer_pubkey)
            .build();

        let player_pda = ctx.accounts.player.key();
        let body_pda = ctx.accounts.celestial_body.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitSpawnPlanetCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: player_pda,
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: body_pda,
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_spawn_planet")]
    pub fn init_spawn_planet_callback(
        ctx: Context<InitSpawnPlanetCallback>,
        output: SignedComputationOutputs<InitSpawnPlanetOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;
        planet.enc_pubkey = enc_state.encryption_key;
        planet.enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        planet.last_updated_slot = Clock::get()?.slot;

        ctx.accounts.player.has_spawned = true;

        emit!(InitSpawnPlanetEvent {
            encrypted_hash_0: revealed.ciphertexts[0],
            encrypted_hash_1: revealed.ciphertexts[1],
            encrypted_hash_2: revealed.ciphertexts[2],
            encrypted_hash_3: revealed.ciphertexts[3],
            encrypted_valid: revealed.ciphertexts[4],
            encrypted_spawn_valid: revealed.ciphertexts[5],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue process_move
    // state_cts = 19 * 32 bytes, move_cts = 13 * 32 bytes
    // -----------------------------------------------------------------------

    pub fn queue_process_move(
        ctx: Context<QueueProcessMove>,
        computation_offset: u64,
        state_cts: Vec<u8>,       // 19 * 32 = 608 bytes
        state_pubkey: [u8; 32],
        state_nonce: u128,
        move_cts: Vec<u8>,        // 13 * 32 = 416 bytes
        move_pubkey: [u8; 32],
        move_nonce: u128,
        observer_pubkey: [u8; 32],
    ) -> Result<()> {
        require!(state_cts.len() == 19 * 32, ErrorCode::InvalidMoveInput);
        require!(move_cts.len() == 13 * 32, ErrorCode::InvalidMoveInput);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        require!(
            ctx.accounts.target_pending.moves.len() < MAX_PENDING_MOVES,
            ErrorCode::TooManyPendingMoves
        );

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // First Enc<Shared, PlanetState>
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(state_pubkey)
            .plaintext_u128(state_nonce);
        builder = append_planet_state_args(builder, &state_cts);

        // Second Enc<Shared, ProcessMoveInput>
        builder = builder
            .x25519_pubkey(move_pubkey)
            .plaintext_u128(move_nonce)
            .encrypted_u64(extract_ct(&move_cts, 0))   // player_key_0
            .encrypted_u64(extract_ct(&move_cts, 1))   // player_key_1
            .encrypted_u64(extract_ct(&move_cts, 2))   // player_key_2
            .encrypted_u64(extract_ct(&move_cts, 3))   // player_key_3
            .encrypted_u64(extract_ct(&move_cts, 4))   // ships_to_send
            .encrypted_u64(extract_ct(&move_cts, 5))   // metal_to_send
            .encrypted_u64(extract_ct(&move_cts, 6))   // source_x
            .encrypted_u64(extract_ct(&move_cts, 7))   // source_y
            .encrypted_u64(extract_ct(&move_cts, 8))   // target_x
            .encrypted_u64(extract_ct(&move_cts, 9))   // target_y
            .encrypted_u64(extract_ct(&move_cts, 10))  // current_slot
            .encrypted_u64(extract_ct(&move_cts, 11))  // game_speed
            .encrypted_u64(extract_ct(&move_cts, 12))  // last_updated_slot
            .x25519_pubkey(observer_pubkey);

        let args = builder.build();

        let source_body_pda = ctx.accounts.source_body.key();
        let target_pending_pda = ctx.accounts.target_pending.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ProcessMoveCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: source_body_pda,
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: target_pending_pda,
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "process_move")]
    pub fn process_move_callback(
        ctx: Context<ProcessMoveCallback>,
        output: SignedComputationOutputs<ProcessMoveOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let enc_state = &o.field_0.field_0;
        let enc_move_data = &o.field_0.field_1;
        let revealed = &o.field_0.field_2;

        let source = &mut ctx.accounts.source_body;
        source.enc_pubkey = enc_state.encryption_key;
        source.enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            source.enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        source.last_updated_slot = Clock::get()?.slot;

        let target_pending = &mut ctx.accounts.target_pending;
        let new_move = EncryptedPendingMove {
            active: true,
            landing_slot: Clock::get()?.slot,
            enc_pubkey: enc_move_data.encryption_key,
            enc_nonce: enc_move_data.nonce.to_le_bytes(),
            enc_ciphertexts: [
                enc_move_data.ciphertexts[0],
                enc_move_data.ciphertexts[1],
                enc_move_data.ciphertexts[2],
                enc_move_data.ciphertexts[3],
                enc_move_data.ciphertexts[4],
                enc_move_data.ciphertexts[5],
            ],
        };
        target_pending.moves.push(new_move);
        target_pending.move_count = target_pending.moves.len() as u8;

        emit!(ProcessMoveEvent {
            encrypted_landing_slot: revealed.ciphertexts[0],
            encrypted_surviving_ships: revealed.ciphertexts[1],
            encrypted_valid: revealed.ciphertexts[2],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue flush_planet
    // state_cts = 19 * 32, flush_cts = 10 * 32
    // -----------------------------------------------------------------------

    pub fn queue_flush_planet(
        ctx: Context<QueueFlushPlanet>,
        computation_offset: u64,
        _move_index: u8,
        state_cts: Vec<u8>,      // 19 * 32
        state_pubkey: [u8; 32],
        state_nonce: u128,
        flush_cts: Vec<u8>,      // 10 * 32
        flush_pubkey: [u8; 32],
        flush_nonce: u128,
    ) -> Result<()> {
        require!(state_cts.len() == 19 * 32, ErrorCode::FlushFailed);
        require!(flush_cts.len() == 10 * 32, ErrorCode::FlushFailed);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut builder = ArgBuilder::new()
            .x25519_pubkey(state_pubkey)
            .plaintext_u128(state_nonce);
        builder = append_planet_state_args(builder, &state_cts);

        builder = builder
            .x25519_pubkey(flush_pubkey)
            .plaintext_u128(flush_nonce)
            .encrypted_u64(extract_ct(&flush_cts, 0))  // current_slot
            .encrypted_u64(extract_ct(&flush_cts, 1))  // game_speed
            .encrypted_u64(extract_ct(&flush_cts, 2))  // last_updated_slot
            .encrypted_u64(extract_ct(&flush_cts, 3))  // move_ships
            .encrypted_u64(extract_ct(&flush_cts, 4))  // move_metal
            .encrypted_u64(extract_ct(&flush_cts, 5))  // move_attacker_0
            .encrypted_u64(extract_ct(&flush_cts, 6))  // move_attacker_1
            .encrypted_u64(extract_ct(&flush_cts, 7))  // move_attacker_2
            .encrypted_u64(extract_ct(&flush_cts, 8))  // move_attacker_3
            .encrypted_u8(extract_ct(&flush_cts, 9));  // move_has_landed

        let args = builder.build();

        let body_pda = ctx.accounts.celestial_body.key();
        let pending_pda = ctx.accounts.pending_moves.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![FlushPlanetCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: body_pda,
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: pending_pda,
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "flush_planet")]
    pub fn flush_planet_callback(
        ctx: Context<FlushPlanetCallback>,
        output: SignedComputationOutputs<FlushPlanetOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;
        planet.enc_pubkey = enc_state.encryption_key;
        planet.enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        let slot = Clock::get()?.slot;
        planet.last_updated_slot = slot;
        planet.last_flushed_slot = slot;

        let pending = &mut ctx.accounts.pending_moves;
        if !pending.moves.is_empty() {
            pending.moves.remove(0);
            pending.move_count = pending.moves.len() as u8;
        }

        emit!(FlushPlanetEvent {
            planet_hash: planet.planet_hash,
            encrypted_success: revealed.ciphertexts[0],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue upgrade_planet
    // state_cts = 19 * 32, upgrade_cts = 8 * 32
    // -----------------------------------------------------------------------

    pub fn queue_upgrade_planet(
        ctx: Context<QueueUpgradePlanet>,
        computation_offset: u64,
        state_cts: Vec<u8>,       // 19 * 32
        state_pubkey: [u8; 32],
        state_nonce: u128,
        upgrade_cts: Vec<u8>,     // 8 * 32
        upgrade_pubkey: [u8; 32],
        upgrade_nonce: u128,
    ) -> Result<()> {
        require!(state_cts.len() == 19 * 32, ErrorCode::UpgradeFailed);
        require!(upgrade_cts.len() == 8 * 32, ErrorCode::UpgradeFailed);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut builder = ArgBuilder::new()
            .x25519_pubkey(state_pubkey)
            .plaintext_u128(state_nonce);
        builder = append_planet_state_args(builder, &state_cts);

        builder = builder
            .x25519_pubkey(upgrade_pubkey)
            .plaintext_u128(upgrade_nonce)
            .encrypted_u64(extract_ct(&upgrade_cts, 0))  // player_key_0
            .encrypted_u64(extract_ct(&upgrade_cts, 1))  // player_key_1
            .encrypted_u64(extract_ct(&upgrade_cts, 2))  // player_key_2
            .encrypted_u64(extract_ct(&upgrade_cts, 3))  // player_key_3
            .encrypted_u8(extract_ct(&upgrade_cts, 4))   // focus
            .encrypted_u64(extract_ct(&upgrade_cts, 5))  // current_slot
            .encrypted_u64(extract_ct(&upgrade_cts, 6))  // game_speed
            .encrypted_u64(extract_ct(&upgrade_cts, 7)); // last_updated_slot

        let args = builder.build();

        let body_pda = ctx.accounts.celestial_body.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![UpgradePlanetCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: body_pda,
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "upgrade_planet")]
    pub fn upgrade_planet_callback(
        ctx: Context<UpgradePlanetCallback>,
        output: SignedComputationOutputs<UpgradePlanetOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;
        planet.enc_pubkey = enc_state.encryption_key;
        planet.enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        planet.last_updated_slot = Clock::get()?.slot;

        emit!(UpgradePlanetEvent {
            planet_hash: planet.planet_hash,
            encrypted_success: revealed.ciphertexts[0],
            encrypted_new_level: revealed.ciphertexts[1],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Broadcast
    // -----------------------------------------------------------------------

    pub fn broadcast(
        ctx: Context<Broadcast>,
        _game_id: u64,
        x: i64,
        y: i64,
        planet_hash: [u8; 32],
    ) -> Result<()> {
        let game = &ctx.accounts.game;
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

    pub fn cleanup_game(ctx: Context<CleanupGame>, _game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot > game.end_slot, ErrorCode::GameNotEnded);
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
}

// ===========================================================================
// Account Structures
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
pub struct EncryptedCelestialBody {
    pub planet_hash: [u8; 32],
    pub last_updated_slot: u64,
    pub last_flushed_slot: u64,
    pub enc_pubkey: [u8; 32],
    pub enc_nonce: [u8; 16],
    pub enc_ciphertexts: [[u8; 32]; 19],
}

impl EncryptedCelestialBody {
    pub const MAX_SIZE: usize = 8
        + 32   // planet_hash
        + 8    // last_updated_slot
        + 8    // last_flushed_slot
        + 32   // enc_pubkey
        + 16   // enc_nonce
        + (19 * 32); // enc_ciphertexts
}

#[account]
pub struct EncryptedPendingMoves {
    pub game_id: u64,
    pub planet_hash: [u8; 32],
    pub move_count: u8,
    pub moves: Vec<EncryptedPendingMove>,
}

impl EncryptedPendingMoves {
    pub const MAX_SIZE: usize = 8
        + 8    // game_id
        + 32   // planet_hash
        + 1    // move_count
        + 4 + (MAX_PENDING_MOVES * EncryptedPendingMove::SIZE);
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EncryptedPendingMove {
    pub active: bool,
    pub landing_slot: u64,
    pub enc_pubkey: [u8; 32],
    pub enc_nonce: [u8; 16],
    pub enc_ciphertexts: [[u8; 32]; 6],
}

impl EncryptedPendingMove {
    pub const SIZE: usize = 1 + 8 + 32 + 16 + (6 * 32);
}

// ===========================================================================
// Enums
// ===========================================================================

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
pub struct InitPlanetEvent {
    pub encrypted_hash_0: [u8; 32],
    pub encrypted_hash_1: [u8; 32],
    pub encrypted_hash_2: [u8; 32],
    pub encrypted_hash_3: [u8; 32],
    pub encrypted_valid: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct InitSpawnPlanetEvent {
    pub encrypted_hash_0: [u8; 32],
    pub encrypted_hash_1: [u8; 32],
    pub encrypted_hash_2: [u8; 32],
    pub encrypted_hash_3: [u8; 32],
    pub encrypted_valid: [u8; 32],
    pub encrypted_spawn_valid: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct ProcessMoveEvent {
    pub encrypted_landing_slot: [u8; 32],
    pub encrypted_surviving_ships: [u8; 32],
    pub encrypted_valid: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct FlushPlanetEvent {
    pub planet_hash: [u8; 32],
    pub encrypted_success: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct UpgradePlanetEvent {
    pub planet_hash: [u8; 32],
    pub encrypted_success: [u8; 32],
    pub encrypted_new_level: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
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
    #[msg("Too many pending moves on target planet")]
    TooManyPendingMoves,
    #[msg("Invalid init planet result")]
    InvalidInitPlanet,
    #[msg("Invalid spawn validation")]
    InvalidSpawnValidation,
    #[msg("Invalid move input")]
    InvalidMoveInput,
    #[msg("Flush failed")]
    FlushFailed,
    #[msg("Upgrade failed")]
    UpgradeFailed,
}

// ===========================================================================
// Account Contexts
// ===========================================================================

// --- Computation Definition Initializers ---

#[init_computation_definition_accounts("init_planet", payer)]
#[derive(Accounts)]
pub struct InitInitPlanetCompDef<'info> {
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

#[init_computation_definition_accounts("init_spawn_planet", payer)]
#[derive(Accounts)]
pub struct InitInitSpawnPlanetCompDef<'info> {
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

#[init_computation_definition_accounts("process_move", payer)]
#[derive(Accounts)]
pub struct InitProcessMoveCompDef<'info> {
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

#[init_computation_definition_accounts("flush_planet", payer)]
#[derive(Accounts)]
pub struct InitFlushPlanetCompDef<'info> {
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

#[init_computation_definition_accounts("upgrade_planet", payer)]
#[derive(Accounts)]
pub struct InitUpgradePlanetCompDef<'info> {
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
    pub server: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
}

// --- Queue Init Planet ---

#[queue_computation_accounts("init_planet", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, planet_hash: [u8; 32])]
pub struct QueueInitPlanet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"game", game.game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Box<Account<'info, Game>>,
    #[account(
        init,
        payer = payer,
        space = EncryptedCelestialBody::MAX_SIZE,
        seeds = [b"planet", game.game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
    #[account(
        init,
        payer = payer,
        space = EncryptedPendingMoves::MAX_SIZE,
        seeds = [b"moves", game.game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub pending_moves: Box<Account<'info, EncryptedPendingMoves>>,
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
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_planet")]
#[derive(Accounts)]
pub struct InitPlanetCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
}

// --- Queue Init Spawn Planet ---

#[queue_computation_accounts("init_spawn_planet", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, planet_hash: [u8; 32])]
pub struct QueueInitSpawnPlanet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"game", game.game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Box<Account<'info, Game>>,
    #[account(
        mut,
        seeds = [b"player", game.game_id.to_le_bytes().as_ref(), payer.key().as_ref()],
        bump,
        constraint = player.owner == payer.key() @ ErrorCode::InvalidSpawnValidation,
    )]
    pub player: Box<Account<'info, Player>>,
    #[account(
        init,
        payer = payer,
        space = EncryptedCelestialBody::MAX_SIZE,
        seeds = [b"planet", game.game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
    #[account(
        init,
        payer = payer,
        space = EncryptedPendingMoves::MAX_SIZE,
        seeds = [b"moves", game.game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub pending_moves: Box<Account<'info, EncryptedPendingMoves>>,
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
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_SPAWN_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_spawn_planet")]
#[derive(Accounts)]
pub struct InitSpawnPlanetCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_SPAWN_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut)]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
}

// --- Queue Process Move ---

#[queue_computation_accounts("process_move", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueProcessMove<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"game", game.game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Box<Account<'info, Game>>,
    #[account(mut)]
    pub source_body: Box<Account<'info, EncryptedCelestialBody>>,
    #[account(mut)]
    pub target_pending: Box<Account<'info, EncryptedPendingMoves>>,
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
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_MOVE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("process_move")]
#[derive(Accounts)]
pub struct ProcessMoveCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_MOVE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub source_body: Box<Account<'info, EncryptedCelestialBody>>,
    #[account(mut)]
    pub target_pending: Box<Account<'info, EncryptedPendingMoves>>,
}

// --- Queue Flush Planet ---

#[queue_computation_accounts("flush_planet", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueFlushPlanet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
    #[account(mut)]
    pub pending_moves: Box<Account<'info, EncryptedPendingMoves>>,
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
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FLUSH_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("flush_planet")]
#[derive(Accounts)]
pub struct FlushPlanetCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FLUSH_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
    #[account(mut)]
    pub pending_moves: Box<Account<'info, EncryptedPendingMoves>>,
}

// --- Queue Upgrade Planet ---

#[queue_computation_accounts("upgrade_planet", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueUpgradePlanet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"game", game.game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Box<Account<'info, Game>>,
    #[account(mut)]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
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
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPGRADE_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("upgrade_planet")]
#[derive(Accounts)]
pub struct UpgradePlanetCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPGRADE_PLANET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub celestial_body: Box<Account<'info, EncryptedCelestialBody>>,
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
    pub celestial_body: Account<'info, EncryptedCelestialBody>,
    #[account(
        mut,
        seeds = [b"moves", game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
        close = closer,
    )]
    pub pending_moves: Account<'info, EncryptedPendingMoves>,
}
