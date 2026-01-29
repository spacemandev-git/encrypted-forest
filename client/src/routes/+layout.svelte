<script lang="ts">
  let { children } = $props();
</script>

<div class="app-shell">
  {@render children()}
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #050510;
    color: #e0e0ff;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  }

  .app-shell {
    width: 100vw;
    height: 100vh;
    position: relative;
    overflow: hidden;
  }
</style>
