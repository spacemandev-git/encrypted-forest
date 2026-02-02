/**
 * Reusable draggable panel wrapper. Renders a TUI-styled panel with a
 * title bar that can be grabbed to drag the panel around the screen.
 */

import { createSignal, onMount, onCleanup, type JSX } from "solid-js";
import tui from "../styles/tui.module.css";

interface DraggablePanelProps {
  title: string;
  /** Initial CSS position values */
  initialX?: number;
  initialY?: number;
  width?: string;
  zIndex?: number;
  maxHeight?: string;
  onClose?: () => void;
  children: JSX.Element;
}

export default function DraggablePanel(props: DraggablePanelProps) {
  const [x, setX] = createSignal(props.initialX ?? 100);
  const [y, setY] = createSignal(props.initialY ?? 100);

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function onPointerDown(e: PointerEvent) {
    // Only drag on left mouse button
    if (e.button !== 0) return;
    dragging = true;
    offsetX = e.clientX - x();
    offsetY = e.clientY - y();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const nx = e.clientX - offsetX;
    const ny = e.clientY - offsetY;
    // Clamp to viewport
    setX(Math.max(0, Math.min(window.innerWidth - 60, nx)));
    setY(Math.max(0, Math.min(window.innerHeight - 30, ny)));
  }

  function onPointerUp() {
    dragging = false;
  }

  return (
    <div
      class={tui.panel}
      style={{
        position: "fixed",
        left: `${x()}px`,
        top: `${y()}px`,
        width: props.width ?? "280px",
        "z-index": (props.zIndex ?? 200).toString(),
        display: "flex",
        "flex-direction": "column",
        "max-height": props.maxHeight ?? "calc(100vh - 40px)",
        "user-select": "none",
      }}
    >
      {/* Drag handle / title bar */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          padding: "6px 10px",
          cursor: "grab",
          "border-bottom": "1px solid #333333",
          "flex-shrink": "0",
        }}
      >
        <span class={tui.accent} style={{ "font-size": "12px", "font-weight": "600" }}>
          {props.title}
        </span>
        {props.onClose && (
          <button
            class={tui.button}
            onClick={(e) => {
              e.stopPropagation();
              props.onClose!();
            }}
            style={{ padding: "0px 6px", "font-size": "10px", "line-height": "1.2" }}
          >
            X
          </button>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          padding: "10px",
          "overflow-y": "auto",
          flex: "1",
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
