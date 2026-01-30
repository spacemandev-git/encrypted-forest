/**
 * Reactive player state store (SolidJS).
 *
 * Wraps core SDK player fetching + subscription.
 * Provides derived values for total ships, metal, and owned planets.
 */

import { createSignal, createMemo, type Accessor } from "solid-js";
import type { EncryptedForestClient } from "@encrypted-forest/core";
import type { Player, Subscription } from "@encrypted-forest/core";
import type { PublicKey } from "@solana/web3.js";
import type { PlanetsStoreAPI, PlanetEntry } from "./planets.js";

export interface PlayerStoreAPI {
  player: Accessor<Player | null>;
  playerPubkey: Accessor<PublicKey | null>;
  playerId: Accessor<bigint | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  hasSpawned: Accessor<boolean>;
  points: Accessor<bigint>;
  ownedPlanetsList: Accessor<PlanetEntry[]>;
  ownedPlanets: Accessor<number>;
  totalShips: Accessor<bigint>;
  totalMetal: Accessor<bigint>;
  load: (gameId: bigint, playerPubkey: PublicKey, playerId: bigint) => Promise<void>;
  refresh: (gameId: bigint) => Promise<void>;
  destroy: () => void;
}

export function createPlayerStore(
  client: EncryptedForestClient,
  planetsStore: PlanetsStoreAPI
): PlayerStoreAPI {
  const [player, setPlayer] = createSignal<Player | null>(null);
  const [playerPubkey, setPlayerPubkey] = createSignal<PublicKey | null>(null);
  const [playerId, setPlayerId] = createSignal<bigint | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let subscription: Subscription | null = null;

  const hasSpawned = createMemo(() => player()?.hasSpawned ?? false);
  const points = createMemo(() => player()?.points ?? 0n);

  const ownedPlanetsList = createMemo((): PlanetEntry[] => {
    const pid = playerId();
    if (pid === null) return [];
    return planetsStore.ownedBy()(pid);
  });

  const ownedPlanets = createMemo(() => ownedPlanetsList().length);

  const totalShips = createMemo(() => {
    let total = 0n;
    for (const entry of ownedPlanetsList()) {
      if (entry.decrypted) {
        total += BigInt(entry.decrypted.dynamic.shipCount);
      }
    }
    return total;
  });

  const totalMetal = createMemo(() => {
    let total = 0n;
    for (const entry of ownedPlanetsList()) {
      if (entry.decrypted) {
        total += BigInt(entry.decrypted.dynamic.metalCount);
      }
    }
    return total;
  });

  function unsubscribe(): void {
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
  }

  async function load(gameId: bigint, pubkey: PublicKey, pid: bigint): Promise<void> {
    setLoading(true);
    setError(null);
    setPlayerPubkey(pubkey);
    setPlayerId(pid);

    try {
      unsubscribe();

      setPlayer(await client.getPlayer(gameId, pubkey));

      subscription = client.subscribeToPlayer(gameId, pubkey, (_accountInfo) => {
        client
          .getPlayer(gameId, pubkey)
          .then((p) => setPlayer(p))
          .catch((err) => setError(`Failed to refresh player: ${err.message}`));
      });
    } catch (err: any) {
      setError(err.message ?? "Failed to load player");
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }

  async function refresh(gameId: bigint): Promise<void> {
    const pubkey = playerPubkey();
    if (!pubkey) return;
    try {
      setPlayer(await client.getPlayer(gameId, pubkey));
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to refresh player");
    }
  }

  function destroy(): void {
    unsubscribe();
    setPlayer(null);
    setPlayerPubkey(null);
    setPlayerId(null);
    setError(null);
  }

  return {
    player,
    playerPubkey,
    playerId,
    loading,
    error,
    hasSpawned,
    points,
    ownedPlanetsList,
    ownedPlanets,
    totalShips,
    totalMetal,
    load,
    refresh,
    destroy,
  };
}
