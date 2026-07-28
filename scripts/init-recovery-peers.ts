/**
 * init-recovery-peers.ts
 *
 * Seeds the Arcium network's permissioned-recovery-peer allowlist with the local
 * recovery peers, so that `arcium init-recovery-peer` can register them.
 *
 * Why this is written by hand:
 *   - Since v0.11 an MXE is initialized with a recovery set built from
 *     RecoveryPeerAccounts, and `init_recovery_peer_account` requires the network's
 *     `PermissionedRecoveryPeersAccount` allowlist to exist and to list the peer.
 *   - The only instruction that creates that allowlist,
 *     `init_permissioned_recovery_peers_account`, aborts with
 *     `CompilationWithoutMainnetFeatureFlag` on every build that is not compiled
 *     with the `mainnet` feature — which includes the program Surfpool forks from
 *     mainnet and the localnet build from bin.arcium.com. So there is no way to
 *     create it by sending a transaction locally.
 *
 * Instead we write the account straight into the ledger with Surfpool's
 * surfnet_setAccount cheatcode, which is what `arcium localnet` effectively does
 * by pre-seeding genesis accounts.
 *
 * Layout (from the Arcium IDL, PermissionedRecoveryPeersAccount):
 *   offset 0  : 8-byte Anchor discriminator
 *   offset 8  : [Pubkey; 25]  permissioned_peers  (unused slots are all-zero)
 *   offset 808: u8            bump
 *
 * Env:
 *   ADMIN_KEYPAIR         unused, kept for symmetry with the other scripts
 *   ANCHOR_PROVIDER_URL   RPC url (default: http://localhost:8899)
 *   RECOVERY_PEER_PUBKEYS comma-separated pubkeys to allowlist
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { ARCIUM_ADDR } from "@arcium-hq/client";

const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://localhost:8899";

const PERMISSIONED_SEED = Buffer.from("PermissionedRecoveryPeersAccount");
const DISCRIMINATOR = Buffer.from([113, 236, 217, 203, 251, 98, 36, 240]);
const MAX_PEERS = 25;
const ACCOUNT_SIZE = 8 + MAX_PEERS * 32 + 1;

function parsePeers(): PublicKey[] {
  const peers = (process.env.RECOVERY_PEER_PUBKEYS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new PublicKey(p));
  if (peers.length === 0) throw new Error("RECOVERY_PEER_PUBKEYS is empty");
  if (peers.length > MAX_PEERS) {
    throw new Error(`at most ${MAX_PEERS} recovery peers, got ${peers.length}`);
  }
  return peers;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (body.error) {
    throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  }
  return body.result as T;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const programId = new PublicKey(ARCIUM_ADDR);
  const peers = parsePeers();

  const [allowlist, bump] = PublicKey.findProgramAddressSync(
    [PERMISSIONED_SEED],
    programId,
  );

  const data = Buffer.alloc(ACCOUNT_SIZE);
  DISCRIMINATOR.copy(data, 0);
  peers.forEach((peer, i) => peer.toBuffer().copy(data, 8 + i * 32));
  data.writeUInt8(bump, ACCOUNT_SIZE - 1);

  const lamports = await connection.getMinimumBalanceForRentExemption(
    ACCOUNT_SIZE,
  );

  await rpc("surfnet_setAccount", [
    allowlist.toBase58(),
    {
      lamports,
      owner: programId.toBase58(),
      // surfnet_setAccount takes hex, not base64.
      data: data.toString("hex"),
      executable: false,
      rentEpoch: 0,
    },
  ]);

  const written = await connection.getAccountInfo(allowlist);
  if (written === null || !written.owner.equals(programId)) {
    throw new Error(`allowlist ${allowlist.toBase58()} was not written`);
  }
  console.log(
    `Permissioned ${peers.length} recovery peer(s) in ${allowlist.toBase58()}`,
  );
  for (const peer of peers) console.log(`  ${peer.toBase58()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
