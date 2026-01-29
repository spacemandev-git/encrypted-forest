<script lang="ts">
  import { createGameScene, type GameScene } from "$game/scene";

  let {
    onscenecreated,
  }: {
    onscenecreated?: (scene: GameScene) => void;
  } = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let gameScene: GameScene | undefined = $state();
  let animationId: number = 0;

  $effect(() => {
    if (!canvasEl) return;

    // Initialize scene
    const scene = createGameScene(canvasEl);
    gameScene = scene;

    // Notify parent
    onscenecreated?.(scene);

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          scene.resize(width, height);
        }
      }
    });
    resizeObserver.observe(canvasEl);

    // Initial size
    scene.resize(canvasEl.clientWidth, canvasEl.clientHeight);

    // Animation loop
    function animate() {
      animationId = requestAnimationFrame(animate);
      scene.render();
    }
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      scene.dispose();
    };
  });
</script>

<canvas bind:this={canvasEl} class="game-canvas"></canvas>

<style>
  .game-canvas {
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
  }
</style>
