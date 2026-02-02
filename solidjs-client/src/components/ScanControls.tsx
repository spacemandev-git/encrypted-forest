/**
 * Scan range controls panel.
 */

import { createSignal, type Accessor } from "solid-js";
import type { FogOfWarStoreAPI } from "@encrypted-forest/solidjs-sdk";
import DraggablePanel from "./DraggablePanel.js";
import tui from "../styles/tui.module.css";

interface ScanControlsProps {
  fogStore: FogOfWarStoreAPI;
  scanning: Accessor<boolean>;
}

export default function ScanControls(props: ScanControlsProps) {
  const [centerX, setCenterX] = createSignal("0");
  const [centerY, setCenterY] = createSignal("0");
  const [radius, setRadius] = createSignal("5");

  async function handleScan() {
    const cx = BigInt(parseInt(centerX()) || 0);
    const cy = BigInt(parseInt(centerY()) || 0);
    const r = BigInt(parseInt(radius()) || 5);
    await props.fogStore.scanRange(cx - r, cy - r, cx + r, cy + r);
  }

  function handleFindSpawn() {
    props.fogStore.findSpawnPlanet();
  }

  return (
    <DraggablePanel
      title="SCAN CONTROLS"
      initialX={16}
      initialY={48}
      width="240px"
      zIndex={200}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: "1" }}>
          <label class={tui.label}>X</label>
          <input
            class={tui.input}
            type="number"
            value={centerX()}
            onInput={(e) => setCenterX(e.currentTarget.value)}
            style={{ width: "100%", "margin-top": "2px" }}
          />
        </div>
        <div style={{ flex: "1" }}>
          <label class={tui.label}>Y</label>
          <input
            class={tui.input}
            type="number"
            value={centerY()}
            onInput={(e) => setCenterY(e.currentTarget.value)}
            style={{ width: "100%", "margin-top": "2px" }}
          />
        </div>
      </div>

      <div>
        <label class={tui.label}>RADIUS</label>
        <input
          class={tui.input}
          type="number"
          value={radius()}
          onInput={(e) => setRadius(e.currentTarget.value)}
          style={{ width: "100%", "margin-top": "2px" }}
        />
      </div>

      <button
        class={tui.button}
        onClick={handleScan}
        disabled={props.scanning()}
        style={{ "margin-top": "4px" }}
      >
        {props.scanning() ? "SCANNING..." : "SCAN RANGE"}
      </button>

      <button
        class={tui.button}
        onClick={handleFindSpawn}
        style={{ "margin-top": "2px" }}
      >
        FIND SPAWN
      </button>
      </div>
    </DraggablePanel>
  );
}
