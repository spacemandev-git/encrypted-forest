/**
 * Reactive player state store.
 *
 * Wraps core SDK player fetching + subscription.
 * Provides derived values for total ships, metal, and owned planets.
 */

import type { EncryptedForestClient } from "@encrypted-forest/core";
import type { Player, Subscription } from "@encrypted-forest/core";
import type { PublicKey } from "@solana/web3.js";
import type { PlanetsStore } from "./planets.svelte.js";

export class PlayerStore {
  #client: EncryptedForestClient;
  #planetsStore: PlanetsStore;
  #subscription: Subscription | null = null;

  player = $state<Player | null>(null);
  playerPubkey = $state<PublicKey | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  /** Whether the player has spawned */
  hasSpawned = $derived(this.player?.hasSpawned ?? false);

  /** Player points */
  points = $derived(this.player?.points ?? 0n);

  /** Number of planets owned by this player */
  ownedPlanets = $derived.by(() => {
    if (!this.playerPubkey) return 0;
    const ownerStr = this.playerPubkey.toBase58();
    return [...this.#planetsStore.planets.values()].filter(
      (p) => p.onChain?.owner?.toBase58() === ownerStr
    ).length;
  });

  /** Total ships across all owned planets */
  totalShips = $derived.by(() => {
    if (!this.playerPubkey) return 0n;
    const ownerStr = this.playerPubkey.toBase58();
    let total = 0n;
    for (const entry of this.#planetsStore.planets.values()) {
      if (entry.onChain?.owner?.toBase58() === ownerStr) {
        total += entry.onChain.shipCount;
      }
    }
    return total;
  });

  /** Total metal across all owned planets */
  totalMetal = $derived.by(() => {
    if (!this.playerPubkey) return 0n;
    const ownerStr = this.playerPubkey.toBase58();
    let total = 0n;
    for (const entry of this.#planetsStore.planets.values()) {
      if (entry.onChain?.owner?.toBase58() === ownerStr) {
        total += entry.onChain.metalCount;
      }
    }
    return total;
  });

  /** List of owned planet entries */
  ownedPlanetsList = $derived.by(() => {
    if (!this.playerPubkey) return [];
    const ownerStr = this.playerPubkey.toBase58();
    return [...this.#planetsStore.planets.values()].filter(
      (p) => p.onChain?.owner?.toBase58() === ownerStr
    );
  });

  constructor(client: EncryptedForestClient, planetsStore: PlanetsStore) {
    this.#client = client;
    this.#planetsStore = planetsStore;
  }

  /**
   * Load a player and subscribe to updates.
   */
  async load(gameId: bigint, playerPubkey: PublicKey): Promise<void> {
    this.loading = true;
    this.error = null;
    this.playerPubkey = playerPubkey;

    try {
      this.#unsubscribe();

      this.player = await this.#client.getPlayer(gameId, playerPubkey);

      this.#subscription = this.#client.subscribeToPlayer(
        gameId,
        playerPubkey,
        (_accountInfo) => {
          this.#client
            .getPlayer(gameId, playerPubkey)
            .then((player) => {
              this.player = player;
            })
            .catch((err) => {
              this.error = `Failed to refresh player: ${err.message}`;
            });
        }
      );
    } catch (err: any) {
      this.error = err.message ?? "Failed to load player";
      this.player = null;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Refresh the player state from chain.
   */
  async refresh(gameId: bigint): Promise<void> {
    if (!this.playerPubkey) return;
    try {
      this.player = await this.#client.getPlayer(gameId, this.playerPubkey);
      this.error = null;
    } catch (err: any) {
      this.error = err.message ?? "Failed to refresh player";
    }
  }

  /**
   * Clean up subscription.
   */
  destroy(): void {
    this.#unsubscribe();
    this.player = null;
    this.playerPubkey = null;
    this.error = null;
  }

  #unsubscribe(): void {
    if (this.#subscription) {
      this.#subscription.remove();
      this.#subscription = null;
    }
  }
}

/**
 * Create a reactive player store.
 */
export function createPlayerStore(
  client: EncryptedForestClient,
  planetsStore: PlanetsStore
): PlayerStore {
  return new PlayerStore(client, planetsStore);
}
