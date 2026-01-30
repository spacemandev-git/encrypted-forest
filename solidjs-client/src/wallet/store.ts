/**
 * Embedded wallet manager — generates/stores keypairs in IndexedDB,
 * supports naming wallets, and provides SOL airdrop from configured RPC.
 */

import { createSignal, type Accessor } from "solid-js";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { openDB, type IDBPDatabase } from "idb";

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const WALLET_DB_NAME = "ef-wallets";
const WALLET_DB_VERSION = 1;

export interface StoredWallet {
  /** Base58 public key (used as key) */
  publicKey: string;
  /** Human-readable name */
  name: string;
  /** Secret key bytes (64 bytes) */
  secretKey: number[];
  /** Creation timestamp */
  createdAt: number;
}

let walletDbPromise: Promise<IDBPDatabase> | null = null;

function getWalletDB(): Promise<IDBPDatabase> {
  if (!walletDbPromise) {
    walletDbPromise = openDB(WALLET_DB_NAME, WALLET_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("wallets")) {
          db.createObjectStore("wallets", { keyPath: "publicKey" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      },
    });
  }
  return walletDbPromise;
}

async function getAllWallets(): Promise<StoredWallet[]> {
  const db = await getWalletDB();
  return db.getAll("wallets");
}

async function putWallet(wallet: StoredWallet): Promise<void> {
  const db = await getWalletDB();
  await db.put("wallets", wallet);
}

async function deleteWalletFromDB(publicKey: string): Promise<void> {
  const db = await getWalletDB();
  await db.delete("wallets", publicKey);
}

async function getActiveSetting(): Promise<string | null> {
  const db = await getWalletDB();
  const result = await db.get("settings", "activeWallet");
  return result?.value ?? null;
}

async function setActiveSetting(publicKey: string | null): Promise<void> {
  const db = await getWalletDB();
  await db.put("settings", { key: "activeWallet", value: publicKey });
}

async function getRpcSetting(): Promise<string> {
  const db = await getWalletDB();
  const result = await db.get("settings", "rpcUrl");
  return result?.value ?? "http://localhost:8899";
}

async function setRpcSetting(url: string): Promise<void> {
  const db = await getWalletDB();
  await db.put("settings", { key: "rpcUrl", value: url });
}

// ---------------------------------------------------------------------------
// Wallet Store API
// ---------------------------------------------------------------------------

export interface WalletInfo {
  publicKey: string;
  name: string;
  keypair: Keypair;
  balance: number; // SOL
  createdAt: number;
}

export interface WalletStoreAPI {
  wallets: Accessor<WalletInfo[]>;
  activeWallet: Accessor<WalletInfo | null>;
  rpcUrl: Accessor<string>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  airdropStatus: Accessor<string | null>;
  init: () => Promise<void>;
  createWallet: (name: string) => Promise<WalletInfo>;
  importWallet: (name: string, secretKey: Uint8Array) => Promise<WalletInfo>;
  renameWallet: (publicKey: string, name: string) => Promise<void>;
  deleteWallet: (publicKey: string) => Promise<void>;
  setActive: (publicKey: string) => Promise<void>;
  setRpc: (url: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
  airdrop: (publicKey: string, solAmount?: number) => Promise<void>;
}

export function createWalletStore(): WalletStoreAPI {
  const [wallets, setWallets] = createSignal<WalletInfo[]>([]);
  const [activeWallet, setActiveWallet] = createSignal<WalletInfo | null>(null);
  const [rpcUrl, setRpcUrl] = createSignal("http://localhost:8899");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [airdropStatus, setAirdropStatus] = createSignal<string | null>(null);

  function getConnection(): Connection {
    return new Connection(rpcUrl(), "confirmed");
  }

  function storedToInfo(stored: StoredWallet, balance: number = 0): WalletInfo {
    return {
      publicKey: stored.publicKey,
      name: stored.name,
      keypair: Keypair.fromSecretKey(new Uint8Array(stored.secretKey)),
      balance,
      createdAt: stored.createdAt,
    };
  }

  async function init(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const rpc = await getRpcSetting();
      setRpcUrl(rpc);

      const stored = await getAllWallets();
      const infos = stored.map((s) => storedToInfo(s));
      setWallets(infos);

      const activePk = await getActiveSetting();
      if (activePk) {
        const found = infos.find((w) => w.publicKey === activePk);
        setActiveWallet(found ?? null);
      }

      // Fetch balances in background
      refreshBalances().catch(() => {});
    } catch (err: any) {
      setError(err.message ?? "Failed to initialize wallets");
    } finally {
      setLoading(false);
    }
  }

  async function createWallet(name: string): Promise<WalletInfo> {
    const kp = Keypair.generate();
    const stored: StoredWallet = {
      publicKey: kp.publicKey.toBase58(),
      name,
      secretKey: Array.from(kp.secretKey),
      createdAt: Date.now(),
    };
    await putWallet(stored);

    const info = storedToInfo(stored);
    setWallets((prev) => [...prev, info]);

    // If no active wallet, make this one active
    if (!activeWallet()) {
      await setActive(info.publicKey);
    }

    return info;
  }

  async function importWallet(name: string, secretKey: Uint8Array): Promise<WalletInfo> {
    const kp = Keypair.fromSecretKey(secretKey);
    const stored: StoredWallet = {
      publicKey: kp.publicKey.toBase58(),
      name,
      secretKey: Array.from(kp.secretKey),
      createdAt: Date.now(),
    };
    await putWallet(stored);

    const info = storedToInfo(stored);
    setWallets((prev) => {
      const filtered = prev.filter((w) => w.publicKey !== info.publicKey);
      return [...filtered, info];
    });

    return info;
  }

  async function renameWallet(publicKey: string, name: string): Promise<void> {
    const current = wallets().find((w) => w.publicKey === publicKey);
    if (!current) return;

    const stored: StoredWallet = {
      publicKey,
      name,
      secretKey: Array.from(current.keypair.secretKey),
      createdAt: current.createdAt,
    };
    await putWallet(stored);

    setWallets((prev) =>
      prev.map((w) => (w.publicKey === publicKey ? { ...w, name } : w))
    );
    if (activeWallet()?.publicKey === publicKey) {
      setActiveWallet((prev) => prev ? { ...prev, name } : null);
    }
  }

  async function deleteWallet(publicKey: string): Promise<void> {
    await deleteWalletFromDB(publicKey);
    setWallets((prev) => prev.filter((w) => w.publicKey !== publicKey));

    if (activeWallet()?.publicKey === publicKey) {
      const remaining = wallets().filter((w) => w.publicKey !== publicKey);
      if (remaining.length > 0) {
        await setActive(remaining[0].publicKey);
      } else {
        setActiveWallet(null);
        await setActiveSetting(null);
      }
    }
  }

  async function setActive(publicKey: string): Promise<void> {
    const found = wallets().find((w) => w.publicKey === publicKey);
    if (found) {
      setActiveWallet(found);
      await setActiveSetting(publicKey);
    }
  }

  async function setRpc(url: string): Promise<void> {
    setRpcUrl(url);
    await setRpcSetting(url);
  }

  async function refreshBalances(): Promise<void> {
    const conn = getConnection();
    const current = wallets();
    const updated: WalletInfo[] = [];

    for (const w of current) {
      try {
        const balance = await conn.getBalance(w.keypair.publicKey);
        updated.push({ ...w, balance: balance / LAMPORTS_PER_SOL });
      } catch {
        updated.push({ ...w, balance: 0 });
      }
    }

    setWallets(updated);

    // Update active wallet balance too
    const active = activeWallet();
    if (active) {
      const found = updated.find((w) => w.publicKey === active.publicKey);
      if (found) setActiveWallet(found);
    }
  }

  async function airdrop(publicKey: string, solAmount: number = 10): Promise<void> {
    setAirdropStatus("Requesting airdrop...");
    setError(null);

    try {
      const conn = getConnection();
      const wallet = wallets().find((w) => w.publicKey === publicKey);
      if (!wallet) throw new Error("Wallet not found");

      const sig = await conn.requestAirdrop(
        wallet.keypair.publicKey,
        solAmount * LAMPORTS_PER_SOL
      );
      setAirdropStatus(`Confirming tx ${sig.slice(0, 8)}...`);

      await conn.confirmTransaction(sig, "confirmed");
      setAirdropStatus(`Airdropped ${solAmount} SOL`);

      // Refresh balances
      await refreshBalances();

      // Clear status after a delay
      setTimeout(() => setAirdropStatus(null), 3000);
    } catch (err: any) {
      setError(err.message ?? "Airdrop failed");
      setAirdropStatus(null);
    }
  }

  return {
    wallets,
    activeWallet,
    rpcUrl,
    loading,
    error,
    airdropStatus,
    init,
    createWallet,
    importWallet,
    renameWallet,
    deleteWallet,
    setActive,
    setRpc,
    refreshBalances,
    airdrop,
  };
}
