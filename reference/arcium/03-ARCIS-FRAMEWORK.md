# Arcis Framework Reference

Arcis is Arcium's Rust-based framework for writing secure multi-party computation (MPC) circuits. This document covers the complete syntax, types, and operations available.

## Basic Structure

Every Arcis file follows this pattern:

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    // Define structs for encrypted data
    pub struct MyInputs {
        value1: u64,
        value2: u64,
    }

    // Define encrypted instructions
    #[instruction]
    pub fn my_computation(input_ctxt: Enc<Shared, MyInputs>) -> Enc<Shared, u64> {
        let input = input_ctxt.to_arcis();
        let result = input.value1 + input.value2;
        input_ctxt.owner.from_arcis(result)
    }
}
```

## Encryption Types

### `Enc<Owner, T>` - Encrypted Data Container

The fundamental type for encrypted data. `Owner` specifies who can decrypt:

#### `Enc<Shared, T>` - Client + MXE Can Decrypt

Use when:
- Accepting user inputs that the user needs to verify later
- Returning results the user must be able to decrypt
- Privacy-preserving user interactions

```rust
#[instruction]
pub fn process_user_data(input_ctxt: Enc<Shared, UserData>) -> Enc<Shared, u64> {
    let data = input_ctxt.to_arcis();
    let result = data.value * 2;
    input_ctxt.owner.from_arcis(result)
}
```

#### `Enc<Mxe, T>` - Only MXE Can Decrypt

Use when:
- Storing internal state users shouldn't access
- Passing data between MXE functions
- Protecting protocol-level data

```rust
#[instruction]
pub fn init_global_state(input_ctxt: Enc<Mxe, EmptyStruct>) -> Enc<Mxe, u64> {
    input_ctxt.owner.from_arcis(0_u64)
}
```

### Pass By Reference

For large data, pass by reference to avoid transaction size limits:

```rust
#[instruction]
pub fn add_order(
    order_ctxt: Enc<Shared, Order>,      // By value (small)
    ob_ctxt: Enc<Mxe, &OrderBook>,        // By reference (large)
) -> Enc<Mxe, OrderBook> {
    let order = order_ctxt.to_arcis();
    let mut ob = *(ob_ctxt.to_arcis());
    // ... process
    ob_ctxt.owner.from_arcis(ob)
}
```

## Supported Types

### Primitive Types

| Type | Supported | Notes |
|------|-----------|-------|
| `u8`, `u16`, `u32`, `u64`, `u128`, `usize` | ✅ | Unsigned integers |
| `i8`, `i16`, `i32`, `i64`, `i128`, `isize` | ✅ | Signed integers |
| `f32`, `f64` | ✅ | Emulated as fixed-point |
| `bool` | ✅ | Boolean |
| `()` | ✅ | Unit type |

### Complex Types

| Type | Supported | Notes |
|------|-----------|-------|
| Fixed-length arrays `[T; N]` | ✅ | Any supported T |
| Tuples `(T1, T2, ...)` | ✅ | Of supported types |
| User-defined structs | ✅ | Of supported types |
| References `&T`, `&mut T` | ✅ | Mutable and immutable |
| `ArcisPublicKey` | ✅ | Public key wrapper |

### Cryptographic Types

| Type | Supported | Notes |
|------|-----------|-------|
| `SecretKey` | ✅ | Secret/signing key for cryptographic operations |
| `VerifyingKey` | ✅ | Public/verifying key derived from SecretKey |
| `SHA3_256` | ✅ | SHA3-256 hasher |

### Unsupported Types

- `HashMap`, `Vec`, `String` (no dynamic-length types)
- Enums (currently unsupported)
- Traits (currently unsupported)

## Key Operations

### Converting Encrypted Data

```rust
// Decrypt to secret shares for computation
let plaintext = encrypted_input.to_arcis();

// Encrypt result back
let encrypted_output = owner.from_arcis(plaintext);
```

### Revealing Data (Making Public)

```rust
// Reveal a value (makes it public/unencrypted)
let public_result = (value1 > value2).reveal();

// Common pattern: return revealed boolean
#[instruction]
pub fn compare(input_ctxt: Enc<Shared, TwoValues>) -> bool {
    let input = input_ctxt.to_arcis();
    (input.a > input.b).reveal()
}
```

**IMPORTANT**: `.reveal()` cannot be called inside `if` or `else` blocks.

### Random Number Generation

```rust
use arcis_imports::*;

// Generate random boolean
let random_bool = ArcisRNG::bool();

// Generate random integer (0 to 2^width - 1)
let random_u8 = ArcisRNG::gen_integer_from_width(8);  // 0-255

// Generate public random integer
let public_random = ArcisRNG::gen_public_integer_from_width(8);

// Generate integer in range with rejection sampling
let (result, success) = ArcisRNG::gen_integer_in_range(min, max, n_attempts);

// Shuffle a slice
ArcisRNG::shuffle(&mut my_array);
```

### Cryptographic Key Generation

Generate cryptographic keys within MPC for distributed key management:

```rust
use arcis_imports::*;

// Generate a new random secret key
let secret_key = SecretKey::new_rand();

// Derive the corresponding verifying (public) key
let verifying_key = VerifyingKey::from_secret_key(&secret_key);
```

**Use cases:**
- Distributed key generation where no single party knows the full key
- Creating signing keys split across MPC nodes
- Generating keys for threshold signatures

**Example: Distributed Key Generation**

```rust
#[instruction]
pub fn generate_keypair(mxe: Mxe) -> (Enc<Mxe, SecretKey>, VerifyingKey) {
    // Generate secret key (kept encrypted, only MPC nodes collectively know it)
    let secret_key = SecretKey::new_rand();
    
    // Derive public key (can be revealed)
    let verifying_key = VerifyingKey::from_secret_key(&secret_key);
    
    // Return encrypted secret key and public verifying key
    (mxe.from_arcis(secret_key), verifying_key)
}
```

### Hashing (SHA3-256)

Compute SHA3-256 hashes within MPC circuits:

```rust
use arcis_imports::*;

// Create a new SHA3-256 hasher
let hasher = SHA3_256::new();

// Compute digest of input bytes
let digest = hasher.digest(input_bytes);
```

**Use cases:**
- Commitment schemes (hash-then-reveal)
- Verifiable randomness
- Data integrity verification
- Merkle tree operations

**Example: Commitment Scheme**

```rust
pub struct Commitment {
    hash: [u8; 32],
}

pub struct RevealData {
    value: u64,
    nonce: [u8; 16],
}

#[instruction]
pub fn create_commitment(data_ctxt: Enc<Shared, RevealData>) -> Commitment {
    let data = data_ctxt.to_arcis();
    
    // Concatenate value and nonce into bytes
    let value_bytes = data.value.to_le_bytes();
    let mut input_bytes = [0u8; 24];  // 8 bytes value + 16 bytes nonce
    for i in 0..8 {
        input_bytes[i] = value_bytes[i];
    }
    for i in 0..16 {
        input_bytes[8 + i] = data.nonce[i];
    }
    
    // Hash the input
    let hasher = SHA3_256::new();
    let digest = hasher.digest(&input_bytes);
    
    Commitment { hash: digest }
}

#[instruction]
pub fn verify_commitment(
    reveal_ctxt: Enc<Shared, RevealData>,
    commitment: Commitment,
) -> bool {
    let data = reveal_ctxt.to_arcis();
    
    // Recompute hash
    let value_bytes = data.value.to_le_bytes();
    let mut input_bytes = [0u8; 24];
    for i in 0..8 {
        input_bytes[i] = value_bytes[i];
    }
    for i in 0..16 {
        input_bytes[8 + i] = data.nonce[i];
    }
    
    let hasher = SHA3_256::new();
    let computed_hash = hasher.digest(&input_bytes);
    
    // Compare hashes
    let mut matches = true;
    for i in 0..32 {
        if computed_hash[i] != commitment.hash[i] {
            matches = false;
        }
    }
    
    matches.reveal()
}
```

### Getting MXE Owner

```rust
// Get MXE owner to create MXE-encrypted data
let mxe = Mxe::get();
let mxe_encrypted = mxe.from_arcis(my_value);

// Create shared owner from public key
let shared = Shared::new(arcis_public_key);
let shared_encrypted = shared.from_arcis(my_value);

// Create public key from base58
let pubkey = ArcisPublicKey::from_base58(b"base58_encoded_string");

// Create from uint8 array
let pubkey = ArcisPublicKey::from_uint8(&byte_slice);
```

## Supported Operations

### Binary Operations

| Operation | Types | Notes |
|-----------|-------|-------|
| `a + b` | integers, floats | Addition |
| `a - b` | integers, floats | Subtraction |
| `a * b` | integers, floats | Multiplication |
| `a / b` | integers, floats | Division |
| `a % b` | integers | Modulo |
| `a && b` | booleans | Logical AND |
| `a \|\| b` | booleans | Logical OR |
| `a ^ b` | booleans | XOR |
| `a & b` | booleans | Bitwise AND |
| `a \| b` | booleans | Bitwise OR |
| `a >> b` | integers | Right shift (b must be compile-time known) |
| `a == b` | all | Equality (use `derive(PartialEq)` for structs) |
| `a != b` | all | Inequality |
| `a < b` | booleans, integers, floats | Less than |
| `a <= b` | booleans, integers, floats | Less than or equal |
| `a > b` | booleans, integers, floats | Greater than |
| `a >= b` | booleans, integers, floats | Greater than or equal |

### Method Calls

```rust
// Clone
let cloned = value.clone();

// Array methods
let len = arr.len();
let empty = arr.is_empty();
arr.swap(a, b);
arr.fill(value);
arr.reverse();

// Sorting (integers only)
arr.sort();  // O(n*log²(n)*bit_size)

// Iterator methods
arr.iter()
   .enumerate()
   .map(|(i, v)| v * i as u64)
   .fold(0, |acc, x| acc + x);

// Number methods
let abs_val = num.abs();
let min_val = num.min(other);
let max_val = num.max(other);

// Integer-specific
let diff = a.abs_diff(b);
let positive = num.is_positive();
let negative = num.is_negative();
let bytes = num.to_le_bytes();
let bytes = num.to_be_bytes();

// Float-specific
let exp = num.exp();
let sqrt = num.sqrt();
let ln = num.ln();
```

## Control Flow

### If/Else

```rust
// Both branches are always computed (O(then_block + else_block))
let result = if condition {
    value_a
} else {
    value_b
};
```

**Note**: Both branches execute in MPC, so complexity is sum of both.

### For Loops

```rust
// Supported: compile-time known iteration count
for i in 0..10 {
    // ...
}

for item in array.iter() {
    // ...
}
```

### Unsupported Control Flow

- `loop { }` - Unknown iteration count
- `while x < limit { }` - Unknown iteration count
- `break`, `continue` - Not supported
- `return` - Not supported (implicit return only)

## Indexing

```rust
// Compile-time known index: O(1)
let value = array[5];

// Runtime index: O(array.len())
let dynamic_value = array[runtime_index];
```

## Casting

Supported casts:
- Integer to integer
- Bool to integer
- Integer to bool
- Reference to reference

```rust
let wider: u64 = narrow_value as u64;
let bool_val: bool = integer as bool;
```

## Structs

```rust
pub struct Order {
    size: u64,
    bid: bool,
    owner: u128,
}

// Can derive PartialEq for comparisons
#[derive(PartialEq)]
pub struct Point {
    x: u64,
    y: u64,
}
```

## Complete Example: Confidential Voting

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

    // Initialize vote counters
    #[instruction]
    pub fn init_vote_stats(mxe: Mxe) -> Enc<Mxe, VoteStats> {
        let vote_stats = VoteStats { yes: 0, no: 0 };
        mxe.from_arcis(vote_stats)
    }

    // Process a vote
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

    // Reveal result (only majority, not counts)
    #[instruction]
    pub fn reveal_result(vote_stats_ctxt: Enc<Mxe, VoteStats>) -> bool {
        let vote_stats = vote_stats_ctxt.to_arcis();
        (vote_stats.yes > vote_stats.no).reveal()
    }
}
```

## Performance Tips

1. **Minimize `.from_arcis()` calls per owner** - Put all data for same owner in one struct
2. **Prefer compile-time known indices** - Runtime indexing is O(n)
3. **Avoid deep if/else nesting** - Both branches always compute
4. **Use fixed-size arrays** - No dynamic allocation
5. **Batch operations** - Reduce number of encrypted instruction calls

## Quick Reference: Undocumented Features

These features are available in Arcis but not covered in official documentation:

### Cryptographic Key Generation

```rust
// Generate random secret key
let secret_key = SecretKey::new_rand();

// Derive verifying (public) key
let verifying_key = VerifyingKey::from_secret_key(&secret_key);
```

### SHA3-256 Hashing

```rust
// Create hasher and compute digest
let hasher = SHA3_256::new();
let digest = hasher.digest(input_bytes);  // Returns [u8; 32]
```

These primitives enable advanced use cases like:
- Distributed key generation (no single party knows the full key)
- Threshold signatures
- Commitment schemes (commit-reveal patterns)
- Verifiable random functions
- Merkle tree proofs
