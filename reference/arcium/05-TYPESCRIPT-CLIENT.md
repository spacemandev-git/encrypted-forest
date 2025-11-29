# TypeScript Client Library

This document covers the Arcium TypeScript SDK for client-side encryption, decryption, and interaction with MXE programs.

## Installation

```bash
# Client library (for building & invoking computations)
npm install @arcium-hq/client

# Reader library (for reading MXE data)
npm install @arcium-hq/reader
```

## API Reference

Complete TypeScript SDK documentation: https://ts.arcium.com/api

## Core Concepts

### Key Exchange

Arcium uses x25519 Diffie-Hellman key exchange to derive shared secrets between clients and MXE clusters.

### Rescue Cipher

Inputs are encrypted using the Rescue cipher with the shared secret. The SDK provides `RescueCipher` for encryption/decryption.

## Basic Usage

### Setting Up the Client

```typescript
import * as anchor from "@coral-xyz/anchor";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "crypto";
import { 
    RescueCipher,
    getMXEPublicKeyWithRetry,
    awaitComputationFinalization,
    getCompDefAccAddress,
    getComputationAccAddress,
    getMXEAccAddress,
    getMempoolAccAddress,
    getExecutingPoolAccAddress,
    getCompDefAccOffset,
    getClusterAccAddress,
    getArciumEnv,  // For local testing only
} from "@arcium-hq/client";

// Configure provider
anchor.setProvider(anchor.AnchorProvider.env());
const program = anchor.workspace.MyProgram as Program<MyProgram>;
const provider = anchor.getProvider() as anchor.AnchorProvider;
```

### Encryption Flow

```typescript
// 1. Generate your x25519 keypair
const privateKey = x25519.utils.randomSecretKey();
const publicKey = x25519.getPublicKey(privateKey);

// 2. Get MXE's public key
const mxePublicKey = await getMXEPublicKeyWithRetry(
    provider,
    program.programId
);

// 3. Derive shared secret
const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

// 4. Create cipher
const cipher = new RescueCipher(sharedSecret);

// 5. Encrypt your data
const nonce = randomBytes(16);
const values = [BigInt(42), BigInt(58)];  // Values to encrypt
const ciphertext = cipher.encrypt(values, nonce);
```

### Submitting a Computation

```typescript
// Generate unique computation offset
const computationOffset = new anchor.BN(randomBytes(8), "hex");

// Build and send transaction
const tx = await program.methods
    .myEncryptedFunction(
        computationOffset,
        Array.from(ciphertext[0]),      // First ciphertext
        Array.from(ciphertext[1]),      // Second ciphertext
        Array.from(publicKey),           // Your public key
        new anchor.BN(deserializeLE(nonce).toString())  // Nonce
    )
    .accountsPartial({
        computationAccount: getComputationAccAddress(
            program.programId,
            computationOffset
        ),
        clusterAccount: getClusterAccAddress(clusterOffset),  // Use actual cluster for devnet
        // OR for local testing:
        // clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("my_function")).readUInt32LE()
        ),
    })
    .rpc({ commitment: "confirmed" });

console.log("Queue transaction:", tx);
```

### Waiting for Computation

```typescript
// Wait for the MPC computation to complete
const finalizeSig = await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
);

console.log("Finalize transaction:", finalizeSig);
```

### Decrypting Results

```typescript
// Listen for the result event
const awaitEvent = (eventName: string) => {
    return new Promise<any>((resolve) => {
        const listener = program.addEventListener(eventName, (event) => {
            program.removeEventListener(listener);
            resolve(event);
        });
    });
};

// Start listening before queuing
const resultPromise = awaitEvent("resultEvent");

// ... queue computation ...

// Wait for and decrypt result
const resultEvent = await resultPromise;
const decrypted = cipher.decrypt(
    [resultEvent.ciphertext], 
    resultEvent.nonce
)[0];

console.log("Decrypted result:", decrypted);
```

## Helper Functions Reference

### Address Derivation

```typescript
// Get MXE account address
const mxeAddr = getMXEAccAddress(programId);

// Get mempool address
const mempoolAddr = getMempoolAccAddress(programId);

// Get executing pool address
const execPoolAddr = getExecutingPoolAccAddress(programId);

// Get computation account address (for specific computation)
const compAddr = getComputationAccAddress(programId, computationOffset);

// Get computation definition address
const compDefAddr = getCompDefAccAddress(
    programId, 
    Buffer.from(getCompDefAccOffset("function_name")).readUInt32LE()
);

// Get cluster address (for devnet deployment)
const clusterAddr = getClusterAccAddress(clusterOffset);
```

### Cluster Offsets for Devnet

```typescript
// Available cluster offsets for devnet:
const CLUSTER_V030_A = 1078779259;
const CLUSTER_V030_B = 3726127828;
const CLUSTER_V040 = 768109697;

// Use the one matching your Arcium version
const clusterAccount = getClusterAccAddress(CLUSTER_V040);
```

## Complete Test Example

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "crypto";
import {
    RescueCipher,
    getMXEPublicKeyWithRetry,
    awaitComputationFinalization,
    getArciumEnv,
    getComputationAccAddress,
    getMXEAccAddress,
    getMempoolAccAddress,
    getExecutingPoolAccAddress,
    getCompDefAccAddress,
    getCompDefAccOffset,
} from "@arcium-hq/client";
import { MyProgram } from "../target/types/my_program";

describe("My Program", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const program = anchor.workspace.MyProgram as Program<MyProgram>;
    const provider = anchor.getProvider() as anchor.AnchorProvider;
    const arciumEnv = getArciumEnv();

    it("Processes encrypted data", async () => {
        // Setup keys and cipher
        const privateKey = x25519.utils.randomSecretKey();
        const publicKey = x25519.getPublicKey(privateKey);
        const mxePublicKey = await getMXEPublicKeyWithRetry(
            provider,
            program.programId
        );
        const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
        const cipher = new RescueCipher(sharedSecret);

        // Encrypt inputs
        const val1 = BigInt(10);
        const val2 = BigInt(20);
        const nonce = randomBytes(16);
        const ciphertext = cipher.encrypt([val1, val2], nonce);

        // Setup event listener
        const resultPromise = new Promise<any>((resolve) => {
            const listener = program.addEventListener("sumEvent", (event) => {
                program.removeEventListener(listener);
                resolve(event);
            });
        });

        // Queue computation
        const computationOffset = new anchor.BN(randomBytes(8), "hex");
        
        await program.methods
            .addTogether(
                computationOffset,
                Array.from(ciphertext[0]),
                Array.from(ciphertext[1]),
                Array.from(publicKey),
                new anchor.BN(
                    Buffer.from(nonce).reverse().toString("hex"), 
                    "hex"
                )
            )
            .accountsPartial({
                computationAccount: getComputationAccAddress(
                    program.programId,
                    computationOffset
                ),
                clusterAccount: arciumEnv.arciumClusterPubkey,
                mxeAccount: getMXEAccAddress(program.programId),
                mempoolAccount: getMempoolAccAddress(program.programId),
                executingPool: getExecutingPoolAccAddress(program.programId),
                compDefAccount: getCompDefAccAddress(
                    program.programId,
                    Buffer.from(
                        getCompDefAccOffset("add_together")
                    ).readUInt32LE()
                ),
            })
            .rpc({ commitment: "confirmed" });

        // Wait for finalization
        await awaitComputationFinalization(
            provider,
            computationOffset,
            program.programId,
            "confirmed"
        );

        // Decrypt result
        const event = await resultPromise;
        const decrypted = cipher.decrypt([event.sum], event.nonce)[0];
        
        expect(decrypted).to.equal(val1 + val2);
    });
});
```

## Working with Different Environments

### Local Testing

```typescript
const arciumEnv = getArciumEnv();

// Use local cluster for testing
.accountsPartial({
    clusterAccount: arciumEnv.arciumClusterPubkey,
    // ... other accounts
})
```

### Devnet Deployment

```typescript
// Use actual cluster offset for devnet
const clusterOffset = 768109697;  // v0.4.0 cluster

.accountsPartial({
    clusterAccount: getClusterAccAddress(clusterOffset),
    // ... other accounts
})
```

## Serialization Helpers

```typescript
// Deserialize little-endian bytes to BigInt
function deserializeLE(bytes: Uint8Array): bigint {
    let result = BigInt(0);
    for (let i = bytes.length - 1; i >= 0; i--) {
        result = (result << BigInt(8)) + BigInt(bytes[i]);
    }
    return result;
}

// Convert nonce to anchor.BN
const nonceBN = new anchor.BN(deserializeLE(nonce).toString());
```

## Error Handling

```typescript
try {
    await awaitComputationFinalization(
        provider,
        computationOffset,
        program.programId,
        "confirmed"
    );
} catch (error) {
    if (error.message.includes("Computation aborted")) {
        console.error("MPC computation was aborted");
    } else if (error.message.includes("timeout")) {
        console.error("Computation timed out");
    } else {
        throw error;
    }
}
```

## Reader Library

For monitoring MXE state and computations:

```typescript
import { getMXEData, getComputations } from "@arcium-hq/reader";

// Read MXE data
const mxeData = await getMXEData(connection, programId);
console.log("MXE cluster:", mxeData.cluster);
console.log("Mempool size:", mxeData.mempoolSize);

// Get computations for an MXE
const computations = await getComputations(connection, programId);
console.log("Active computations:", computations.length);
```
