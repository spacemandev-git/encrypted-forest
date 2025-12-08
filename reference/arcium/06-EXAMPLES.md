# Complete Code Examples (v0.5.1)

This document provides complete, working examples from the Arcium ecosystem.

> **v0.5.1 Notes**: All examples updated to use:
> - `ArgBuilder` instead of `vec![Argument::...]`
> - `SignedComputationOutputs<T>` with `verify_output()` for callbacks
> - Updated PDA macros with `mxe_account` and error parameters
> - New `queue_computation` signature with 7 parameters

## Example 1: Coinflip Game

A simple game demonstrating secure randomness and encrypted comparisons.

### Encrypted Instruction (encrypted-ixs/src/lib.rs)

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct UserChoice {
        pub choice: bool,  // true for heads, false for tails
    }

    /// Performs a confidential coin flip and compares with player's choice.
    /// Returns true if player wins, false if player loses.
    #[instruction]
    pub fn flip(input_ctxt: Enc<Shared, UserChoice>) -> bool {
        let input = input_ctxt.to_arcis();
        
        // Generate cryptographically secure random boolean
        let toss = ArcisRNG::bool();
        
        // Reveal only the outcome, not the individual values
        (input.choice == toss).reveal()
    }
}
```

### Solana Program (programs/coinflip/src/lib.rs)

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_FLIP: u32 = comp_def_offset("flip");

declare_id!("YOUR_PROGRAM_ID");

#[arcium_program]
pub mod coinflip {
    use super::*;

    // v0.5.1: Removed offset parameter from init_comp_def
    pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn flip(
        ctx: Context<Flip>,
        computation_offset: u64,
        user_choice: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // v0.5.1: Use ArgBuilder
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_bool(user_choice)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // v0.5.1: Updated queue_computation with new callback_ix signature and cu_price_micro
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![FlipCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[]
            )?],
            1,
            0,  // cu_price_micro
        )?;
        Ok(())
    }

    // v0.5.1: Use SignedComputationOutputs with BLS verification
    #[arcium_callback(encrypted_ix = "flip")]
    pub fn flip_callback(
        ctx: Context<FlipCallback>,
        output: SignedComputationOutputs<FlipOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account
        ) {
            Ok(FlipOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            },
        };

        emit!(FlipEvent { result });
        Ok(())
    }
}

#[event]
pub struct FlipEvent {
    pub result: bool,  // true = player won
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}

// Account structs with v0.5.1 PDA macros...
```

---

## Example 2: Confidential Voting

A voting system where individual votes remain private but aggregated results can be revealed.

### Encrypted Instructions (encrypted-ixs/src/lib.rs)

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct VoteStats {
        yes: u64,
        no: u64,
    }

    pub struct UserVote {
        vote: bool,
    }

    /// Initialize encrypted vote counters
    #[instruction]
    pub fn init_vote_stats(mxe: Mxe) -> Enc<Mxe, VoteStats> {
        let vote_stats = VoteStats { yes: 0, no: 0 };
        mxe.from_arcis(vote_stats)
    }

    /// Process an encrypted vote, updating running tallies
    #[instruction]
    pub fn vote(
        vote_ctxt: Enc<Shared, UserVote>,
        vote_stats_ctxt: Enc<Mxe, VoteStats>,
    ) -> Enc<Mxe, VoteStats> {
        let user_vote = vote_ctxt.to_arcis();
        let mut vote_stats = vote_stats_ctxt.to_arcis();

        if user_vote.vote {
            vote_stats.yes += 1;
        } else {
            vote_stats.no += 1;
        }

        vote_stats_ctxt.owner.from_arcis(vote_stats)
    }

    /// Reveal only whether majority voted yes (not actual counts)
    #[instruction]
    pub fn reveal_result(vote_stats_ctxt: Enc<Mxe, VoteStats>) -> bool {
        let vote_stats = vote_stats_ctxt.to_arcis();
        (vote_stats.yes > vote_stats.no).reveal()
    }
}
```

### Solana Program (programs/voting/src/lib.rs)

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_INIT_VOTE_STATS: u32 = comp_def_offset("init_vote_stats");
const COMP_DEF_OFFSET_VOTE: u32 = comp_def_offset("vote");
const COMP_DEF_OFFSET_REVEAL: u32 = comp_def_offset("reveal_result");

declare_id!("YOUR_PROGRAM_ID");

#[arcium_program]
pub mod voting {
    use super::*;

    pub fn init_vote_stats_comp_def(ctx: Context<InitVoteStatsCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
        Ok(())
    }

    /// Create a new poll with encrypted vote counters
    pub fn create_new_poll(
        ctx: Context<CreateNewPoll>,
        computation_offset: u64,
        id: u32,
        question: String,
        nonce: u128,
    ) -> Result<()> {
        // Initialize poll account
        ctx.accounts.poll_acc.question = question;
        ctx.accounts.poll_acc.bump = ctx.bumps.poll_acc;
        ctx.accounts.poll_acc.id = id;
        ctx.accounts.poll_acc.authority = ctx.accounts.payer.key();
        ctx.accounts.poll_acc.nonce = nonce;
        ctx.accounts.poll_acc.vote_state = [[0; 32]; 2];

        let args = vec![Argument::PlaintextU128(nonce)];
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitVoteStatsCallback::callback_ix(&[CallbackAccount {
                pubkey: ctx.accounts.poll_acc.key(),
                is_writable: true,
            }])],
            1,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_vote_stats")]
    pub fn init_vote_stats_callback(
        ctx: Context<InitVoteStatsCallback>,
        output: ComputationOutputs<InitVoteStatsOutput>,
    ) -> Result<()> {
        let o = match output {
            ComputationOutputs::Success(InitVoteStatsOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.poll_acc.vote_state = o.ciphertexts;
        ctx.accounts.poll_acc.nonce = o.nonce;
        Ok(())
    }

    pub fn init_vote_comp_def(ctx: Context<InitVoteCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
        Ok(())
    }

    /// Submit an encrypted vote
    pub fn vote(
        ctx: Context<Vote>,
        computation_offset: u64,
        _id: u32,
        vote: [u8; 32],
        vote_encryption_pubkey: [u8; 32],
        vote_nonce: u128,
    ) -> Result<()> {
        let args = vec![
            Argument::ArcisPubkey(vote_encryption_pubkey),
            Argument::PlaintextU128(vote_nonce),
            Argument::EncryptedBool(vote),
            Argument::PlaintextU128(ctx.accounts.poll_acc.nonce),
            Argument::Account(
                ctx.accounts.poll_acc.key(),
                8 + 1,     // discriminator + bump
                32 * 2,    // 2 vote counters
            ),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![VoteCallback::callback_ix(&[CallbackAccount {
                pubkey: ctx.accounts.poll_acc.key(),
                is_writable: true,
            }])],
            1,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "vote")]
    pub fn vote_callback(
        ctx: Context<VoteCallback>,
        output: ComputationOutputs<VoteOutput>,
    ) -> Result<()> {
        let o = match output {
            ComputationOutputs::Success(VoteOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.poll_acc.vote_state = o.ciphertexts;
        ctx.accounts.poll_acc.nonce = o.nonce;

        emit!(VoteEvent {
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn init_reveal_result_comp_def(ctx: Context<InitRevealResultCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
        Ok(())
    }

    /// Reveal the final result (only authority can call)
    pub fn reveal_result(
        ctx: Context<RevealVotingResult>,
        computation_offset: u64,
        id: u32,
    ) -> Result<()> {
        require!(
            ctx.accounts.payer.key() == ctx.accounts.poll_acc.authority,
            ErrorCode::InvalidAuthority
        );

        let args = vec![
            Argument::PlaintextU128(ctx.accounts.poll_acc.nonce),
            Argument::Account(
                ctx.accounts.poll_acc.key(),
                8 + 1,
                32 * 2,
            ),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![RevealResultCallback::callback_ix(&[])],
            1,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "reveal_result")]
    pub fn reveal_result_callback(
        ctx: Context<RevealResultCallback>,
        output: ComputationOutputs<RevealResultOutput>,
    ) -> Result<()> {
        let result = match output {
            ComputationOutputs::Success(RevealResultOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(RevealResultEvent { output: result });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct PollAccount {
    pub bump: u8,
    pub vote_state: [[u8; 32]; 2],  // [yes_count, no_count] encrypted
    pub id: u32,
    pub authority: Pubkey,
    pub nonce: u128,
    #[max_len(50)]
    pub question: String,
}

#[event]
pub struct VoteEvent {
    pub timestamp: i64,
}

#[event]
pub struct RevealResultEvent {
    pub output: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
```

---

## Example 3: Privacy-Preserving Token (Degen Cash)

A complex example with encrypted balances, deposits, withdrawals, and variance-based transfers.

### Encrypted Instructions (encrypted-ixs/src/lib.rs)

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct EmptyStruct;

    /// Initialize global DC mint counter (MXE-owned)
    #[instruction]
    pub fn init_global_dc_mint(input_ctxt: Enc<Mxe, EmptyStruct>) -> Enc<Mxe, u64> {
        input_ctxt.owner.from_arcis(0_u64)
    }

    /// Initialize user balance (user-owned)
    #[instruction]
    pub fn init_user_dc_balance(owner_ctxt: Enc<Shared, EmptyStruct>) -> Enc<Shared, u64> {
        owner_ctxt.owner.from_arcis(0_u64)
    }

    /// Deposit: Mint DC tokens
    /// Status: 0=Success, 1=Math Overflow
    #[instruction]
    pub fn deposit(
        global_mint_amount_ctxt: Enc<Mxe, u64>,
        user_dc_balance_ctxt: Enc<Shared, u64>,
        deposit_amount: u64,
    ) -> (u8, u64, Enc<Mxe, u64>, Enc<Shared, u64>) {
        let global_mint_amount = global_mint_amount_ctxt.to_arcis();
        let user_dc_balance = user_dc_balance_ctxt.to_arcis();
        
        let new_global_mint_amount = global_mint_amount + deposit_amount;
        let new_user_dc_balance = user_dc_balance + deposit_amount;

        let mut status_code = 0_u8;

        // Overflow check
        if new_global_mint_amount < global_mint_amount {
            status_code = 1;
        }
        if new_user_dc_balance < user_dc_balance {
            status_code = 1;
        }

        (
            status_code.reveal(),
            deposit_amount.reveal(),
            global_mint_amount_ctxt.owner.from_arcis(new_global_mint_amount),
            user_dc_balance_ctxt.owner.from_arcis(new_user_dc_balance),
        )
    }

    /// Withdraw: Burn DC tokens with 0.5% fee
    /// Status: 0=Success, 1=Math Overflow, 2=Insufficient Funds
    #[instruction]
    pub fn withdraw(
        global_mint_amount_ctxt: Enc<Mxe, u64>,
        user_dc_balance_ctxt: Enc<Shared, u64>,
        withdraw_amount: u64,
    ) -> (u8, u64, Enc<Mxe, u64>, Enc<Shared, u64>) {
        let global_mint_amount = global_mint_amount_ctxt.to_arcis();
        let user_dc_balance = user_dc_balance_ctxt.to_arcis();

        let mut status_code = 0_u8;

        // Calculate 50 bps (0.5%) withdrawal fee
        let fee_amount = (withdraw_amount as u128 * 50) / 10000;
        let total_charge = withdraw_amount as u128 + fee_amount;

        if total_charge > user_dc_balance as u128 {
            status_code = 2;
        }
        if total_charge > global_mint_amount as u128 {
            status_code = 2;
        }

        let new_global = global_mint_amount - (total_charge as u64);
        let new_user = user_dc_balance - (total_charge as u64);

        // Underflow check
        if new_global > global_mint_amount {
            status_code = 1;
        }
        if new_user > user_dc_balance {
            status_code = 1;
        }

        (
            status_code.reveal(),
            withdraw_amount.reveal(),
            global_mint_amount_ctxt.owner.from_arcis(new_global),
            user_dc_balance_ctxt.owner.from_arcis(new_user),
        )
    }

    /// Transfer with variance (privacy obfuscation)
    /// Status: 0=Success, 1=Overflow, 2=Insufficient, 3=RNG Failure
    #[instruction]
    pub fn transfer(
        global_balance: u64,
        global_dc_balance_ctxt: Enc<Mxe, u64>,
        sender_balance_ctxt: Enc<Shared, u64>,
        receiver_balance_ctxt: Enc<Shared, u64>,
        transfer_amount: u64,
        max_variance: u8,
    ) -> (u8, u8, u64, Enc<Shared, u64>, Enc<Mxe, u64>, Enc<Shared, u64>) {
        let mut status_code = 0_u8;
        let mut global_dc_balance = global_dc_balance_ctxt.to_arcis();
        let mut sender_balance = sender_balance_ctxt.to_arcis();
        let mut receiver_balance = receiver_balance_ctxt.to_arcis();
        let mut actual_variance_roll = 0_u8;

        // Generate random variance using rejection sampling
        let variance_roll = if max_variance == 0 {
            0_u128
        } else {
            let range_size = (max_variance as u128) + 1;
            let rejection_threshold = 256_u128 - (256_u128 % range_size);

            let mut found_valid = 0_u8;
            let mut result = 0_u128;

            for _ in 0..10 {
                let candidate = if found_valid == 0 {
                    ArcisRNG::gen_integer_from_width(8)
                } else {
                    0_u128
                };

                let is_valid = if candidate < rejection_threshold { 1_u8 } else { 0_u8 };
                let should_update = if found_valid == 0 { is_valid } else { 0_u8 };
                
                result = if should_update == 1 {
                    candidate % range_size
                } else {
                    result
                };
                found_valid = if should_update == 1 { 1_u8 } else { found_valid };
            }

            if found_valid == 0 {
                status_code = 3;
            }
            result
        };

        if status_code == 0 {
            actual_variance_roll = variance_roll as u8;

            // Random direction for variance
            let variance_bool = ArcisRNG::bool();
            let variance_adjustment = (transfer_amount as u128 * variance_roll) / 255_u128;

            let modified_transfer = if variance_bool {
                transfer_amount as u128 - variance_adjustment
            } else {
                transfer_amount as u128 + variance_adjustment
            };

            // Fee inversely proportional to variance
            let fee_bps = 255_u128 - max_variance as u128;
            let fee_amount = (transfer_amount as u128 * fee_bps) / 10000_u128;
            let modified_with_fee = modified_transfer + fee_amount;

            // NAV-based adjustment
            let nav_percent = if global_balance > 0 {
                (global_dc_balance as u128 * 100_u128) / global_balance as u128
            } else {
                100_u128
            };

            let modified_with_nav = if nav_percent < 100 {
                let discount = (100_u128 - nav_percent) * transfer_amount as u128 / 10000_u128;
                if modified_with_fee > discount { modified_with_fee - discount } else { 0_u128 }
            } else if nav_percent > 100 {
                let penalty = nav_percent * transfer_amount as u128 / 10000_u128;
                modified_with_fee + penalty
            } else {
                modified_with_fee
            };

            // Pre-flight check
            let worst_case = transfer_amount as u128 
                + (transfer_amount as u128 * max_variance as u128) / 255_u128
                + (transfer_amount as u128 * (255_u128 - max_variance as u128)) / 10000_u128;

            if worst_case > sender_balance as u128 {
                status_code = 2;
            }

            if status_code == 0 {
                let final_charge = if modified_with_nav > sender_balance as u128 {
                    sender_balance
                } else {
                    modified_with_nav as u64
                };

                sender_balance = sender_balance - final_charge;
                receiver_balance = receiver_balance + transfer_amount;

                // Adjust global supply
                let delta = (final_charge as i128) - (transfer_amount as i128);
                if delta > 0 {
                    global_dc_balance = global_dc_balance + (delta as u64);
                } else if delta < 0 {
                    let burn = (-delta) as u64;
                    global_dc_balance = if global_dc_balance >= burn {
                        global_dc_balance - burn
                    } else {
                        0
                    };
                }
            }
        }

        (
            status_code.reveal(),
            actual_variance_roll.reveal(),
            transfer_amount.reveal(),
            sender_balance_ctxt.owner.from_arcis(sender_balance),
            global_dc_balance_ctxt.owner.from_arcis(global_dc_balance),
            receiver_balance_ctxt.owner.from_arcis(receiver_balance),
        )
    }
}
```

---

## Additional Examples

The official examples repository contains more complete implementations:

| Example | Description | Link |
|---------|-------------|------|
| Rock Paper Scissors (PvP) | Two-player game with encrypted moves | [GitHub](https://github.com/arcium-hq/examples/tree/main/rock_paper_scissors/against-player) |
| Rock Paper Scissors (House) | Player vs provably fair house | [GitHub](https://github.com/arcium-hq/examples/tree/main/rock_paper_scissors/against-house) |
| Blackjack | Card game with hidden deck state | [GitHub](https://github.com/arcium-hq/examples/tree/main/blackjack) |
| Medical Records | Privacy-controlled data sharing | [GitHub](https://github.com/arcium-hq/examples/tree/main/share_medical_records) |
| Ed25519 Signatures | Distributed signing with split keys | [GitHub](https://github.com/arcium-hq/examples/tree/main/ed25519) |

## Key Patterns Summary

1. **Status Codes**: Return status codes to indicate success/failure types
2. **Reveal vs Encrypted Return**: Use `.reveal()` for public results, `from_arcis()` for encrypted
3. **Rejection Sampling**: Use loops with early-exit tracking for secure randomness
4. **Callback Accounts**: Pass writable accounts to store encrypted state
5. **Multi-party State**: Combine `Enc<Mxe, T>` (global) with `Enc<Shared, T>` (per-user)
