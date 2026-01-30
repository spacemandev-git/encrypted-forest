/**
 * Game session store — holds the active game ID, fetched Game account data,
 * and provides scoping context for IndexedDB persistence.
 *
 * The miner reads hashRounds from here instead of accepting it as a parameter.
 */

import { createSignal, createMemo, type Accessor } from "solid-js";
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import type { Game, NoiseThresholds, CreateGameArgs } from "@encrypted-forest/core";
import { DEFAULT_THRESHOLDS, DEFAULT_HASH_ROUNDS, deriveGamePDA, PROGRAM_ID, idlJson, buildCreateGameIx } from "@encrypted-forest/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameSessionAPI {
  /** Current game ID (null if no game selected) */
  gameId: Accessor<bigint | null>;
  /** Fetched Game account data (null if not loaded) */
  game: Accessor<Game | null>;
  /** Noise thresholds (defaults if no game loaded) */
  thresholds: Accessor<NoiseThresholds>;
  /** Hash rounds from game account (default if not loaded) */
  hashRounds: Accessor<number>;
  /** Map diameter from game account */
  mapDiameter: Accessor<number>;
  /** Whether we're currently loading game data */
  loading: Accessor<boolean>;
  /** Error message if fetch failed */
  error: Accessor<string | null>;
  /** Scope key for IndexedDB (gameId:walletPubkey) */
  scopeKey: Accessor<string | null>;

  /** Join an existing game by ID — fetches the Game account from chain */
  joinGame: (gameId: bigint, rpcUrl: string, walletPubkey: string) => Promise<void>;
  /** Create a new game on-chain and enter it */
  createGame: (args: CreateGameArgs, rpcUrl: string, keypair: Keypair) => Promise<void>;
  /** Leave the current game session */
  leaveGame: () => void;
  /** Update the wallet pubkey (changes scope) */
  setWalletPubkey: (pubkey: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertGameRaw(raw: any): Game {
  let winCondition: Game["winCondition"];
  if (raw.winCondition.pointsBurning) {
    winCondition = {
      pointsBurning: {
        pointsPerMetal: BigInt(raw.winCondition.pointsBurning.pointsPerMetal.toString()),
      },
    };
  } else {
    winCondition = {
      raceToCenter: {
        minSpawnDistance: BigInt(raw.winCondition.raceToCenter.minSpawnDistance.toString()),
      },
    };
  }

  return {
    admin: raw.admin,
    gameId: BigInt(raw.gameId.toString()),
    mapDiameter: BigInt(raw.mapDiameter.toString()),
    gameSpeed: BigInt(raw.gameSpeed.toString()),
    startSlot: BigInt(raw.startSlot.toString()),
    endSlot: BigInt(raw.endSlot.toString()),
    winCondition,
    whitelist: raw.whitelist,
    serverPubkey: raw.serverPubkey ?? null,
    noiseThresholds: raw.noiseThresholds as NoiseThresholds,
    hashRounds: raw.hashRounds ?? DEFAULT_HASH_ROUNDS,
  };
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createGameSession(): GameSessionAPI {
  const [gameId, setGameId] = createSignal<bigint | null>(null);
  const [game, setGame] = createSignal<Game | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [walletPubkey, setWalletPubkeySignal] = createSignal<string | null>(null);

  const thresholds = createMemo<NoiseThresholds>(() => {
    return game()?.noiseThresholds ?? DEFAULT_THRESHOLDS;
  });

  const hashRounds = createMemo<number>(() => {
    return game()?.hashRounds ?? DEFAULT_HASH_ROUNDS;
  });

  const mapDiameter = createMemo<number>(() => {
    const g = game();
    return g ? Number(g.mapDiameter) : 100;
  });

  const scopeKey = createMemo<string | null>(() => {
    const gid = gameId();
    const wp = walletPubkey();
    if (gid == null || !wp) return null;
    return `${gid.toString()}:${wp}`;
  });

  async function joinGame(gid: bigint, rpcUrl: string, walletPk: string): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const connection = new Connection(rpcUrl, "confirmed");

      // Create a read-only Anchor provider (no signing needed for fetch)
      const provider = new AnchorProvider(
        connection,
        // Dummy wallet — we only need to read, not sign
        { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
        { commitment: "confirmed" }
      );

      const program = new Program(idlJson as any, provider);
      const [gamePDA] = deriveGamePDA(gid, program.programId);
      const raw = await (program.account as any).game.fetch(gamePDA);
      const gameData = convertGameRaw(raw);

      setGameId(gid);
      setGame(gameData);
      setWalletPubkeySignal(walletPk);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch game account");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function createGame(args: CreateGameArgs, rpcUrl: string, keypair: Keypair): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const provider = new AnchorProvider(
        connection,
        {
          publicKey: keypair.publicKey,
          signTransaction: async (tx: any) => { tx.sign(keypair); return tx; },
          signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(keypair)); return txs; },
        } as any,
        { commitment: "confirmed" }
      );

      const program = new Program(idlJson as any, provider);
      const txBuilder = buildCreateGameIx(program, keypair.publicKey, args);
      await txBuilder.rpc();

      // Set session to the newly created game
      setGameId(args.gameId);
      setGame({
        admin: keypair.publicKey,
        gameId: args.gameId,
        mapDiameter: args.mapDiameter,
        gameSpeed: args.gameSpeed,
        startSlot: args.startSlot,
        endSlot: args.endSlot,
        winCondition: args.winCondition,
        whitelist: args.whitelist,
        serverPubkey: args.serverPubkey,
        noiseThresholds: args.noiseThresholds,
        hashRounds: args.hashRounds,
      });
      setWalletPubkeySignal(keypair.publicKey.toBase58());
    } catch (err: any) {
      setError(err.message ?? "Failed to create game");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function leaveGame(): void {
    setGameId(null);
    setGame(null);
    setError(null);
    setWalletPubkeySignal(null);
  }

  function setWalletPubkey(pubkey: string): void {
    setWalletPubkeySignal(pubkey);
  }

  return {
    gameId,
    game,
    thresholds,
    hashRounds,
    mapDiameter,
    loading,
    error,
    scopeKey,
    joinGame,
    createGame,
    leaveGame,
    setWalletPubkey,
  };
}
