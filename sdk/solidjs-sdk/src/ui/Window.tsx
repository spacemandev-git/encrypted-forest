/**
 * SolidJS draggable window component.
 */

import { createSignal, type JSX, type ParentProps, Show } from "solid-js";
import styles from "./Window.module.css";

interface WindowComponentProps extends ParentProps {
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
  onVisibleChange?: (visible: boolean) => void;
  onPositionChange?: (x: number, y: number) => void;
  onSizeChange?: (width: number, height: number) => void;
}

export default function Window(props: WindowComponentProps) {
  const title = () => props.title ?? "Window";
  const minWidth = () => props.minWidth ?? 200;
  const minHeight = () => props.minHeight ?? 150;
  const resizable = () => props.resizable ?? true;
  const minimizable = () => props.minimizable ?? true;
  const closable = () => props.closable ?? true;

  const [posX, setPosX] = createSignal(props.x ?? 100);
  const [posY, setPosY] = createSignal(props.y ?? 100);
  const [w, setW] = createSignal(props.width ?? 400);
  const [h, setH] = createSignal(props.height ?? 300);
  const [visible, setVisible] = createSignal(props.visible ?? true);
  const [minimized, setMinimized] = createSignal(false);
  const [zIndex, setZIndex] = createSignal(props.zIndex ?? 10);

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;

  function handleFocus() {
    props.onfocus?.();
  }

  function handleClose() {
    setVisible(false);
    props.onVisibleChange?.(false);
    props.onclose?.();
  }

  function handleMinimize() {
    setMinimized(!minimized());
  }

  // Drag logic
  function onDragStart(e: PointerEvent) {
    if ((e.target as HTMLElement).closest(`.${styles.windowControls}`)) return;
    dragging = true;
    dragOffsetX = e.clientX - posX();
    dragOffsetY = e.clientY - posY();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleFocus();
  }

  function onDragMove(e: PointerEvent) {
    if (!dragging) return;
    let nx = e.clientX - dragOffsetX;
    let ny = e.clientY - dragOffsetY;
    if (nx < 0) nx = 0;
    if (ny < 0) ny = 0;
    setPosX(nx);
    setPosY(ny);
    props.onPositionChange?.(nx, ny);
  }

  function onDragEnd() {
    dragging = false;
  }

  // Resize logic
  function onResizeStart(e: PointerEvent) {
    if (!resizable()) return;
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = w();
    resizeStartH = h();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    const newW = Math.max(minWidth(), resizeStartW + (e.clientX - resizeStartX));
    const newH = Math.max(minHeight(), resizeStartH + (e.clientY - resizeStartY));
    setW(newW);
    setH(newH);
    props.onSizeChange?.(newW, newH);
  }

  function onResizeEnd() {
    resizing = false;
  }

  return (
    <Show when={visible()}>
      <div
        class={styles.efWindow}
        style={{
          left: `${posX()}px`,
          top: `${posY()}px`,
          width: `${w()}px`,
          height: minimized() ? "auto" : `${h()}px`,
          "z-index": zIndex(),
        }}
        onPointerDown={handleFocus}
      >
        {/* Title bar */}
        <div
          class={styles.efWindowTitlebar}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
        >
          <span class={styles.efWindowTitle}>{title()}</span>
          <div class={styles.windowControls}>
            <Show when={minimizable()}>
              <button
                class={`${styles.efWindowBtn} ${styles.efWindowBtnMinimize}`}
                onClick={handleMinimize}
                aria-label={minimized() ? "Restore" : "Minimize"}
              >
                {minimized() ? "+" : "-"}
              </button>
            </Show>
            <Show when={closable()}>
              <button
                class={`${styles.efWindowBtn} ${styles.efWindowBtnClose}`}
                onClick={handleClose}
                aria-label="Close"
              >
                x
              </button>
            </Show>
          </div>
        </div>

        {/* Content */}
        <Show when={!minimized()}>
          <div class={styles.efWindowContent}>{props.children}</div>

          {/* Resize handle */}
          <Show when={resizable()}>
            <div
              class={styles.efWindowResizeHandle}
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
            />
          </Show>
        </Show>
      </div>
    </Show>
  );
}
