/**
 * Reactive game state store (SolidJS).
 *
 * Wraps core SDK fetchGame + subscribeToGame with SolidJS signals.
 * Auto-subscribes to account changes via RPC websockets.
 */

import { createSignal, createMemo, type Accessor } from "solid-js";
import type { EncryptedForestClient } from "@encrypted-forest/core";
import type { Game } from "@encrypted-forest/core";
import type { Subscription } from "@encrypted-forest/core";

export interface GameStoreAPI {
  game: Accessor<Game | null>;
  gameId: Accessor<bigint | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  /** Whether the game has started (currentSlot >= startSlot). Call setCurrentSlot() to keep this accurate. */
  started: Accessor<boolean>;
  /** Whether the game has ended (currentSlot > endSlot). Call setCurrentSlot() to keep this accurate. */
  ended: Accessor<boolean>;
  mapDiameter: Accessor<bigint>;
  gameSpeed: Accessor<bigint>;
  noiseThresholds: Accessor<Game["noiseThresholds"] | null>;
  /** Update the current slot for started/ended calculations */
  setCurrentSlot: (slot: bigint) => void;
  load: (gameId: bigint) => Promise<void>;
  refresh: () => Promise<void>;
  destroy: () => void;
}

export function createGameStore(client: EncryptedForestClient): GameStoreAPI {
  const [game, setGame] = createSignal<Game | null>(null);
  const [gameId, setGameId] = createSignal<bigint | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [currentSlot, setCurrentSlot] = createSignal<bigint>(0n);

  let subscription: Subscription | null = null;

  const started = createMemo(
    () => game() !== null && currentSlot() >= game()!.startSlot
  );

  const ended = createMemo(
    () => game() !== null && currentSlot() > game()!.endSlot
  );

  const mapDiameter = createMemo(() => game()?.mapDiameter ?? 0n);
  const gameSpeed = createMemo(() => game()?.gameSpeed ?? 1n);
  const noiseThresholds = createMemo(() => game()?.noiseThresholds ?? null);

  function unsubscribe(): void {
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
  }

  async function load(id: bigint): Promise<void> {
    setLoading(true);
    setError(null);
    setGameId(id);

    try {
      unsubscribe();

      setGame(await client.getGame(id));

      subscription = client.subscribeToGame(id, (_accountInfo) => {
        client
          .getGame(id)
          .then((g) => setGame(g))
          .catch((err) => setError(`Failed to refresh game: ${err.message}`));
      });
    } catch (err: any) {
      setError(err.message ?? "Failed to load game");
      setGame(null);
    } finally {
      setLoading(false);
    }
  }

  async function refresh(): Promise<void> {
    const id = gameId();
    if (id === null) return;
    try {
      setGame(await client.getGame(id));
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to refresh game");
    }
  }

  function destroy(): void {
    unsubscribe();
    setGame(null);
    setGameId(null);
    setError(null);
  }

  return {
    game,
    gameId,
    loading,
    error,
    started,
    ended,
    mapDiameter,
    gameSpeed,
    noiseThresholds,
    setCurrentSlot,
    load,
    refresh,
    destroy,
  };
}
