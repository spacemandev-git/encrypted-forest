<script lang="ts">
  let {
    playerPubkey = "",
    points = 0n,
    totalShips = 0n,
    totalMetal = 0n,
    ownedPlanets = 0,
    discoveredPlanets = 0,
    exploredCoords = 0,
    connected = false,
    onconnect,
  }: {
    playerPubkey?: string;
    points?: bigint;
    totalShips?: bigint;
    totalMetal?: bigint;
    ownedPlanets?: number;
    discoveredPlanets?: number;
    exploredCoords?: number;
    connected?: boolean;
    onconnect?: () => void;
  } = $props();

  let shortPubkey = $derived(
    playerPubkey
      ? `${playerPubkey.slice(0, 4)}...${playerPubkey.slice(-4)}`
      : "Not connected"
  );
</script>

<div class="hud">
  <div class="hud-section hud-player">
    {#if connected}
      <div class="hud-label">Player</div>
      <div class="hud-value">{shortPubkey}</div>
    {:else}
      <button class="hud-connect-btn" onclick={onconnect}>
        Connect Wallet
      </button>
    {/if}
  </div>

  {#if connected}
    <div class="hud-section">
      <div class="hud-label">Points</div>
      <div class="hud-value">{points.toString()}</div>
    </div>

    <div class="hud-section">
      <div class="hud-label">Ships</div>
      <div class="hud-value">{totalShips.toString()}</div>
    </div>

    <div class="hud-section">
      <div class="hud-label">Metal</div>
      <div class="hud-value">{totalMetal.toString()}</div>
    </div>

    <div class="hud-section">
      <div class="hud-label">Planets</div>
      <div class="hud-value">{ownedPlanets} owned / {discoveredPlanets} found</div>
    </div>

    <div class="hud-section">
      <div class="hud-label">Explored</div>
      <div class="hud-value">{exploredCoords} coords</div>
    </div>
  {/if}
</div>

<style>
  .hud {
    position: fixed;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 16px;
    pointer-events: auto;
    z-index: 100;
  }

  .hud-section {
    background: rgba(10, 10, 30, 0.85);
    border: 1px solid rgba(100, 100, 200, 0.3);
    border-radius: 6px;
    padding: 8px 14px;
    min-width: 80px;
  }

  .hud-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8888bb;
    margin-bottom: 2px;
  }

  .hud-value {
    font-size: 14px;
    font-weight: 600;
    color: #e0e0ff;
  }

  .hud-connect-btn {
    background: linear-gradient(135deg, #1a1a4e, #2a2a6e);
    color: #e0e0ff;
    border: 1px solid rgba(100, 100, 200, 0.5);
    border-radius: 6px;
    padding: 10px 20px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: background 0.2s;
  }

  .hud-connect-btn:hover {
    background: linear-gradient(135deg, #2a2a6e, #3a3a8e);
  }
</style>
