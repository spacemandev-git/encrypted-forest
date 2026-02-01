/**
 * Popup panel showing details of a selected planet.
 */

import { Show } from "solid-js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import tui from "../styles/tui.module.css";

const BODY_TYPE_NAMES = ["Planet", "Quasar", "Spacetime Rift", "Asteroid Belt"];
const COMET_NAMES: Record<number, string> = {
  1: "Ship Capacity",
  2: "Metal Capacity",
  3: "Ship Gen Speed",
  4: "Metal Gen Speed",
  5: "Range",
  6: "Launch Velocity",
};

interface PlanetPopupProps {
  entry: PlanetEntry;
  onClose: () => void;
}

export default function PlanetPopup(props: PlanetPopupProps) {
  const d = () => props.entry.discovery;
  const p = () => d().properties;

  return (
    <div
      class={tui.panel}
      style={{
        position: "fixed",
        top: "50%",
        right: "12px",
        transform: "translateY(-50%)",
        width: "240px",
        padding: "16px",
        "z-index": "50",
        display: "flex",
        "flex-direction": "column",
        gap: "10px",
        "font-size": "12px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <span class={tui.accent} style={{ "font-weight": "600", "font-size": "13px" }}>
          {BODY_TYPE_NAMES[p().bodyType] ?? "Unknown"}
        </span>
        <button
          class={tui.button}
          onClick={props.onClose}
          style={{ padding: "1px 6px", "font-size": "10px" }}
        >
          X
        </button>
      </div>

      {/* Coordinates */}
      <div>
        <span class={tui.label}>LOCATION</span>
        <div style={{ "margin-top": "2px" }}>
          <span class={tui.dim}>x:</span>{" "}
          <span class={tui.value}>{d().x.toString()}</span>
          <span class={tui.dim} style={{ "margin-left": "8px" }}>y:</span>{" "}
          <span class={tui.value}>{d().y.toString()}</span>
        </div>
      </div>

      {/* Size */}
      <div>
        <span class={tui.label}>SIZE</span>
        <div style={{ "margin-top": "2px" }}>
          <span class={tui.valueHighlight}>{p().size}</span>
          <span class={tui.dim}> / 6</span>
        </div>
      </div>

      {/* Hash */}
      <div>
        <span class={tui.label}>HASH</span>
        <div
          style={{
            "margin-top": "2px",
            "font-size": "9px",
            color: "#777777",
            "word-break": "break-all",
            "line-height": "1.3",
          }}
        >
          {props.entry.hashHex}
        </div>
      </div>

      {/* Comets */}
      <Show when={p().comets.length > 0}>
        <div>
          <span class={tui.label}>COMET BOOSTS</span>
          <div style={{ "margin-top": "2px", display: "flex", "flex-direction": "column", gap: "2px" }}>
            {p().comets.map((c: number) => (
              <span class={tui.valueSuccess} style={{ "font-size": "11px" }}>
                + {COMET_NAMES[c] ?? `Boost ${c}`}
              </span>
            ))}
          </div>
        </div>
      </Show>

      {/* On-chain state (if decrypted) */}
      <Show when={props.entry.decrypted != null}>
        {(() => {
          const state = props.entry.decrypted!;
          return (
            <>
              <div style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />
              <div>
                <span class={tui.label}>ON-CHAIN STATE</span>
                <div style={{ "margin-top": "4px", display: "grid", "grid-template-columns": "1fr 1fr", gap: "4px 12px", "font-size": "11px" }}>
                  <span class={tui.dim}>Ships</span>
                  <span class={tui.value}>{state.dynamic.shipCount.toString()}</span>
                  <span class={tui.dim}>Metal</span>
                  <span class={tui.value}>{state.dynamic.metalCount.toString()}</span>
                  <span class={tui.dim}>Owner</span>
                  <span class={tui.value}>
                    {state.dynamic.ownerExists ? "Yes" : "None"}
                  </span>
                </div>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={props.entry.decrypted == null}>
        <div style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />
        <div class={tui.dim} style={{ "font-size": "10px" }}>
          Not yet initialized on-chain
        </div>
      </Show>
    </div>
  );
}
