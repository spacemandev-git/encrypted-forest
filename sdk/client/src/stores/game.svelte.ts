/**
 * Reactive game state store.
 *
 * Wraps core SDK fetchGame + subscribeToGame with Svelte 5 runes.
 * Auto-subscribes to account changes via RPC websockets.
 */

import type { EncryptedForestClient } from "@encrypted-forest/core";
import type { Game } from "@encrypted-forest/core";
import type { Subscription } from "@encrypted-forest/core";

export class GameStore {
  #client: EncryptedForestClient;
  #subscription: Subscription | null = null;

  game = $state<Game | null>(null);
  gameId = $state<bigint | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  /** Whether the game has started (current slot >= startSlot) */
  started = $derived(
    this.game !== null && this.game.startSlot <= BigInt(Date.now())
  );

  /** Whether the game has ended */
  ended = $derived(
    this.game !== null && this.game.endSlot <= BigInt(Date.now())
  );

  /** Map diameter from game config */
  mapDiameter = $derived(this.game?.mapDiameter ?? 0n);

  /** Game speed from game config */
  gameSpeed = $derived(this.game?.gameSpeed ?? 1n);

  /** Noise thresholds from game config */
  noiseThresholds = $derived(this.game?.noiseThresholds ?? null);

  constructor(client: EncryptedForestClient) {
    this.#client = client;
  }

  /**
   * Load a game by ID and subscribe to updates.
   */
  async load(gameId: bigint): Promise<void> {
    this.loading = true;
    this.error = null;
    this.gameId = gameId;

    try {
      // Unsubscribe from previous game
      this.#unsubscribe();

      // Fetch current state
      this.game = await this.#client.getGame(gameId);

      // Subscribe to account changes
      this.#subscription = this.#client.subscribeToGame(
        gameId,
        (_accountInfo) => {
          // Re-fetch on change to get properly deserialized data
          this.#client.getGame(gameId).then((game) => {
            this.game = game;
          }).catch((err) => {
            this.error = `Failed to refresh game: ${err.message}`;
          });
        }
      );
    } catch (err: any) {
      this.error = err.message ?? "Failed to load game";
      this.game = null;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Refresh the game state from chain.
   */
  async refresh(): Promise<void> {
    if (this.gameId === null) return;
    try {
      this.game = await this.#client.getGame(this.gameId);
      this.error = null;
    } catch (err: any) {
      this.error = err.message ?? "Failed to refresh game";
    }
  }

  /**
   * Clean up subscription.
   */
  destroy(): void {
    this.#unsubscribe();
    this.game = null;
    this.gameId = null;
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
 * Create a reactive game store.
 */
export function createGameStore(client: EncryptedForestClient): GameStore {
  return new GameStore(client);
}
