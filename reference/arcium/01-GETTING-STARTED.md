# Getting Started with Arcium

## Prerequisites

Before installing Arcium, ensure you have:

- **Rust**: Install from https://www.rust-lang.org/tools/install
- **Solana CLI 2.3.0**: Install from https://docs.solana.com/cli/install-solana-cli-tools, then run `solana-keygen new`
- **Yarn**: Install from https://yarnpkg.com/getting-started/install
- **Anchor 0.32.1**: Install from https://www.anchor-lang.com/docs/installation
- **Docker & Docker Compose**: Required for local testing

## Installation

### Quick Install (Recommended)

On Mac and Linux:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
```

This script will:
- Check for all required dependencies
- Install `arcup` (Arcium version manager)
- Install the latest Arcium CLI
- Install the Arx Node (core MPC node software)

### Manual Installation

Install `arcup` for your platform:

```bash
# Apple Silicon
TARGET=aarch64_macos && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.4.0" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup

# Intel Mac  
TARGET=x86_64_macos && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.4.0" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup

# ARM Linux
TARGET=aarch64_linux && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.4.0" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup

# x86 Linux
TARGET=x86_64_linux && curl "https://bin.arcium.com/download/arcup_${TARGET}_0.4.0" -o ~/.cargo/bin/arcup && chmod +x ~/.cargo/bin/arcup
```

Then install the CLI:

```bash
arcup install
arcium --version
```

## Creating Your First Project

Initialize a new MXE project:

```bash
arcium init <project-name>
cd <project-name>
```

This creates an Anchor-like project structure with two key additions:
- `Arcium.toml` - Configuration for Arcium tooling
- `encrypted-ixs/` - Where you write encrypted instructions using Arcis

## Project Structure

```
my-project/
├── Anchor.toml              # Anchor configuration
├── Arcium.toml              # Arcium configuration
├── Cargo.toml               # Rust workspace
├── programs/                # Solana programs
│   └── my_project/
│       └── src/
│           └── lib.rs       # Main program entry
├── encrypted-ixs/           # Encrypted instruction circuits
│   └── src/
│       └── lib.rs           # Arcis circuits (add_together.rs example)
├── tests/                   # TypeScript tests
└── migrations/
```

## Hello World Example

### Step 1: Encrypted Instruction (encrypted-ixs/src/lib.rs)

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct InputValues {
        v1: u8,
        v2: u8,
    }

    #[instruction]
    pub fn add_together(input_ctxt: Enc<Shared, InputValues>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.v1 as u16 + input.v2 as u16;
        input_ctxt.owner.from_arcis(sum)
    }
}
```

**Key Points:**
- `use arcis_imports::*` - Import Arcis types and functions
- `#[encrypted]` - Marks the module as containing encrypted instructions
- `#[instruction]` - Marks a function as an MPC entry point
- `Enc<Shared, T>` - Encrypted data type (Shared = client+MXE can decrypt)
- `.to_arcis()` - Converts encrypted input to secret shares for MPC
- `.from_arcis()` - Encrypts the result back

### Step 2: Solana Program (programs/my_project/src/lib.rs)

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_ADD_TOGETHER: u32 = comp_def_offset("add_together");

declare_id!("YOUR_PROGRAM_ID_HERE");

#[arcium_program]
pub mod hello_world {
    use super::*;

    // Initialize computation definition (called once after deployment)
    pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
        Ok(())
    }

    // Invoke the encrypted instruction
    pub fn add_together(
        ctx: Context<AddTogether>,
        computation_offset: u64,
        ciphertext_0: [u8; 32],
        ciphertext_1: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU8(ciphertext_0),
            Argument::EncryptedU8(ciphertext_1),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AddTogetherCallback::callback_ix(&[])],
            1,
        )?;
        Ok(())
    }

    // Handle the result callback from MPC cluster
    #[arcium_callback(encrypted_ix = "add_together")]
    pub fn add_together_callback(
        ctx: Context<AddTogetherCallback>,
        output: ComputationOutputs<AddTogetherOutput>,
    ) -> Result<()> {
        let o = match output {
            ComputationOutputs::Success(AddTogetherOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(SumEvent {
            sum: o.ciphertexts[0],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }
}
```

### Step 3: Build and Test

```bash
# Install dependencies
yarn

# Build the project
arcium build

# Sync MPC keys (first time only)
arcium keys sync

# Run tests (starts local MPC network via Docker)
arcium test
```

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `arcium init <name>` | Initialize a new MXE project |
| `arcium build` | Build encrypted instructions and Solana programs |
| `arcium test` | Run tests with local MPC network |
| `arcium deploy` | Deploy to Solana network |
| `arcium keys sync` | Sync MPC node keys to local device |
| `arcup install` | Install/update Arcium tooling |

## Next Steps

1. Read [02-COMPUTATION-LIFECYCLE.md](./02-COMPUTATION-LIFECYCLE.md) to understand how computations flow
2. Learn the [03-ARCIS-FRAMEWORK.md](./03-ARCIS-FRAMEWORK.md) for writing encrypted instructions
3. Study [06-EXAMPLES.md](./06-EXAMPLES.md) for real-world patterns
