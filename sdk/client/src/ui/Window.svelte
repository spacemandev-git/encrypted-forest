<script lang="ts">
  let {
    title = "Window",
    visible = $bindable(true),
    x = $bindable(100),
    y = $bindable(100),
    width = $bindable(400),
    height = $bindable(300),
    minWidth = 200,
    minHeight = 150,
    resizable = true,
    minimizable = true,
    closable = true,
    zIndex = $bindable(10),
    onclose,
    onfocus,
    children,
  }: {
    title?: string;
    visible?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    minimizable?: boolean;
    closable?: boolean;
    zIndex?: number;
    onclose?: () => void;
    onfocus?: () => void;
    children?: import("svelte").Snippet;
  } = $props();

  let minimized = $state(false);
  let dragging = $state(false);
  let resizing = $state(false);
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;

  function handleFocus() {
    onfocus?.();
  }

  function handleClose() {
    visible = false;
    onclose?.();
  }

  function handleMinimize() {
    minimized = !minimized;
  }

  // -- Drag logic --
  function onDragStart(e: PointerEvent) {
    if ((e.target as HTMLElement).closest(".window-controls")) return;
    dragging = true;
    dragOffsetX = e.clientX - x;
    dragOffsetY = e.clientY - y;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleFocus();
  }

  function onDragMove(e: PointerEvent) {
    if (!dragging) return;
    x = e.clientX - dragOffsetX;
    y = e.clientY - dragOffsetY;

    // Clamp to viewport
    if (x < 0) x = 0;
    if (y < 0) y = 0;
  }

  function onDragEnd() {
    dragging = false;
  }

  // -- Resize logic --
  function onResizeStart(e: PointerEvent) {
    if (!resizable) return;
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = width;
    resizeStartH = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    const newW = resizeStartW + (e.clientX - resizeStartX);
    const newH = resizeStartH + (e.clientY - resizeStartY);
    width = Math.max(minWidth, newW);
    height = Math.max(minHeight, newH);
  }

  function onResizeEnd() {
    resizing = false;
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="ef-window"
    style="left: {x}px; top: {y}px; width: {width}px; height: {minimized ? 'auto' : height + 'px'}; z-index: {zIndex};"
    onpointerdown={handleFocus}
  >
    <!-- Title bar -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ef-window-titlebar"
      onpointerdown={onDragStart}
      onpointermove={onDragMove}
      onpointerup={onDragEnd}
    >
      <span class="ef-window-title">{title}</span>
      <div class="window-controls">
        {#if minimizable}
          <button
            class="ef-window-btn ef-window-btn-minimize"
            onclick={handleMinimize}
            aria-label={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? "+" : "-"}
          </button>
        {/if}
        {#if closable}
          <button
            class="ef-window-btn ef-window-btn-close"
            onclick={handleClose}
            aria-label="Close"
          >
            x
          </button>
        {/if}
      </div>
    </div>

    <!-- Content -->
    {#if !minimized}
      <div class="ef-window-content">
        {#if children}
          {@render children()}
        {/if}
      </div>

      <!-- Resize handle -->
      {#if resizable}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="ef-window-resize-handle"
          onpointerdown={onResizeStart}
          onpointermove={onResizeMove}
          onpointerup={onResizeEnd}
        ></div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .ef-window {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: #1a1a2e;
    border: 1px solid #333366;
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #e0e0ff;
    user-select: none;
  }

  .ef-window-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: linear-gradient(135deg, #16213e, #0f3460);
    cursor: grab;
    flex-shrink: 0;
  }

  .ef-window-titlebar:active {
    cursor: grabbing;
  }

  .ef-window-title {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    pointer-events: none;
  }

  .window-controls {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .ef-window-btn {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: bold;
    color: #e0e0ff;
    background: rgba(255, 255, 255, 0.1);
    transition: background 0.15s;
  }

  .ef-window-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .ef-window-btn-close:hover {
    background: #e74c3c;
    color: white;
  }

  .ef-window-content {
    flex: 1;
    overflow: auto;
    padding: 10px;
    user-select: text;
  }

  .ef-window-resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    cursor: se-resize;
    background: linear-gradient(
      135deg,
      transparent 50%,
      rgba(255, 255, 255, 0.15) 50%
    );
  }
</style>
