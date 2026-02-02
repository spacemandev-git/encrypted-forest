/**
 * Reusable draggable panel wrapper. Renders a TUI-styled panel with a
 * title bar that can be grabbed to drag the panel around the screen.
 * Supports minimize (collapse to title bar only) and position persistence.
 */

import { createSignal, type JSX } from "solid-js";
import tui from "../styles/tui.module.css";

interface DraggablePanelProps {
  title: string;
  /** Extra content rendered after the title text in the title bar */
  titleExtra?: JSX.Element;
  /** Initial CSS position values (used when x/y not provided) */
  initialX?: number;
  initialY?: number;
  /** Controlled position — overrides initialX/initialY */
  x?: number;
  y?: number;
  /** Called whenever the panel is dragged to a new position */
  onPositionChange?: (x: number, y: number) => void;
  width?: string;
  zIndex?: number;
  maxHeight?: string;
  minimizable?: boolean;
  borderColor?: string;
  onClose?: () => void;
  children: JSX.Element;
}

export default function DraggablePanel(props: DraggablePanelProps) {
  const [x, setX] = createSignal(props.x ?? props.initialX ?? 100);
  const [y, setY] = createSignal(props.y ?? props.initialY ?? 100);
  const [minimized, setMinimized] = createSignal(false);

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function updatePos(nx: number, ny: number) {
    const cx = Math.max(0, Math.min(window.innerWidth - 60, nx));
    const cy = Math.max(0, Math.min(window.innerHeight - 30, ny));
    setX(cx);
    setY(cy);
    props.onPositionChange?.(cx, cy);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // Don't start drag when clicking buttons in the title bar
    if ((e.target as HTMLElement).closest("button")) return;
    dragging = true;
    offsetX = e.clientX - x();
    offsetY = e.clientY - y();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    updatePos(e.clientX - offsetX, e.clientY - offsetY);
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
        "max-height": minimized() ? "auto" : (props.maxHeight ?? "calc(100vh - 40px)"),
        "user-select": "none",
        ...(props.borderColor ? { "border-color": props.borderColor } : {}),
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
          "border-bottom": minimized() ? "none" : "1px solid #333333",
          "flex-shrink": "0",
        }}
      >
        <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
          <span class={tui.accent} style={{ "font-size": "12px", "font-weight": "600" }}>
            {props.title}
          </span>
          {props.titleExtra}
        </span>
        <div style={{ display: "flex", gap: "4px" }}>
          {props.minimizable !== false && (
            <button
              class={tui.button}
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(!minimized());
              }}
              style={{ padding: "0px 6px", "font-size": "10px", "line-height": "1.2" }}
            >
              {minimized() ? "+" : "\u2013"}
            </button>
          )}
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
      </div>

      {/* Content */}
      {!minimized() && (
        <div
          style={{
            padding: "10px",
            "overflow-y": "auto",
            flex: "1",
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}
