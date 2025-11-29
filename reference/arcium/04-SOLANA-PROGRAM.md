# Solana Program Integration

This document covers how to integrate Arcium encrypted instructions with your Solana program using the `arcium_anchor` framework.

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
pub fn init_my_function_comp_def(ctx: Context<InitMyFunctionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, 0, None, None)?;
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
    // Build arguments matching the Arcis function signature
    let args = vec![
        Argument::ArcisPubkey(pub_key),
        Argument::PlaintextU128(nonce),
        Argument::EncryptedU64(encrypted_input),
    ];

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,  // Callback server (None for simple computations)
        vec![MyFunctionCallback::callback_ix(&[])],  // Callback instruction
        1,     // Number of transactions for callback
    )?;
    Ok(())
}
```

### 3. Callback Handler

Called by the MPC cluster when computation completes:

```rust
#[arcium_callback(encrypted_ix = "my_function")]
pub fn my_function_callback(
    ctx: Context<MyFunctionCallback>,
    output: ComputationOutputs<MyFunctionOutput>,
) -> Result<()> {
    let result = match output {
        ComputationOutputs::Success(MyFunctionOutput { field_0 }) => field_0,
        _ => return Err(ErrorCode::AbortedComputation.into()),
    };

    // Handle the result
    emit!(ResultEvent {
        ciphertext: result.ciphertexts[0],
        nonce: result.nonce.to_le_bytes(),
    });
    Ok(())
}
```

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
    
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: mempool_account, checked by the arcium program
    pub mempool_account: UncheckedAccount<'info>,
    
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool, checked by the arcium program
    pub executing_pool: UncheckedAccount<'info>,
    
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account, checked by the arcium program
    pub computation_account: UncheckedAccount<'info>,
    
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MY_FUNCTION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}
```

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

## Argument Types

When building args for `queue_computation`, use these `Argument` variants:

| Argument Type | Use For |
|--------------|---------|
| `Argument::ArcisPubkey(pub_key)` | Client's x25519 public key (required for `Enc<Shared, T>`) |
| `Argument::PlaintextU128(nonce)` | Encryption nonce (required for all encrypted inputs) |
| `Argument::EncryptedU8(ciphertext)` | Encrypted u8 value |
| `Argument::EncryptedU16(ciphertext)` | Encrypted u16 value |
| `Argument::EncryptedU32(ciphertext)` | Encrypted u32 value |
| `Argument::EncryptedU64(ciphertext)` | Encrypted u64 value |
| `Argument::EncryptedU128(ciphertext)` | Encrypted u128 value |
| `Argument::EncryptedBool(ciphertext)` | Encrypted boolean |
| `Argument::PlaintextU64(value)` | Plaintext u64 |
| `Argument::Account(pubkey, offset, len)` | Account data reference |

### Argument Ordering for Enc<Shared, T>

For inputs of type `Enc<Shared, T>`, you must pass:
1. `Argument::ArcisPubkey(pub_key)`
2. `Argument::PlaintextU128(nonce)`
3. Ciphertext(s) for each field in T

### Argument Ordering for Enc<Mxe, T>

For inputs of type `Enc<Mxe, T>`, you only need:
1. `Argument::PlaintextU128(nonce)`
2. Ciphertext(s)

### Passing Account References

For large encrypted state stored in accounts:

```rust
let args = vec![
    // ... other args
    Argument::Account(
        account_pubkey,
        8 + 1,      // Offset: 8 bytes discriminator + 1 byte bump
        32 * 2,     // Length: 2 ciphertexts × 32 bytes each
    ),
];
```

## Callback Accounts with Custom Data

To pass writable accounts to the callback:

```rust
use arcium_client::idl::arcium::types::CallbackAccount;

queue_computation(
    ctx.accounts,
    computation_offset,
    args,
    None,
    vec![MyFunctionCallback::callback_ix(&[
        CallbackAccount {
            pubkey: ctx.accounts.my_custom_account.key(),
            is_writable: true,
        }
    ])],
    1,
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

## Handling Callback Outputs

The `ComputationOutputs<T>` enum contains either success or abort:

```rust
#[arcium_callback(encrypted_ix = "my_function")]
pub fn my_function_callback(
    ctx: Context<MyFunctionCallback>,
    output: ComputationOutputs<MyFunctionOutput>,
) -> Result<()> {
    match output {
        ComputationOutputs::Success(result) => {
            // For Enc<Shared, T> output:
            // result.ciphertexts - Vec of 32-byte ciphertexts
            // result.nonce - The nonce for decryption
            
            ctx.accounts.state.ciphertext = result.ciphertexts[0];
            ctx.accounts.state.nonce = result.nonce;
            Ok(())
        }
        ComputationOutputs::Aborted => {
            Err(ErrorCode::ComputationAborted.into())
        }
    }
}
```

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

## Complete Example: Private Token Account

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_INIT_BALANCE: u32 = comp_def_offset("init_user_balance");
const COMP_DEF_OFFSET_TRANSFER: u32 = comp_def_offset("transfer");

declare_id!("YOUR_PROGRAM_ID");

#[arcium_program]
pub mod private_token {
    use super::*;

    pub fn init_balance_comp_def(ctx: Context<InitBalanceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
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

        let args = vec![
            Argument::ArcisPubkey(owner_pubkey),
            Argument::PlaintextU128(nonce),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitBalanceCallback::callback_ix(&[
                CallbackAccount {
                    pubkey: ctx.accounts.token_account.key(),
                    is_writable: true,
                }
            ])],
            1,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_user_balance")]
    pub fn init_balance_callback(
        ctx: Context<InitBalanceCallback>,
        output: ComputationOutputs<InitUserBalanceOutput>,
    ) -> Result<()> {
        let o = match output {
            ComputationOutputs::Success(InitUserBalanceOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
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
| `derive_mempool_pda!()` | Derives mempool PDA address |
| `derive_execpool_pda!()` | Derives execution pool PDA address |
| `derive_comp_pda!(offset)` | Derives computation account PDA |
| `derive_comp_def_pda!(offset)` | Derives computation definition PDA |
| `derive_cluster_pda!(mxe, error)` | Derives cluster PDA |
