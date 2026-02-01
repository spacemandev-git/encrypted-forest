/**
 * Top stats bar (monospace DOM overlay).
 */

import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import tui from "../styles/tui.module.css";

interface HUDProps {
  gameId: Accessor<string | null>;
  points: Accessor<bigint>;
  ownedPlanets: Accessor<number>;
  totalShips: Accessor<bigint>;
  totalMetal: Accessor<bigint>;
  exploredCount: Accessor<number>;
  hasSpawned: Accessor<boolean>;
  onCenterSpawn?: () => void;
}

export default function HUD(props: HUDProps) {
  return (
    <div
      class={tui.panel}
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        display: "flex",
        "align-items": "center",
        gap: "24px",
        padding: "6px 16px",
        "z-index": "100",
        "font-size": "12px",
        "border-top": "none",
        "border-left": "none",
        "border-right": "none",
      }}
    >
      <span class={tui.accent}>ENCRYPTED FOREST</span>
      <Show when={props.gameId()}>
        <span class={tui.dim}>|</span>
        <span>
          <span class={tui.label}>GAME </span>
          <span class={tui.value}>{props.gameId()}</span>
        </span>
      </Show>
      <Show when={props.hasSpawned()}>
        <span class={tui.dim}>|</span>
        <span>
          <span class={tui.label}>PTS </span>
          <span class={tui.valueHighlight}>{props.points().toString()}</span>
        </span>
        <span>
          <span class={tui.label}>PLANETS </span>
          <span class={tui.value}>{props.ownedPlanets()}</span>
        </span>
        <span>
          <span class={tui.label}>SHIPS </span>
          <span class={tui.value}>{props.totalShips().toString()}</span>
        </span>
        <span>
          <span class={tui.label}>METAL </span>
          <span class={tui.value}>{props.totalMetal().toString()}</span>
        </span>
      </Show>
      <Show when={props.onCenterSpawn}>
        <span class={tui.dim}>|</span>
        <button
          class={tui.button}
          onClick={() => props.onCenterSpawn?.()}
          style={{
            padding: "1px 8px",
            "font-size": "10px",
            color: "#88ffbb",
            "border-color": "#444444",
            cursor: "pointer",
          }}
        >
          SPAWN
        </button>
      </Show>
      <span style={{ "margin-left": "auto" }}>
        <span class={tui.label}>EXPLORED </span>
        <span class={tui.value}>{props.exploredCount()}</span>
      </span>
    </div>
  );
}
