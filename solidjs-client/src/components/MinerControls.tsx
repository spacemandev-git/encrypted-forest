/**
 * Hash miner controls panel — configure and control the coordinate miner.
 */

import { createSignal, For, Show } from "solid-js";
import type { MinerAPI } from "../mining/miner.js";
import { PATTERN_DESCRIPTIONS, type ScanPattern } from "../mining/patterns.js";
import DraggablePanel from "./DraggablePanel.js";
import tui from "../styles/tui.module.css";

const PATTERNS: ScanPattern[] = ["spiral", "checkerboard", "ring", "quadrant", "random"];
const BODY_TYPE_NAMES = ["Planet", "Quasar", "Rift", "Asteroid"];
const SIZE_NAMES = ["", "Miniscule", "Tiny", "Small", "Medium", "Large", "Gargantuan"];

interface MinerControlsProps {
  miner: MinerAPI;
  onStart: () => void;
  onStop: () => void;
}

export default function MinerControls(props: MinerControlsProps) {
  const cfg = () => props.miner.config();
  const stats = () => props.miner.stats();
  const discoveries = () => props.miner.discoveries();

  const [showDiscoveries, setShowDiscoveries] = createSignal(false);

  function setWorkerCount(n: number) {
    props.miner.updateConfig({ workerCount: Math.max(1, Math.min(32, n)) });
  }

  function setChunkSize(n: number) {
    props.miner.updateConfig({ chunkSize: Math.max(16, Math.min(4096, n)) });
  }

  function setPattern(p: ScanPattern) {
    props.miner.updateConfig({ pattern: p });
  }

  function setCenterX(n: number) {
    props.miner.updateConfig({ centerX: n });
  }

  function setCenterY(n: number) {
    props.miner.updateConfig({ centerY: n });
  }

  function setMaxRadius(n: number) {
    props.miner.updateConfig({ maxRadius: Math.max(1, Math.min(10000, n)) });
  }

  return (
    <DraggablePanel
      title="HASH MINER"
      initialX={16}
      initialY={48}
      width="300px"
      zIndex={200}
      maxHeight="calc(100vh - 60px)"
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          padding: "6px 8px",
          background: stats().running ? "rgba(153, 102, 255, 0.1)" : "transparent",
          border: `1px solid ${stats().running ? "#9966ff" : "#333333"}`,
        }}
      >
        <span class={stats().running ? tui.valueSuccess : tui.dim}>
          {stats().running ? "MINING" : "IDLE"}
        </span>
        <Show when={stats().totalHashed > 0}>
          <span class={tui.value}>{stats().hashesPerSecond} h/s</span>
        </Show>
      </div>

      {/* Stats row */}
      <Show when={stats().totalHashed > 0}>
        <div style={{ display: "flex", gap: "12px", "font-size": "11px" }}>
          <span>
            <span class={tui.label}>HASHED </span>
            <span class={tui.value}>{stats().totalHashed.toLocaleString()}</span>
          </span>
          <span>
            <span class={tui.label}>FOUND </span>
            <span class={tui.valueHighlight}>{stats().totalDiscovered}</span>
          </span>
          <span>
            <span class={tui.label}>TIME </span>
            <span class={tui.value}>{stats().elapsed.toFixed(1)}s</span>
          </span>
        </div>
      </Show>

      <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />

      {/* Pattern selector */}
      <div>
        <label class={tui.label}>PATTERN</label>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px", "margin-top": "4px" }}>
          <For each={PATTERNS}>
            {(p) => (
              <button
                class={tui.button}
                style={{
                  "font-size": "10px",
                  padding: "2px 8px",
                  background: cfg().pattern === p ? "rgba(153, 102, 255, 0.2)" : undefined,
                  "border-color": cfg().pattern === p ? "#9966ff" : undefined,
                }}
                onClick={() => setPattern(p)}
                disabled={stats().running}
              >
                {p.toUpperCase()}
              </button>
            )}
          </For>
        </div>
        <div class={tui.dim} style={{ "font-size": "10px", "margin-top": "4px" }}>
          {PATTERN_DESCRIPTIONS[cfg().pattern]}
        </div>
      </div>

      {/* Center coordinates */}
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: "1" }}>
          <label class={tui.label}>CENTER X</label>
          <input
            class={tui.input}
            type="number"
            value={cfg().centerX}
            onInput={(e) => setCenterX(parseInt(e.currentTarget.value) || 0)}
            disabled={stats().running}
            style={{ width: "100%", "margin-top": "2px" }}
          />
        </div>
        <div style={{ flex: "1" }}>
          <label class={tui.label}>CENTER Y</label>
          <input
            class={tui.input}
            type="number"
            value={cfg().centerY}
            onInput={(e) => setCenterY(parseInt(e.currentTarget.value) || 0)}
            disabled={stats().running}
            style={{ width: "100%", "margin-top": "2px" }}
          />
        </div>
      </div>

      {/* Max radius */}
      <div>
        <label class={tui.label}>MAX RADIUS</label>
        <input
          class={tui.input}
          type="number"
          value={cfg().maxRadius}
          onInput={(e) => setMaxRadius(parseInt(e.currentTarget.value) || 100)}
          disabled={stats().running}
          style={{ width: "100%", "margin-top": "2px" }}
        />
      </div>

      <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />

      {/* Performance tuning */}
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: "1" }}>
          <label class={tui.label}>WORKERS</label>
          <input
            class={tui.input}
            type="number"
            value={cfg().workerCount}
            onInput={(e) => setWorkerCount(parseInt(e.currentTarget.value) || 4)}
            disabled={stats().running}
            style={{ width: "100%", "margin-top": "2px" }}
            min="1"
            max="32"
          />
          <div class={tui.dim} style={{ "font-size": "9px", "margin-top": "2px" }}>
            Max: {navigator.hardwareConcurrency || "?"}
          </div>
        </div>
        <div style={{ flex: "1" }}>
          <label class={tui.label}>CHUNK SIZE</label>
          <input
            class={tui.input}
            type="number"
            value={cfg().chunkSize}
            onInput={(e) => setChunkSize(parseInt(e.currentTarget.value) || 256)}
            disabled={stats().running}
            style={{ width: "100%", "margin-top": "2px" }}
            min="16"
            max="4096"
            step="16"
          />
        </div>
      </div>

      {/* Start/Stop buttons */}
      <div style={{ display: "flex", gap: "8px", "margin-top": "4px" }}>
        <Show
          when={!stats().running}
          fallback={
            <button
              class={tui.button}
              onClick={props.onStop}
              style={{ flex: "1", color: "#ff4488", "border-color": "#ff4488" }}
            >
              STOP MINING
            </button>
          }
        >
          <button
            class={tui.button}
            onClick={props.onStart}
            style={{ flex: "1", color: "#88ffbb", "border-color": "#88ffbb" }}
          >
            START MINING
          </button>
        </Show>
      </div>

      {/* Discoveries */}
      <Show when={discoveries().length > 0}>
        <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />
        <button
          class={tui.button}
          onClick={() => setShowDiscoveries(!showDiscoveries())}
          style={{ "font-size": "11px" }}
        >
          {showDiscoveries() ? "HIDE" : "SHOW"} DISCOVERIES ({discoveries().length})
        </button>

        <Show when={showDiscoveries()}>
          <div
            style={{
              "max-height": "200px",
              "overflow-y": "auto",
              "font-size": "10px",
              display: "flex",
              "flex-direction": "column",
              gap: "2px",
            }}
          >
            <For each={discoveries().slice(-50)}>
              {(d) => (
                <div style={{ display: "flex", "justify-content": "space-between" }}>
                  <span class={tui.dim}>
                    ({d.x.toString()},{d.y.toString()})
                  </span>
                  <span class={tui.value}>
                    {BODY_TYPE_NAMES[d.bodyType]} {SIZE_NAMES[d.size]}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
      </div>
    </DraggablePanel>
  );
}
