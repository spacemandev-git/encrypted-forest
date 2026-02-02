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

declare_id!("8BscA3fCxbBTkNCNHSopiQ84Q4A58YYzvQkqwbUM7wqA");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PLANET_STATE_FIELDS: usize = 3;   // Pack<[u32;15]> = 60 bytes => ceil(60/26) = 3 FEs
const PENDING_MOVE_DATA_FIELDS: usize = 4;

// Base size for PendingMovesMetadata:
// discriminator(8) + game_id(8) + planet_hash(32) + next_move_id(8) + move_count(2) +
// queued_count(1) + queued_landing_slots(8 * 8 = 64) + vec_prefix(4)
const PENDING_MOVES_META_BASE_SIZE: usize = 8 + 8 + 32 + 8 + 2 + 1 + 64 + 4;
// Each PendingMoveEntry: landing_slot(8) + move_id(8)
const PENDING_MOVE_ENTRY_SIZE: usize = 16;
// Max queued moves per planet (requires one flush call per move)
const MAX_QUEUED_CALLBACKS: usize = 8;

// ---------------------------------------------------------------------------
// Account byte offsets for reading encrypted data from on-chain accounts
// ---------------------------------------------------------------------------

// PendingMoveAccount layout (after 8-byte discriminator):
//   game_id(8) + planet_hash(32) + move_id(8) + landing_slot(8) + payer(32) + populated(1) = 89 bytes
//   enc_nonce(16) starts at offset 97
//   enc_ciphertexts[4*32] at offset 113
const MOVE_ACCOUNT_ENC_NONCE_OFFSET: usize = 97;
const MOVE_CT_OFFSET: u32 = 113;

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------
pub fn compute_planet_hash(x: i64, y: i64, game_id: u64, hash_rounds: u16) -> [u8; 32] {
    let mut input = [0u8; 24];
    input[0..8].copy_from_slice(&x.to_le_bytes());
    input[8..16].copy_from_slice(&y.to_le_bytes());
    input[16..24].copy_from_slice(&game_id.to_le_bytes());
    let mut hash = *blake3::hash(&input).as_bytes();
    for _ in 1..hash_rounds {
        hash = *blake3::hash(&hash).as_bytes();
    }
    hash
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
        hash_rounds: u16,
    ) -> Result<()> {
        require!(map_diameter > 0, ErrorCode::InvalidMapDiameter);
        require!(game_speed > 0, ErrorCode::InvalidGameSpeed);
        require!(end_slot > start_slot, ErrorCode::InvalidTimeRange);
        require!(hash_rounds >= 1, ErrorCode::InvalidHashRounds);
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
        game.hash_rounds = hash_rounds;

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
    // Encrypted: CoordInput (x, y) = 2 * 32 bytes
    // Plaintext: game_id + 9 thresholds sourced from Game account
    // Output: (PlanetState, InitPlanetRevealed)
    // -----------------------------------------------------------------------

    pub fn queue_init_planet(
        ctx: Context<QueueInitPlanet>,
        computation_offset: u64,
        planet_hash: [u8; 32],
        // 2 ciphertexts: x, y (the fog-of-war secret)
        ciphertexts: Vec<u8>,
        pubkey: [u8; 32],
        nonce: u128,
        observer_pubkey: [u8; 32],
    ) -> Result<()> {
        require!(ciphertexts.len() == 2 * 32, ErrorCode::InvalidInitPlanet);

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
        pending.next_move_id = 0;
        pending.move_count = 0;
        pending.queued_count = 0;
        pending.queued_landing_slots = [0u64; 8];
        pending.moves = Vec::new();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let nt = &game.noise_thresholds;
        let args = ArgBuilder::new()
            // Enc<Shared, CoordInput>: pubkey + nonce + 2 encrypted fields
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(extract_ct(&ciphertexts, 0))  // x
            .encrypted_u64(extract_ct(&ciphertexts, 1))  // y
            // Plaintext params from Game account
            .plaintext_u64(game.game_id)
            .plaintext_u64(nt.dead_space_threshold as u64)
            .plaintext_u64(nt.planet_threshold as u64)
            .plaintext_u64(nt.quasar_threshold as u64)
            .plaintext_u64(nt.spacetime_rip_threshold as u64)
            .plaintext_u64(nt.size_threshold_1 as u64)
            .plaintext_u64(nt.size_threshold_2 as u64)
            .plaintext_u64(nt.size_threshold_3 as u64)
            .plaintext_u64(nt.size_threshold_4 as u64)
            .plaintext_u64(nt.size_threshold_5 as u64)
            // Planet key (Shared handle for PlanetState output encryption)
            .x25519_pubkey(pubkey)
            .plaintext_u128(0u128)
            // Observer (Shared handle for revealed output encryption)
            .x25519_pubkey(observer_pubkey)
            .plaintext_u128(0u128)
            .build();

        let body_pda = ctx.accounts.celestial_body.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
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
            Err(e) => {
                msg!("init_planet verify_output FAILED: {:?}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Output tuple: (Enc<Shared, PlanetState>, Enc<Shared, InitPlanetRevealed>)
        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;

        // Write state section
        planet.state_enc_pubkey = enc_state.encryption_key;
        planet.state_enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.state_enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }

        planet.last_updated_slot = Clock::get()?.slot;

        emit!(InitPlanetEvent {
            encrypted_planet_hash: revealed.ciphertexts[0],
            encrypted_valid: revealed.ciphertexts[1],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue init_spawn_planet
    // Encrypted: SpawnInput (x, y, player_id, source_planet_id) = 4 * 32 bytes
    // Plaintext: game_id + 9 thresholds sourced from Game account
    // Output: (PlanetState, SpawnPlanetRevealed)
    // -----------------------------------------------------------------------

    pub fn queue_init_spawn_planet(
        ctx: Context<QueueInitSpawnPlanet>,
        computation_offset: u64,
        planet_hash: [u8; 32],
        // 4 ciphertexts: x, y, player_id, source_planet_id
        ciphertexts: Vec<u8>,
        pubkey: [u8; 32],
        nonce: u128,
        observer_pubkey: [u8; 32],
    ) -> Result<()> {
        require!(ciphertexts.len() == 4 * 32, ErrorCode::InvalidSpawnValidation);

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
        pending.next_move_id = 0;
        pending.move_count = 0;
        pending.moves = Vec::new();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let nt = &game.noise_thresholds;
        let args = ArgBuilder::new()
            // Enc<Shared, SpawnInput>: pubkey + nonce + 4 encrypted fields
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(extract_ct(&ciphertexts, 0))   // x
            .encrypted_u64(extract_ct(&ciphertexts, 1))   // y
            .encrypted_u32(extract_ct(&ciphertexts, 2))   // player_id
            .encrypted_u32(extract_ct(&ciphertexts, 3))   // source_planet_id
            // Plaintext params from Game account
            .plaintext_u64(game.game_id)
            .plaintext_u64(nt.dead_space_threshold as u64)
            .plaintext_u64(nt.planet_threshold as u64)
            .plaintext_u64(nt.quasar_threshold as u64)
            .plaintext_u64(nt.spacetime_rip_threshold as u64)
            .plaintext_u64(nt.size_threshold_1 as u64)
            .plaintext_u64(nt.size_threshold_2 as u64)
            .plaintext_u64(nt.size_threshold_3 as u64)
            .plaintext_u64(nt.size_threshold_4 as u64)
            .plaintext_u64(nt.size_threshold_5 as u64)
            // Planet key (Shared handle for PlanetState output encryption)
            .x25519_pubkey(pubkey)
            .plaintext_u128(0u128)
            // Observer (Shared handle for revealed output encryption)
            .x25519_pubkey(observer_pubkey)
            .plaintext_u128(0u128)
            .build();

        let player_pda = ctx.accounts.player.key();
        let body_pda = ctx.accounts.celestial_body.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
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
            Err(e) => {
                msg!("init_spawn_planet verify_output FAILED: {:?}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Output tuple: (Enc<Shared, PlanetState>, Enc<Shared, SpawnPlanetRevealed>)
        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;

        // Write state section
        planet.state_enc_pubkey = enc_state.encryption_key;
        planet.state_enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.state_enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }

        planet.last_updated_slot = Clock::get()?.slot;

        ctx.accounts.player.has_spawned = true;

        emit!(InitSpawnPlanetEvent {
            encrypted_planet_hash: revealed.ciphertexts[0],
            encrypted_valid: revealed.ciphertexts[1],
            encrypted_spawn_valid: revealed.ciphertexts[2],
            encryption_key: revealed.encryption_key,
            nonce: revealed.nonce.to_le_bytes(),
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue process_move
    // Planet state + move input passed inline as ciphertexts.
    // move_cts = 2 * 32 bytes (Pack<[u32; 8]> = 2 FEs).
    // Output: (PlanetState, PendingMoveData, MoveRevealed)
    // -----------------------------------------------------------------------

    pub fn queue_process_move(
        ctx: Context<QueueProcessMove>,
        computation_offset: u64,
        landing_slot: u64,        // public: client-computed, MPC-validated
        current_ships: u64,       // plaintext: client-computed lazy resource generation
        current_metal: u64,       // plaintext: client-computed lazy resource generation
        move_cts: Vec<u8>,        // 2 * 32 = 64 bytes (Pack<[u32;8]>)
        move_pubkey: [u8; 32],
        move_nonce: u128,
    ) -> Result<()> {
        require!(move_cts.len() == 2 * 32, ErrorCode::InvalidMoveInput);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        // landing_slot must be in the future
        require!(landing_slot > clock.slot, ErrorCode::InvalidMoveInput);

        // Enforce: source planet must have all landed moves flushed
        let source_pending = &ctx.accounts.source_pending;
        if !source_pending.moves.is_empty() {
            require!(
                source_pending.moves[0].landing_slot > clock.slot,
                ErrorCode::MustFlushFirst
            );
        }

        // Directly insert PendingMoveEntry into target's moves Vec (sorted by landing_slot).
        // This is done here (before MPC) so the callback only needs source_body + move_account.
        // The move_account.populated flag ensures flush skips moves with incomplete MPC.
        let target_pending = &mut ctx.accounts.target_pending;
        let move_id = target_pending.next_move_id;
        target_pending.next_move_id = move_id + 1;

        let entry = PendingMoveEntry { landing_slot, move_id };
        let pos = target_pending.moves
            .binary_search_by_key(&landing_slot, |e| e.landing_slot)
            .unwrap_or_else(|e| e);
        target_pending.moves.insert(pos, entry);
        target_pending.move_count = target_pending.moves.len() as u16;

        // Initialize PendingMoveAccount (enc data written by MPC callback)
        let move_acc = &mut ctx.accounts.move_account;
        move_acc.game_id = target_pending.game_id;
        move_acc.planet_hash = target_pending.planet_hash;
        move_acc.move_id = move_id;
        move_acc.landing_slot = landing_slot;
        move_acc.payer = ctx.accounts.payer.key();
        move_acc.populated = false; // set to true by callback after MPC completes

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Enc<Shared, PlanetState> — all inline
        // planet_input.owner re-encrypts output (no separate planet_key needed)
        let source = &ctx.accounts.source_body;
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(source.state_enc_pubkey)
            .plaintext_u128(u128::from_le_bytes(source.state_enc_nonce))
            .encrypted_u32(source.state_enc_ciphertexts[0])  // Pack FE 0
            .encrypted_u32(source.state_enc_ciphertexts[1])  // Pack FE 1
            .encrypted_u32(source.state_enc_ciphertexts[2]); // Pack FE 2

        // Enc<Shared, ProcessMoveInputPacked> — all inline (2 packed FEs)
        // move_input.owner encrypts revealed output (no separate observer needed)
        builder = builder
            .x25519_pubkey(move_pubkey)
            .plaintext_u128(move_nonce)
            .encrypted_u32(extract_ct(&move_cts, 0))  // Pack FE 0
            .encrypted_u32(extract_ct(&move_cts, 1)); // Pack FE 1

        // Plaintext params: lazy-generation computed client-side
        // NOTE: Use plaintext_u64 (not u32) because Arcium allocates comp account space
        // based on the comp_def parameter types. u32 reserves less space than actual storage.
        builder = builder
            .plaintext_u64(current_ships)
            .plaintext_u64(current_metal)
            .plaintext_u64(clock.slot)
            .plaintext_u64(game.game_speed);

        let args = builder.build();

        let source_body_pda = ctx.accounts.source_body.key();
        let move_account_pda = ctx.accounts.move_account.key();

        let callbacks = vec![ProcessMoveCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: source_body_pda,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: move_account_pda,
                    is_writable: true,
                },
            ],
        )?];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            callbacks,
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
            Err(e) => {
                msg!("process_move verify_output FAILED: {:?}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Output tuple: (Enc<Shared, PlanetState>, Enc<Mxe, PendingMoveData>)
        let enc_state = &o.field_0.field_0;
        let enc_move_data = &o.field_0.field_1;

        // Update source planet
        let source = &mut ctx.accounts.source_body;
        source.state_enc_pubkey = enc_state.encryption_key;
        source.state_enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            source.state_enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        source.last_updated_slot = Clock::get()?.slot;

        // Store Enc<Mxe, PendingMoveData> in the PendingMoveAccount and mark populated
        let move_acc = &mut ctx.accounts.move_account;
        move_acc.enc_nonce = enc_move_data.nonce;
        let mut ci = 0;
        while ci < PENDING_MOVE_DATA_FIELDS {
            move_acc.enc_ciphertexts[ci] = enc_move_data.ciphertexts[ci];
            ci += 1;
        }
        move_acc.populated = true;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue flush_planet (single move)
    // Planet state + move data passed inline as ciphertexts.
    // flush_timing_cts = 4 * 32 (FlushTimingInput: current_slot, game_speed, last_updated_slot, flush_count)
    // Output: Enc<Shared, PlanetState>
    // -----------------------------------------------------------------------

    pub fn queue_flush_planet(
        ctx: Context<QueueFlushPlanet>,
        computation_offset: u64,
        flush_count: u8,
        flush_cts: Vec<u8>,      // 4 * 32 (FlushTimingInput)
        flush_pubkey: [u8; 32],
        flush_nonce: u128,
    ) -> Result<()> {
        require!(flush_cts.len() == 4 * 32, ErrorCode::FlushFailed);
        require!(flush_count == 1, ErrorCode::FlushFailed);
        require!(
            ctx.remaining_accounts.len() >= 1,
            ErrorCode::FlushFailed
        );

        let clock = Clock::get()?;
        let pending = &ctx.accounts.pending_moves;

        // Verify that the first move has landed
        require!(!pending.moves.is_empty(), ErrorCode::FlushFailed);
        require!(
            pending.moves[0].landing_slot <= clock.slot,
            ErrorCode::FlushFailed
        );

        // Validate remaining_accounts[0] is the correct PendingMoveAccount PDA
        let entry = &pending.moves[0];
        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                b"move",
                pending.game_id.to_le_bytes().as_ref(),
                pending.planet_hash.as_ref(),
                entry.move_id.to_le_bytes().as_ref(),
            ],
            ctx.program_id,
        );
        require!(
            ctx.remaining_accounts[0].key() == expected_pda,
            ErrorCode::FlushFailed
        );

        // Ensure move_account has been populated by the MPC callback
        {
            let acc_data = ctx.remaining_accounts[0].try_borrow_data()?;
            let populated = acc_data[96]; // offset of `populated` field
            require!(populated == 1, ErrorCode::FlushFailed);
        }

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Enc<Shared, PlanetState> — all inline
        let body = &ctx.accounts.celestial_body;
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(body.state_enc_pubkey)
            .plaintext_u128(u128::from_le_bytes(body.state_enc_nonce))
            .encrypted_u32(body.state_enc_ciphertexts[0])  // Pack FE 0
            .encrypted_u32(body.state_enc_ciphertexts[1])  // Pack FE 1
            .encrypted_u32(body.state_enc_ciphertexts[2]); // Pack FE 2

        // Enc<Mxe, PendingMoveData> — nonce + 4 ciphertexts read from PendingMoveAccount
        {
            let acc_data = ctx.remaining_accounts[0].try_borrow_data()?;
            let nonce_bytes: [u8; 16] = acc_data[MOVE_ACCOUNT_ENC_NONCE_OFFSET..MOVE_ACCOUNT_ENC_NONCE_OFFSET + 16]
                .try_into()
                .map_err(|_| ErrorCode::FlushFailed)?;
            let mut move_cts = [[0u8; 32]; 4];
            for i in 0..4 {
                let start = MOVE_CT_OFFSET as usize + i * 32;
                move_cts[i].copy_from_slice(&acc_data[start..start + 32]);
            }
            drop(acc_data);
            builder = builder
                .plaintext_u128(u128::from_le_bytes(nonce_bytes))
                .encrypted_u32(move_cts[0])   // ships_arriving
                .encrypted_u32(move_cts[1])   // metal_arriving
                .encrypted_u32(move_cts[2])   // attacking_planet_id
                .encrypted_u32(move_cts[3]);  // attacking_player_id
        }

        // FlushTimingInput (4 fields: current_slot, game_speed, last_updated_slot, flush_count)
        // planet_input.owner re-encrypts output (no separate planet_key needed)
        builder = builder
            .x25519_pubkey(flush_pubkey)
            .plaintext_u128(flush_nonce)
            .encrypted_u32(extract_ct(&flush_cts, 0))  // current_slot
            .encrypted_u32(extract_ct(&flush_cts, 1))  // game_speed
            .encrypted_u32(extract_ct(&flush_cts, 2))  // last_updated_slot
            .encrypted_u32(extract_ct(&flush_cts, 3));  // flush_count

        let args = builder.build();

        let body_pda = ctx.accounts.celestial_body.key();
        let pending_pda = ctx.accounts.pending_moves.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
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
            Err(e) => {
                msg!("flush_planet verify_output FAILED: {:?}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Output: Enc<Shared, PlanetState> (single value, not tuple)
        let enc_state = &o.field_0;

        // Update planet
        let planet = &mut ctx.accounts.celestial_body;
        planet.state_enc_pubkey = enc_state.encryption_key;
        planet.state_enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.state_enc_ciphertexts[i] = enc_state.ciphertexts[i];
            i += 1;
        }
        let slot = Clock::get()?.slot;
        planet.last_updated_slot = slot;
        planet.last_flushed_slot = slot;

        // Remove the flushed move from front of sorted array
        let pending = &mut ctx.accounts.pending_moves;
        if !pending.moves.is_empty() && pending.moves[0].landing_slot <= slot {
            pending.moves.remove(0);
        }
        pending.move_count = pending.moves.len() as u16;

        emit!(FlushPlanetEvent {
            planet_hash: planet.planet_hash,
            flushed_count: 1,
        });

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queue upgrade_planet
    // Planet state + upgrade input passed inline as ciphertexts.
    // upgrade_cts = 6 * 32.
    // Output: (PlanetState, UpgradeRevealed)
    // -----------------------------------------------------------------------

    pub fn queue_upgrade_planet(
        ctx: Context<QueueUpgradePlanet>,
        computation_offset: u64,
        upgrade_cts: Vec<u8>,     // 6 * 32
        upgrade_pubkey: [u8; 32],
        upgrade_nonce: u128,
    ) -> Result<()> {
        require!(upgrade_cts.len() == 6 * 32, ErrorCode::UpgradeFailed);

        let game = &ctx.accounts.game;
        let clock = Clock::get()?;
        require!(clock.slot >= game.start_slot, ErrorCode::GameNotStarted);
        require!(clock.slot < game.end_slot, ErrorCode::GameEnded);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Enc<Shared, PlanetState> — all inline
        let body = &ctx.accounts.celestial_body;
        let mut builder = ArgBuilder::new()
            .x25519_pubkey(body.state_enc_pubkey)
            .plaintext_u128(u128::from_le_bytes(body.state_enc_nonce))
            .encrypted_u32(body.state_enc_ciphertexts[0])  // Pack FE 0
            .encrypted_u32(body.state_enc_ciphertexts[1])  // Pack FE 1
            .encrypted_u32(body.state_enc_ciphertexts[2]); // Pack FE 2

        // UpgradePlanetInput: 6 fields (player_id, focus, current_slot, game_speed, last_updated_slot, metal_upgrade_cost)
        builder = builder
            .x25519_pubkey(upgrade_pubkey)
            .plaintext_u128(upgrade_nonce)
            .encrypted_u32(extract_ct(&upgrade_cts, 0))  // player_id
            .encrypted_u32(extract_ct(&upgrade_cts, 1))  // focus
            .encrypted_u32(extract_ct(&upgrade_cts, 2))  // current_slot
            .encrypted_u32(extract_ct(&upgrade_cts, 3))  // game_speed
            .encrypted_u32(extract_ct(&upgrade_cts, 4))  // last_updated_slot
            .encrypted_u32(extract_ct(&upgrade_cts, 5)); // metal_upgrade_cost
        // planet_input.owner re-encrypts output (no separate planet_key needed)

        let args = builder.build();

        let body_pda = ctx.accounts.celestial_body.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
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
            Err(e) => {
                msg!("upgrade_planet verify_output FAILED: {:?}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        // Output tuple: (Enc<Shared, PlanetState>, Enc<Shared, UpgradeRevealed>)
        let enc_state = &o.field_0.field_0;
        let revealed = &o.field_0.field_1;

        let planet = &mut ctx.accounts.celestial_body;

        // Write state section
        planet.state_enc_pubkey = enc_state.encryption_key;
        planet.state_enc_nonce = enc_state.nonce.to_le_bytes();
        let mut i = 0;
        while i < PLANET_STATE_FIELDS {
            planet.state_enc_ciphertexts[i] = enc_state.ciphertexts[i];
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
        let computed = compute_planet_hash(x, y, game.game_id, game.hash_rounds);
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
    /// Number of iterated BLAKE3 rounds for planet hash difficulty.
    pub hash_rounds: u16,
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
    // State section (144 bytes) -- Pack<[u32;15]> = 3 FEs
    pub state_enc_pubkey: [u8; 32],
    pub state_enc_nonce: [u8; 16],
    pub state_enc_ciphertexts: [[u8; 32]; PLANET_STATE_FIELDS],
}

impl EncryptedCelestialBody {
    pub const MAX_SIZE: usize = 8
        + 32   // planet_hash
        + 8    // last_updated_slot
        + 8    // last_flushed_slot
        // State section
        + 32   // state_enc_pubkey
        + 16   // state_enc_nonce
        + (PLANET_STATE_FIELDS * 32); // state_enc_ciphertexts (3 packed FEs)
}

/// Dynamic-size account tracking pending moves for a planet.
/// Sorted by landing_slot so front always has earliest-landing move.
/// Includes a fixed FIFO buffer for landing_slots awaiting callback.
#[account]
pub struct PendingMovesMetadata {
    pub game_id: u64,
    pub planet_hash: [u8; 32],
    pub next_move_id: u64,
    pub move_count: u16,
    /// FIFO buffer: queue_process_move pushes, process_move_callback pops.
    pub queued_count: u8,
    pub queued_landing_slots: [u64; 8],
    pub moves: Vec<PendingMoveEntry>,
}

impl PendingMovesMetadata {
    /// Base size (no entries). Grows by PENDING_MOVE_ENTRY_SIZE per move.
    pub const BASE_SIZE: usize = PENDING_MOVES_META_BASE_SIZE;
}

/// Entry in the sorted moves array.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PendingMoveEntry {
    pub landing_slot: u64,
    pub move_id: u64,
}

/// Individual move account (one per in-flight move).
/// PDA: ["move", game_id, planet_hash, move_id]
#[account]
pub struct PendingMoveAccount {
    pub game_id: u64,
    pub planet_hash: [u8; 32],
    pub move_id: u64,
    pub landing_slot: u64,
    pub payer: Pubkey,
    /// Set to true by the MPC callback once encrypted data is written.
    /// Flush skips moves where populated == false (MPC not yet complete).
    pub populated: bool,
    pub enc_nonce: u128,
    pub enc_ciphertexts: [[u8; 32]; 4],  // ships, metal, attacking_planet_id, attacking_player_id
}

impl PendingMoveAccount {
    pub const MAX_SIZE: usize = 8
        + 8    // game_id
        + 32   // planet_hash
        + 8    // move_id
        + 8    // landing_slot
        + 32   // payer
        + 1    // populated
        + 16   // enc_nonce
        + (4 * 32); // enc_ciphertexts
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
    pub encrypted_planet_hash: [u8; 32],
    pub encrypted_valid: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct InitSpawnPlanetEvent {
    pub encrypted_planet_hash: [u8; 32],
    pub encrypted_valid: [u8; 32],
    pub encrypted_spawn_valid: [u8; 32],
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct FlushPlanetEvent {
    pub planet_hash: [u8; 32],
    pub flushed_count: u8,
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
    #[msg("Hash rounds must be >= 1")]
    InvalidHashRounds,
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
    #[msg("Must flush landed moves before processing new moves")]
    MustFlushFirst,
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
    #[account(mut, address = derive_mxe_lut_pda!())]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
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
    #[account(mut, address = derive_mxe_lut_pda!())]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
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
    #[account(mut, address = derive_mxe_lut_pda!())]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
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
    #[account(mut, address = derive_mxe_lut_pda!())]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
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
    #[account(mut, address = derive_mxe_lut_pda!())]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
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
        space = PendingMovesMetadata::BASE_SIZE,
        seeds = [b"moves", game.game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub pending_moves: Box<Account<'info, PendingMovesMetadata>>,
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
        space = PendingMovesMetadata::BASE_SIZE,
        seeds = [b"moves", game.game_id.to_le_bytes().as_ref(), planet_hash.as_ref()],
        bump,
    )]
    pub pending_moves: Box<Account<'info, PendingMovesMetadata>>,
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
    /// Source planet's pending moves metadata (read-only, for flush check)
    pub source_pending: Box<Account<'info, PendingMovesMetadata>>,
    /// Target planet's pending moves metadata (mut, realloc to fit one more entry)
    #[account(
        mut,
        realloc = PendingMovesMetadata::BASE_SIZE + (target_pending.moves.len() + 1) * PENDING_MOVE_ENTRY_SIZE,
        realloc::payer = payer,
        realloc::zero = false,
    )]
    pub target_pending: Box<Account<'info, PendingMovesMetadata>>,
    /// PendingMoveAccount to store the MPC output Enc<Mxe, PendingMoveData>.
    /// PDA seeded by predicted move_id = next_move_id + queued_count (before increment).
    #[account(
        init,
        payer = payer,
        space = PendingMoveAccount::MAX_SIZE,
        seeds = [
            b"move",
            target_pending.game_id.to_le_bytes().as_ref(),
            target_pending.planet_hash.as_ref(),
            (target_pending.next_move_id + target_pending.queued_count as u64).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub move_account: Box<Account<'info, PendingMoveAccount>>,
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
    pub move_account: Box<Account<'info, PendingMoveAccount>>,
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
    pub pending_moves: Box<Account<'info, PendingMovesMetadata>>,
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
    pub pending_moves: Box<Account<'info, PendingMovesMetadata>>,
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
    pub pending_moves: Account<'info, PendingMovesMetadata>,
}
