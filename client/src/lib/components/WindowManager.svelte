<script lang="ts">
  import { Window } from "@encrypted-forest/client";
  import type { WindowState } from "@encrypted-forest/client";

  let {
    windows = [],
  }: {
    windows?: WindowState[];
  } = $props();

  let topZIndex = $state(100);

  function bringToFront(id: string) {
    topZIndex += 1;
    const win = windows.find((w) => w.id === id);
    if (win) {
      win.zIndex = topZIndex;
    }
  }
</script>

{#each windows as win (win.id)}
  <Window
    title={win.title}
    bind:visible={win.visible}
    bind:x={win.x}
    bind:y={win.y}
    bind:width={win.width}
    bind:height={win.height}
    zIndex={win.zIndex}
    onfocus={() => bringToFront(win.id)}
  >
    <p>Window content: {win.id}</p>
  </Window>
{/each}
