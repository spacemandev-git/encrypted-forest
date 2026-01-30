/**
 * Bottom status bar.
 */

import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import tui from "../styles/tui.module.css";

interface StatusBarProps {
  hoveredCell: Accessor<{ x: number; y: number } | null>;
  zoom: Accessor<number>;
  connected: Accessor<boolean>;
}

export default function StatusBar(props: StatusBarProps) {
  return (
    <div
      class={tui.panel}
      style={{
        position: "fixed",
        bottom: "0",
        left: "0",
        right: "0",
        display: "flex",
        "align-items": "center",
        gap: "16px",
        padding: "2px 16px",
        "z-index": "100",
        "font-size": "11px",
        "border-bottom": "none",
        "border-left": "none",
        "border-right": "none",
      }}
    >
      <Show when={props.hoveredCell()}>
        <span>
          <span class={tui.label}>POS </span>
          <span class={tui.value}>
            {props.hoveredCell()!.x},{props.hoveredCell()!.y}
          </span>
        </span>
      </Show>
      <span>
        <span class={tui.label}>ZOOM </span>
        <span class={tui.value}>{(props.zoom() * 100).toFixed(0)}%</span>
      </span>
      <span style={{ "margin-left": "auto" }}>
        <span
          style={{
            display: "inline-block",
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            background: props.connected() ? "#88ffbb" : "#ff4488",
            "margin-right": "6px",
          }}
        />
        <span class={tui.dim}>{props.connected() ? "CONNECTED" : "OFFLINE"}</span>
      </span>
    </div>
  );
}
