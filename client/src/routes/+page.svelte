<script lang="ts">
  import GameCanvas from "$components/GameCanvas.svelte";
  import HUD from "$components/HUD.svelte";
  import WindowManager from "$components/WindowManager.svelte";
  import type { GameScene } from "$game/scene";
  import type { WindowState } from "@encrypted-forest/client";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let connected = $state(false);
  let playerPubkey = $state("");
  let gameScene: GameScene | undefined = $state();

  // Demo window states
  let windows = $state<WindowState[]>([
    {
      id: "planet-info",
      title: "Planet Info",
      x: 50,
      y: 400,
      width: 320,
      height: 250,
      minimized: false,
      visible: false,
      zIndex: 10,
    },
    {
      id: "scan-controls",
      title: "Scan Controls",
      x: 400,
      y: 400,
      width: 300,
      height: 200,
      minimized: false,
      visible: false,
      zIndex: 11,
    },
  ]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSceneCreated(scene: GameScene) {
    gameScene = scene;
  }

  function handleConnect() {
    // Placeholder: wallet connection will be implemented
    // when integrating with Solana wallet adapter
    connected = true;
    playerPubkey = "Demo1234...5678";

    // Show UI windows on connect
    for (const win of windows) {
      win.visible = true;
    }
  }
</script>

<svelte:head>
  <title>Encrypted Forest</title>
</svelte:head>

<!-- ThreeJS Canvas (full viewport) -->
<GameCanvas onscenecreated={handleSceneCreated} />

<!-- HUD Overlay -->
<HUD
  {playerPubkey}
  {connected}
  onconnect={handleConnect}
  points={0n}
  totalShips={0n}
  totalMetal={0n}
  ownedPlanets={0}
  discoveredPlanets={0}
  exploredCoords={0}
/>

<!-- Window Manager for modular panels -->
<WindowManager {windows} />

<style>
  :global(.game-canvas) {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 0;
  }
</style>
