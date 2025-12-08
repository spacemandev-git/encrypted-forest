# Computation Lifecycle (v0.5.1)

Understanding how computations flow through Arcium is essential for building effective privacy-preserving applications.

> **v0.5.1 Changes**: This document reflects the updated computation flow with BLS signature verification for callbacks.

## Key Actors

### 1. Client
The party that wants to perform a computation (usually the user). Implemented using the Arcium TypeScript Client Library (`@arcium-hq/client`).

### 2. MXE Program  
Your application deployed on Solana. Contains:
- Smart contract for formatting and submitting computations
- Computation definitions (encrypted instructions written in Arcis)
- MXE metadata including which MPC cluster to use

### 3. Arcium Program
The on-chain program that assigns, schedules, and verifies computations for MPC clusters.

### 4. MPC Cluster
The decentralized nodes that perform encrypted computations using Multi-Party Computation.

### 5. Callback Server (Optional)
Handles results larger than what fits in a single Solana transaction.

## Computation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPUTATION LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CLIENT          MXE PROGRAM       ARCIUM PROGRAM     MPC CLUSTER           │
│    │                 │                  │                 │                 │
│    │  1. Encrypt     │                  │                 │                 │
│    │  parameters     │                  │                 │                 │
│    │────────────────>│                  │                 │                 │
│    │                 │                  │                 │                 │
│    │                 │  2. Format &     │                 │                 │
│    │                 │  queue computation                 │                 │
│    │                 │─────────────────>│                 │                 │
│    │                 │                  │                 │                 │
│    │                 │                  │  3. Queue in    │                 │
│    │                 │                  │  MXE's mempool  │                 │
│    │                 │                  │────────────────>│                 │
│    │                 │                  │                 │                 │
│    │                 │                  │                 │  4. Fetch from  │
│    │                 │                  │<────────────────│  mempool        │
│    │                 │                  │                 │                 │
│    │                 │                  │                 │  5. Compute     │
│    │                 │                  │                 │  using MPC      │
│    │                 │                  │                 │                 │
│    │                 │  6. Callback     │                 │                 │
│    │                 │<─────────────────│<────────────────│  with result    │
│    │                 │                  │                 │                 │
│    │  7. Result      │                  │                 │                 │
│    │  (encrypted or  │                  │                 │                 │
│    │   revealed)     │                  │                 │                 │
│    │<────────────────│                  │                 │                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Breakdown

### Step 1: Client Encrypts Data

```typescript
// Generate keys for x25519 key exchange
const privateKey = x25519.utils.randomSecretKey();
const publicKey = x25519.getPublicKey(privateKey);

// Get MXE's public key
const mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);

// Derive shared secret
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

// Create cipher and encrypt
const cipher = new RescueCipher(sharedSecret);
const nonce = randomBytes(16);
const ciphertext = cipher.encrypt([val1, val2], nonce);
```

### Step 2: MXE Program Formats & Queues

```rust
pub fn add_together(ctx: Context<AddTogether>, ...) -> Result<()> {
    // v0.5.1: Use ArgBuilder instead of vec![Argument::...]
    let args = ArgBuilder::new()
        .x25519_pubkey(pub_key)
        .plaintext_u128(nonce)
        .encrypted_u8(ciphertext_0)
        .encrypted_u8(ciphertext_1)
        .build();

    // v0.5.1: queue_computation now takes 7 parameters
    // - callback_ix requires computation_offset and mxe_account
    // - New cu_price_micro parameter for priority fees
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,                                                    // Callback server (None = no extra data)
        vec![AddTogetherCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[]
        )?],                                                     // Callback instruction
        1,                                                       // Number of callback transactions
        0,                                                       // cu_price_micro: priority fee (0 = standard)
    )?;
    Ok(())
}
```

### Step 3-5: Arcium & MPC Processing

The Arcium program:
1. Validates the computation request
2. Adds it to the MXE's mempool
3. MPC cluster nodes fetch and execute using secret sharing

### Step 6: Callback with Result (v0.5.1 BLS Verification)

```rust
// v0.5.1: Uses SignedComputationOutputs with BLS signature verification
#[arcium_callback(encrypted_ix = "add_together")]
pub fn add_together_callback(
    ctx: Context<AddTogetherCallback>,
    output: SignedComputationOutputs<AddTogetherOutput>,
) -> Result<()> {
    // v0.5.1: Must call verify_output() to validate BLS signatures
    // This ensures the result came from the MXE cluster
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(AddTogetherOutput { field_0 }) => field_0,
        Err(e) => {
            msg!("Computation verification failed: {}", e);
            return Err(ErrorCode::AbortedComputation.into())
        },
    };

    // Handle the result (emit event, update state, etc.)
    emit!(SumEvent {
        sum: o.ciphertexts[0],
        nonce: o.nonce.to_le_bytes(),
    });
    Ok(())
}
```

**v0.5.1 BLS Verification Notes:**
- Replace `ComputationOutputs<T>` with `SignedComputationOutputs<T>`
- Always call `verify_output()` to validate BLS signatures
- Requires `cluster_account` and `computation_account` references
- Possible errors: `BLSSignatureVerificationFailed`, `InvalidClusterBLSPublicKey`, `AbortedComputation`

### Step 7: Client Decrypts Result

```typescript
// Wait for computation to finalize
const finalizeSig = await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
);

// Get the result from the event
const sumEvent = await sumEventPromise;

// Decrypt using the same cipher
const decrypted = cipher.decrypt([sumEvent.sum], sumEvent.nonce)[0];
```

## Three Instructions Pattern

Every encrypted instruction in your Solana program typically has three associated instructions:

### 1. Init Computation Definition
Called once after deployment to set up the computation definition:

```rust
// v0.5.1: init_comp_def removed the first offset parameter
pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    Ok(())
}
```

### 2. Queue Computation
Called each time you want to execute the encrypted instruction:

```rust
pub fn add_together(ctx: Context<AddTogether>, ...) -> Result<()> {
    // ... format args and call queue_computation
}
```

### 3. Callback Handler
Called by the MPC cluster when computation completes:

```rust
#[arcium_callback(encrypted_ix = "add_together")]
pub fn add_together_callback(...) -> Result<()> {
    // Handle the result
}
```

## Waiting for Computation Finalization

Unlike regular Solana transactions, waiting for an Arcium computation involves:
1. Waiting for the queue transaction
2. Waiting for MPC cluster execution
3. Waiting for the callback transaction

Use the SDK helper:

```typescript
import { awaitComputationFinalization } from "@arcium-hq/client";

const finalizeSig = await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
);
```

## Key Accounts in Computation Flow

| Account | Purpose |
|---------|---------|
| `mxe_account` | Your MXE's metadata and configuration |
| `mempool_account` | Queue where computations wait to be processed |
| `executing_pool` | Tracks computations currently being executed |
| `computation_account` | Stores individual computation data and results |
| `comp_def_account` | Definition of your encrypted instruction (circuit) |
| `cluster_account` | The MPC cluster that will process your computation |
| `pool_account` | Arcium's fee collection account |
| `clock_account` | Network timing information |
