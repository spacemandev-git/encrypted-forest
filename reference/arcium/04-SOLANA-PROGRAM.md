# Solana Program Integration (v0.5.1)

This document covers how to integrate Arcium encrypted instructions with your Solana program using the `arcium_anchor` framework.

> **v0.5.1 Breaking Changes Summary:**
> - PDA macros now require `mxe_account` and error code parameters
> - `queue_computation` has new 7th parameter (`cu_price_micro`)
> - `callback_ix` requires `computation_offset` and `mxe_account`
> - Replace `vec![Argument::...]` with `ArgBuilder` API
> - Callbacks use `SignedComputationOutputs<T>` with BLS verification
> - `init_comp_def` removed the first offset parameter

## Program Structure

Every Arcium program uses the `#[arcium_program]` macro instead of Anchor's `#[program]`:

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// Define computation definition offsets for each encrypted instruction
const COMP_DEF_OFFSET_MY_FUNCTION: u32 = comp_def_offset("my_function");

declare_id!("YOUR_PROGRAM_ID");

#[arcium_program]
pub mod my_program {
    use super::*;

    // ... instructions go here
}
```

## Three Instructions Pattern

Every encrypted instruction requires three Solana instructions:

### 1. Init Computation Definition

Called once after deployment to register the encrypted instruction:

```rust
// v0.5.1: Removed the first offset parameter from init_comp_def
pub fn init_my_function_comp_def(ctx: Context<InitMyFunctionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    Ok(())
}

#[init_computation_definition_accounts("my_function", payer)]
#[derive(Accounts)]
pub struct InitMyFunctionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
```

### 2. Queue Computation

Called each time you want to execute the encrypted instruction:

```rust
pub fn my_function(
    ctx: Context<MyFunction>,
    computation_offset: u64,
    encrypted_input: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
    // v0.5.1: Use ArgBuilder instead of vec![Argument::...]
    let args = ArgBuilder::new()
        .x25519_pubkey(pub_key)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_input)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // v0.5.1: queue_computation has new signature
    // - callback_ix requires computation_offset and mxe_account
    // - New 7th parameter: cu_price_micro for priority fees
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,  // Callback server (None for simple computations)
        vec![MyFunctionCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[]
        )?],  // Callback instruction
        1,     // Number of transactions for callback
        0,     // cu_price_micro: priority fee in microlamports (0 = standard)
    )?;
    Ok(())
}
```

**Priority Fee Notes:**
- Set `cu_price_micro` to `0` for standard processing
- Use higher values (e.g., `50000`) for faster processing during network congestion

### 3. Callback Handler

Called by the MPC cluster when computation completes:

```rust
// v0.5.1: Uses SignedComputationOutputs with BLS signature verification
#[arcium_callback(encrypted_ix = "my_function")]
pub fn my_function_callback(
    ctx: Context<MyFunctionCallback>,
    output: SignedComputationOutputs<MyFunctionOutput>,
) -> Result<()> {
    // v0.5.1: Must call verify_output() to validate BLS signatures
    let result = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(MyFunctionOutput { field_0 }) => field_0,
        Err(e) => {
            msg!("Computation verification failed: {}", e);
            return Err(ErrorCode::AbortedComputation.into())
        },
    };

    // Handle the result
    emit!(ResultEvent {
        ciphertext: result.ciphertexts[0],
        nonce: result.nonce.to_le_bytes(),
    });
    Ok(())
}
```

**v0.5.1 BLS Verification:**
- `SignedComputationOutputs<T>` replaces `ComputationOutputs<T>`
- `verify_output()` validates BLS signatures from the MXE cluster
- Requires `cluster_account` and `computation_account` in callback context
- Error codes: `BLSSignatureVerificationFailed`, `InvalidClusterBLSPublicKey`, `AbortedComputation`

## Account Structs

### Queue Computation Accounts

```rust
#[queue_computation_accounts("my_function", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct MyFunction<'info> {
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
    pub sign_pda_account: Account<'info, SignerAccount>,
    
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    
    // v0.5.1: PDA macros now require mxe_account and ErrorCode parameter
    #[account(
        mut, 
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program
    pub mempool_account: UncheckedAccount<'info>,
    
    #[account(
        mut, 
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program
    pub executing_pool: UncheckedAccount<'info>,
    
    #[account(
        mut, 
        address = derive_comp_pda!(
            computation_offset,
            mxe_account,
            ErrorCode::ClusterNotSet
        )
    )]
    /// CHECK: computation_account, checked by the arcium program
    pub computation_account: UncheckedAccount<'info>,
    
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MY_FUNCTION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    
    #[account(
        mut, 
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}
```

**v0.5.1 PDA Macro Changes:**
| Old (v0.4.x) | New (v0.5.1) |
|--------------|--------------|
| `derive_mempool_pda!()` | `derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)` |
| `derive_execpool_pda!()` | `derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)` |
| `derive_comp_pda!(offset)` | `derive_comp_pda!(offset, mxe_account, ErrorCode::ClusterNotSet)` |
| `derive_cluster_pda!()` | `derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)` |

### Callback Accounts

```rust
#[callback_accounts("my_function")]
#[derive(Accounts)]
pub struct MyFunctionCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MY_FUNCTION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
}
```

## ArgBuilder API (v0.5.1)

> **v0.5.1 Change**: Replace `vec![Argument::...]` pattern with the new `ArgBuilder` API.

### Basic Usage

```rust
// v0.5.1: Use ArgBuilder instead of vec![Argument::...]
let args = ArgBuilder::new()
    .x25519_pubkey(pub_key)
    .plaintext_u128(nonce)
    .encrypted_u8(ciphertext_0)
    .encrypted_u8(ciphertext_1)
    .build();
```

### Available ArgBuilder Methods

**Plaintext Types:**

| Method | Input Type | Description |
|--------|------------|-------------|
| `plaintext_bool(value)` | `bool` | Boolean value |
| `plaintext_u8(value)` | `u8` | Unsigned 8-bit integer |
| `plaintext_i8(value)` | `i8` | Signed 8-bit integer |
| `plaintext_u16(value)` | `u16` | Unsigned 16-bit integer |
| `plaintext_i16(value)` | `i16` | Signed 16-bit integer |
| `plaintext_u32(value)` | `u32` | Unsigned 32-bit integer |
| `plaintext_i32(value)` | `i32` | Signed 32-bit integer |
| `plaintext_u64(value)` | `u64` | Unsigned 64-bit integer |
| `plaintext_i64(value)` | `i64` | Signed 64-bit integer |
| `plaintext_u128(value)` | `u128` | Unsigned 128-bit integer |
| `plaintext_i128(value)` | `i128` | Signed 128-bit integer |
| `plaintext_float(value)` | `f64` | Floating point |
| `plaintext_point(value)` | `[u8; 32]` | Elliptic curve point (new in v0.5.1) |

**Encrypted Types:**

| Method | Input Type | Description |
|--------|------------|-------------|
| `encrypted_bool(value)` | `[u8; 32]` | Encrypted boolean |
| `encrypted_u8(value)` | `[u8; 32]` | Encrypted unsigned 8-bit |
| `encrypted_i8(value)` | `[u8; 32]` | Encrypted signed 8-bit |
| `encrypted_u16(value)` | `[u8; 32]` | Encrypted unsigned 16-bit |
| `encrypted_i16(value)` | `[u8; 32]` | Encrypted signed 16-bit |
| `encrypted_u32(value)` | `[u8; 32]` | Encrypted unsigned 32-bit |
| `encrypted_i32(value)` | `[u8; 32]` | Encrypted signed 32-bit |
| `encrypted_u64(value)` | `[u8; 32]` | Encrypted unsigned 64-bit |
| `encrypted_i64(value)` | `[u8; 32]` | Encrypted signed 64-bit |
| `encrypted_u128(value)` | `[u8; 32]` | Encrypted unsigned 128-bit |
| `encrypted_i128(value)` | `[u8; 32]` | Encrypted signed 128-bit |
| `encrypted_float(value)` | `[u8; 32]` | Encrypted floating point |

**Cryptographic Keys:**

| Method | Input Type | Description |
|--------|------------|-------------|
| `x25519_pubkey(value)` | `[u8; 32]` | X25519 public key for encryption |
| `arcis_ed25519_signature(value)` | `[u8; 64]` | Ed25519 signature |

**Account References:**

| Method | Input Type | Description |
|--------|------------|-------------|
| `account(pubkey, offset, length)` | `Pubkey, u32, u32` | Reference on-chain account data |

### Argument Ordering for Enc<Shared, T>

For inputs of type `Enc<Shared, T>`, you must pass:
1. `.x25519_pubkey(pub_key)`
2. `.plaintext_u128(nonce)`
3. Ciphertext(s) for each field in T

### Argument Ordering for Enc<Mxe, T>

For inputs of type `Enc<Mxe, T>`, you only need:
1. `.plaintext_u128(nonce)`
2. Ciphertext(s)

### Passing Account References

For large encrypted state stored in accounts:

```rust
let args = ArgBuilder::new()
    // ... other args
    .account(
        account_pubkey,
        8 + 1,      // Offset: 8 bytes discriminator + 1 byte bump
        32 * 2,     // Length: 2 ciphertexts × 32 bytes each
    )
    .build();
```

### Migration from v0.4.x

| Old (v0.4.x) | New (v0.5.1) |
|--------------|--------------|
| `Argument::ArcisPubkey(key)` | `.x25519_pubkey(key)` |
| `Argument::PlaintextU128(val)` | `.plaintext_u128(val)` |
| `Argument::EncryptedU8(ct)` | `.encrypted_u8(ct)` |
| `Argument::Account(pk, off, len)` | `.account(pk, off, len)` |

## Callback Accounts with Custom Data

To pass writable accounts to the callback:

```rust
use arcium_client::idl::arcium::types::CallbackAccount;

// v0.5.1: callback_ix now requires computation_offset and mxe_account
queue_computation(
    ctx.accounts,
    computation_offset,
    args,
    None,
    vec![MyFunctionCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &[
            CallbackAccount {
                pubkey: ctx.accounts.my_custom_account.key(),
                is_writable: true,
            }
        ]
    )?],
    1,
    0,  // cu_price_micro: priority fee (0 = standard)
)?;
```

Then in your callback accounts struct:

```rust
#[callback_accounts("my_function")]
#[derive(Accounts)]
pub struct MyFunctionCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MY_FUNCTION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    
    // Custom account passed in callback_ix
    #[account(mut)]
    pub my_custom_account: Account<'info, MyCustomAccount>,
}
```

## Handling Callback Outputs (v0.5.1 BLS Verification)

> **v0.5.1 Change**: Use `SignedComputationOutputs<T>` and call `verify_output()` to validate BLS signatures.

```rust
#[arcium_callback(encrypted_ix = "my_function")]
pub fn my_function_callback(
    ctx: Context<MyFunctionCallback>,
    output: SignedComputationOutputs<MyFunctionOutput>,
) -> Result<()> {
    // v0.5.1: Must verify BLS signature before using output
    match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(result) => {
            // For Enc<Shared, T> output:
            // result.ciphertexts - Vec of 32-byte ciphertexts
            // result.nonce - The nonce for decryption
            
            ctx.accounts.state.ciphertext = result.ciphertexts[0];
            ctx.accounts.state.nonce = result.nonce;
            Ok(())
        }
        Err(e) => {
            msg!("Verification failed: {}", e);
            Err(ErrorCode::ComputationAborted.into())
        }
    }
}
```

**v0.5.1 Key Changes:**
- `ComputationOutputs<T>` → `SignedComputationOutputs<T>`
- Always call `verify_output(&cluster_account, &computation_account)` to validate BLS signatures
- Callback accounts must include `cluster_account` and `computation_account`

## Storing Encrypted State On-Chain

```rust
#[account]
#[derive(InitSpace)]
pub struct EncryptedState {
    pub bump: u8,
    pub encrypted_value: [[u8; 32]; 2],  // 2 ciphertexts
    pub nonce: u128,
    pub owner: Pubkey,
}
```

## Complete Example: Private Token Account (v0.5.1)

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_INIT_BALANCE: u32 = comp_def_offset("init_user_balance");
const COMP_DEF_OFFSET_TRANSFER: u32 = comp_def_offset("transfer");

declare_id!("YOUR_PROGRAM_ID");

#[arcium_program]
pub mod private_token {
    use super::*;

    // v0.5.1: Removed offset parameter
    pub fn init_balance_comp_def(ctx: Context<InitBalanceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn create_account(
        ctx: Context<CreateAccount>,
        computation_offset: u64,
        owner_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.token_account.owner = ctx.accounts.payer.key();
        ctx.accounts.token_account.bump = ctx.bumps.token_account;

        // v0.5.1: Use ArgBuilder
        let args = ArgBuilder::new()
            .x25519_pubkey(owner_pubkey)
            .plaintext_u128(nonce)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // v0.5.1: Updated signature
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.token_account.key(),
                        is_writable: true,
                    }
                ]
            )?],
            1,
            0,  // cu_price_micro
        )?;
        Ok(())
    }

    // v0.5.1: BLS verification
    #[arcium_callback(encrypted_ix = "init_user_balance")]
    pub fn init_balance_callback(
        ctx: Context<InitBalanceCallback>,
        output: SignedComputationOutputs<InitUserBalanceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account
        ) {
            Ok(InitUserBalanceOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Verification failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            },
        };

        ctx.accounts.token_account.balance = o.ciphertexts[0];
        ctx.accounts.token_account.nonce = o.nonce;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct PrivateTokenAccount {
    pub bump: u8,
    pub owner: Pubkey,
    pub balance: [u8; 32],  // Encrypted balance
    pub nonce: u128,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
```

## Macros Reference

| Macro | Purpose |
|-------|---------|
| `#[arcium_program]` | Marks the program module (replaces `#[program]`) |
| `#[arcium_callback(encrypted_ix = "name")]` | Marks a callback handler |
| `#[queue_computation_accounts("name", payer)]` | Auto-derives required accounts for queuing |
| `#[callback_accounts("name")]` | Auto-derives required accounts for callbacks |
| `#[init_computation_definition_accounts("name", payer)]` | Auto-derives accounts for init |
| `comp_def_offset("name")` | Generates unique offset for computation definition |
| `derive_sign_pda!()` | Derives sign PDA address |
| `derive_mxe_pda!()` | Derives MXE PDA address |
| `derive_mempool_pda!(mxe, err)` | Derives mempool PDA address (v0.5.1: requires mxe_account) |
| `derive_execpool_pda!(mxe, err)` | Derives execution pool PDA address (v0.5.1: requires mxe_account) |
| `derive_comp_pda!(offset, mxe, err)` | Derives computation account PDA (v0.5.1: requires mxe_account) |
| `derive_comp_def_pda!(offset)` | Derives computation definition PDA |
| `derive_cluster_pda!(mxe, err)` | Derives cluster PDA (v0.5.1: requires mxe_account) |

## v0.5.1 Breaking Changes Summary

| Change | Before (v0.4.x) | After (v0.5.1) |
|--------|-----------------|----------------|
| `queue_computation` | 6 parameters | 7 parameters (add `cu_price_micro: u64`) |
| `callback_ix` | `callback_ix(&[])` | `callback_ix(computation_offset, &mxe_account, &[])?` |
| Callback output type | `ComputationOutputs<T>` | `SignedComputationOutputs<T>` with `verify_output()` |
| `init_comp_def` | `init_comp_def(accs, 0, None, None)` | `init_comp_def(accs, None, None)` |
| PDA macros | `derive_mempool_pda!()` | `derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)` |
| Argument building | `vec![Argument::...]` | `ArgBuilder::new()...build()` |
| ArgBuilder pubkey | `Argument::ArcisPubkey(key)` | `.x25519_pubkey(key)` |

For complete migration details, see: https://docs.arcium.com/developers/migration/migration-v0.4-to-v0.5
