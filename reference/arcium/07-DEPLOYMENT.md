# Deployment Guide (v0.5.1)

This document covers deploying your MXE (MPC eXecution Environment) to Solana devnet and mainnet.

> **v0.5.1 Notes**: 
> - Only the **Cerberus** backend is supported; Manticore is unavailable
> - Environment variable changed: `ARCIUM_CLUSTER_PUBKEY` → `ARCIUM_CLUSTER_OFFSET`

## Prerequisites

- MXE built successfully with `arcium build`
- Tests passing locally with `arcium test`
- Solana keypair with 2-5 SOL for deployment costs
- Reliable RPC endpoint (Helius, QuickNode recommended)

## Circuit Storage Options

### Small Circuits (Standard Approach)

For small circuits that fit in transaction size limits:

```rust
pub fn init_my_function_comp_def(ctx: Context<InitMyFunctionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, 0, None, None)?;
    Ok(())
}
```

### Large Circuits (Offchain Storage)

For larger circuits, store them offchain and reference by URL:

```rust
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};

// v0.5.1: init_comp_def removed the first offset parameter
pub fn init_my_function_comp_def(ctx: Context<InitMyFunctionCompDef>) -> Result<()> {
    init_comp_def(
        ctx.accounts,
        Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://your-storage.com/path/to/my_function.arcis".to_string(),
            hash: [0; 32],  // Hash verification not enforced yet
        })),
        None,
    )?;
    Ok(())
}
```

**Offchain storage workflow:**
1. Build project with `arcium build`
2. Upload `.arcis` files from `build/` to public storage (S3, IPFS, Supabase)
3. Update init functions with public URLs
4. Rebuild with `arcium build`

**Note**: Circuit files must be publicly accessible without authentication.

## Basic Deployment

```bash
arcium deploy \
  --cluster-offset <cluster-offset> \
  --keypair-path <path-to-keypair> \
  --rpc-url <your-rpc-url>
```

### Cluster Offsets for Devnet

| Offset | Version |
|--------|---------|
| `1078779259` | v0.3.0 |
| `3726127828` | v0.3.0 |
| `768109697` | v0.4.0 / v0.5.1 |

**v0.5.1 uses the same cluster as v0.4.0**. Choose the cluster offset matching your Arcium version.

### Recommended: Use a Reliable RPC

```bash
arcium deploy \
  --cluster-offset 768109697 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://devnet.helius-rpc.com/?api-key=<your-api-key>
```

**Get free API keys from:**
- [Helius](https://helius.dev/)
- [QuickNode](https://quicknode.com/)

### Alternative: Default RPC (Less Reliable)

```bash
arcium deploy \
  --cluster-offset 768109697 \
  --keypair-path ~/.config/solana/id.json \
  -u d  # 'd' for devnet
```

## Advanced Deployment Options

### Adjust Mempool Size

```bash
arcium deploy \
  --cluster-offset 768109697 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-rpc-url> \
  --mempool-size Medium
```

Available sizes: `Tiny` (default), `Small`, `Medium`, `Large`

### Custom Program Address

```bash
arcium deploy \
  --cluster-offset 768109697 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url <your-rpc-url> \
  --program-keypair ./my-program-keypair.json
```

### Partial Deployments

**Skip program deployment (MXE init only):**
```bash
arcium deploy --cluster-offset 768109697 ... --skip-deploy
```

**Deploy program only (skip MXE init):**
```bash
arcium deploy --cluster-offset 768109697 ... --skip-init
```

## Post-Deployment Steps

### 1. Initialize Computation Definitions

After deployment, initialize each computation definition. Only needed once per program.

**Update cluster configuration in your code:**

```typescript
import { getClusterAccAddress, getArciumEnv } from "@arcium-hq/client";

// v0.5.1: Environment variable changed from ARCIUM_CLUSTER_PUBKEY to ARCIUM_CLUSTER_OFFSET
// For local testing:
const arciumEnv = getArciumEnv();
const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

// For devnet:
const clusterOffset = 768109697;  // v0.4.0/v0.5.1 cluster
const clusterAccount = getClusterAccAddress(clusterOffset);
```

**Call init instructions:**

```typescript
await initMyFunctionCompDef(program, owner, false);
```

### 2. Verify Deployment

```bash
solana program show <your-program-id> --url <your-rpc-url>
```

### 3. Update Test Configuration for Devnet

```typescript
import { getClusterAccAddress, getArciumEnv } from "@arcium-hq/client";

const useDevnet = true;

if (useDevnet) {
    const connection = new anchor.web3.Connection(
        "https://api.devnet.solana.com",
        "confirmed"
    );
    const wallet = new anchor.Wallet(owner);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    const program = new anchor.Program<YourProgram>(IDL, provider);
    // v0.5.1: Use getClusterAccAddress with offset
    const clusterAccount = getClusterAccAddress(768109697);
} else {
    anchor.setProvider(anchor.AnchorProvider.env());
    const arciumEnv = getArciumEnv();
    // v0.5.1: arciumClusterPubkey → arciumClusterOffset (derive cluster address)
    const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);
}
```

## Troubleshooting

### Dropped Transactions

Switch to a dedicated RPC provider:

```bash
# Instead of -u d, use a reliable RPC
--rpc-url https://devnet.helius-rpc.com/?api-key=<your-key>
```

### Insufficient SOL

Check balance:
```bash
solana balance <your-pubkey> -u devnet
```

Request airdrop:
```bash
solana airdrop 2 <your-pubkey> -u devnet
```

### Partial Deployment Failure

If program deployed but init failed:
```bash
arcium deploy ... --skip-deploy
```

If init succeeded but deploy failed:
```bash
arcium deploy ... --skip-init
```

## Deployment Checklist

- [ ] Tests pass locally (`arcium test`)
- [ ] Keypair has sufficient SOL (2-5 SOL)
- [ ] RPC endpoint configured (Helius/QuickNode recommended)
- [ ] Cluster offset selected (match Arcium version)
- [ ] Large circuits uploaded to public storage (if applicable)
- [ ] Deploy command executed successfully
- [ ] Computation definitions initialized
- [ ] Test code updated with devnet cluster address
- [ ] End-to-end test on devnet passes

## Production Considerations

1. **Use dedicated RPC providers** - Default endpoints are unreliable
2. **Monitor mempool size** - Increase if computations queue up
3. **Keep keypairs secure** - Use hardware wallets for mainnet
4. **Test thoroughly on devnet** - Before mainnet deployment
5. **Document your cluster offset** - Needed for client configuration

## Next Steps After Deployment

1. Update client code to connect to deployed program
2. Initialize all computation definitions
3. Run end-to-end tests with real encrypted computations
4. Monitor performance and adjust mempool size
5. Join [Discord](https://discord.gg/arcium) for support
