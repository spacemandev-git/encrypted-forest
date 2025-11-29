# Arcium Reference Documentation

This reference documentation is designed to help you become an expert in building privacy-preserving applications on Solana using Arcium's Multi-Party Computation (MPC) network.

## What is Arcium?

Arcium is a decentralized private computation network that enables secure processing of encrypted data through Multi-Party Computation (MPC). It solves a fundamental problem in Web3: how to process sensitive data while maintaining privacy.

Traditionally, computation requires data to be decrypted, making it vulnerable to attacks and exposing private information. Arcium changes this by allowing computations to run on fully encrypted data.

## Key Concepts

### MXE (MPC eXecution Environment)

An MXE is your privacy-preserving application. It consists of:
- A Solana smart contract that formats and submits computations
- Confidential instructions (computation definitions) written in Arcis
- Metadata about which MPC cluster to use

### Arcis Framework

Arcis is Arcium's Rust-based framework for writing MPC circuits. It extends Solana's Anchor framework, allowing you to write confidential instructions using familiar Rust syntax.

### Encryption Types

1. **`Enc<Shared, T>`** - Data encrypted with a shared secret between client and MXE. Both parties can decrypt.
2. **`Enc<Mxe, T>`** - Data encrypted exclusively for the MXE. Only MPC nodes (acting together) can decrypt.

### Computation Flow

1. Client encrypts data and sends it to your MXE program
2. Your program submits the computation to Arcium's network of MPC nodes
3. Nodes process the data while keeping it encrypted, then return results via callback

## What Arcium Enables for Solana Developers

1. **Privacy-Preserving Applications**: Add privacy without adopting a new blockchain or programming language
2. **Familiar Tooling**: Use the Arcis framework (extends Anchor). Mark functions as confidential—no cryptography knowledge required
3. **Process Sensitive Data**: Run computations on encrypted data without ever decrypting it

## Common Use Cases

1. **Private DeFi**: Dark pools, private order books, confidential trading without front-running
2. **Secure AI**: AI inference on encrypted data
3. **Confidential Gaming**: Hidden information games (cards, strategy, auctions)
4. **Confidential Voting**: Anonymous ballot systems with private votes but public results
5. **Privacy-Preserving Financial Systems**: Encrypted balances, private transfers

## Documentation Structure

| Document | Description |
|----------|-------------|
| [01-GETTING-STARTED.md](./01-GETTING-STARTED.md) | Installation, project setup, hello world |
| [02-COMPUTATION-LIFECYCLE.md](./02-COMPUTATION-LIFECYCLE.md) | How computations flow through the system |
| [03-ARCIS-FRAMEWORK.md](./03-ARCIS-FRAMEWORK.md) | Writing encrypted instructions with Arcis |
| [04-SOLANA-PROGRAM.md](./04-SOLANA-PROGRAM.md) | Integrating with Solana programs |
| [05-TYPESCRIPT-CLIENT.md](./05-TYPESCRIPT-CLIENT.md) | Client-side encryption and SDK usage |
| [06-EXAMPLES.md](./06-EXAMPLES.md) | Complete code examples |
| [07-DEPLOYMENT.md](./07-DEPLOYMENT.md) | Deploying to devnet/mainnet |

## Quick Reference Links

- **TypeScript SDK API**: https://ts.arcium.com/api
- **Official Examples**: https://github.com/arcium-hq/examples
- **Discord Community**: https://discord.gg/arcium
- **Official Docs**: https://docs.arcium.com/developers
