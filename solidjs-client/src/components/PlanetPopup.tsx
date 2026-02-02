/**
 * Draggable popup panel showing full details of a selected planet.
 * Shows discovery data always, plus decrypted on-chain state when available.
 */

import { Show } from "solid-js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import DraggablePanel from "./DraggablePanel.js";
import tui from "../styles/tui.module.css";

const BODY_TYPE_NAMES = ["Planet", "Quasar", "Spacetime Rift", "Asteroid Belt"];
const SIZE_NAMES = ["", "Miniscule", "Tiny", "Small", "Medium", "Large", "Gargantuan"];
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
  playerId?: bigint | null;
  onClose: () => void;
}

function Row(props: { label: string; value: string; highlight?: boolean; warning?: boolean; success?: boolean; dim?: boolean }) {
  return (
    <div style={{ display: "flex", "justify-content": "space-between", padding: "1px 0" }}>
      <span class={tui.dim} style={{ "font-size": "11px" }}>{props.label}</span>
      <span
        class={
          props.warning ? tui.valueWarning
            : props.success ? tui.valueSuccess
            : props.highlight ? tui.valueHighlight
            : props.dim ? tui.dim
            : tui.value
        }
        style={{ "font-size": "11px" }}
      >
        {props.value}
      </span>
    </div>
  );
}

export default function PlanetPopup(props: PlanetPopupProps) {
  const d = () => props.entry.discovery;
  const p = () => d().properties;
  const dec = () => props.entry.decrypted;

  const isOwned = () => {
    const state = dec();
    const pid = props.playerId;
    if (!state || state.dynamic.ownerExists === 0 || pid == null) return false;
    return state.dynamic.ownerId === pid;
  };

  const isEnemy = () => {
    const state = dec();
    const pid = props.playerId;
    if (!state || state.dynamic.ownerExists === 0) return false;
    if (pid == null) return true;
    return state.dynamic.ownerId !== pid;
  };

  return (
    <DraggablePanel
      title={BODY_TYPE_NAMES[p().bodyType] ?? "Unknown"}
      initialX={window.innerWidth - 310}
      initialY={80}
      width="280px"
      zIndex={200}
      onClose={props.onClose}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "font-size": "12px" }}>
        {/* -- Discovery Data (always available) -- */}
        <div class={tui.label} style={{ "font-size": "10px", "letter-spacing": "1.5px" }}>DISCOVERY</div>
        <Row label="Location" value={`${d().x.toString()}, ${d().y.toString()}`} />
        <Row label="Type" value={BODY_TYPE_NAMES[p().bodyType] ?? "Unknown"} highlight />
        <Row label="Size" value={`${SIZE_NAMES[p().size] ?? "?"} (${p().size}/6)`} />

        {/* Comets */}
        <Show when={p().comets.length > 0}>
          {p().comets.map((c: number) => (
            <Row label="Comet" value={`+${COMET_NAMES[c] ?? `Boost ${c}`}`} success />
          ))}
        </Show>

        {/* Hash */}
        <div style={{ "margin-top": "2px" }}>
          <span class={tui.dim} style={{ "font-size": "9px", "word-break": "break-all", "line-height": "1.3" }}>
            {props.entry.hashHex}
          </span>
        </div>

        {/* -- On-Chain State -- */}
        <div style={{ "border-top": "1px solid #333333", margin: "4px 0" }} />

        <Show
          when={dec() != null}
          fallback={
            <div class={tui.dim} style={{ "font-size": "10px", "text-align": "center", padding: "4px 0" }}>
              Not initialized on-chain
            </div>
          }
        >
          {(() => {
            const state = dec()!;
            const ownership = state.dynamic.ownerExists
              ? isOwned() ? "YOU" : "ENEMY"
              : "NEUTRAL";

            return (
              <>
                <div class={tui.label} style={{ "font-size": "10px", "letter-spacing": "1.5px" }}>ON-CHAIN STATE</div>

                {/* Ownership */}
                <Row
                  label="Owner"
                  value={ownership}
                  success={isOwned()}
                  warning={isEnemy()}
                  dim={!state.dynamic.ownerExists}
                />

                {/* Dynamic */}
                <Row label="Ships" value={state.dynamic.shipCount.toString()} />
                <Row label="Metal" value={state.dynamic.metalCount.toString()} />

                {/* Static */}
                <div style={{ "border-top": "1px dashed #222222", margin: "3px 0" }} />
                <div class={tui.label} style={{ "font-size": "10px", "letter-spacing": "1.5px" }}>STATS</div>
                <Row label="Max Ships" value={state.static.maxShipCapacity.toString()} />
                <Row label="Ship Gen" value={state.static.shipGenSpeed.toString()} />
                <Row label="Max Metal" value={state.static.maxMetalCapacity.toString()} />
                <Row label="Metal Gen" value={state.static.metalGenSpeed.toString()} />
                <Row label="Range" value={state.static.range.toString()} />
                <Row label="Velocity" value={state.static.launchVelocity.toString()} />
                <Row label="Level" value={state.static.level.toString()} />
              </>
            );
          })()}
        </Show>

        {/* -- Raw Encrypted Account (when available but not decoded, or as debug info) -- */}
        <Show when={props.entry.encrypted != null && dec() == null}>
          <div style={{ "border-top": "1px solid #333333", margin: "4px 0" }} />
          <div class={tui.label} style={{ "font-size": "10px", "letter-spacing": "1.5px" }}>RAW ACCOUNT</div>
          <Row label="Last Updated" value={props.entry.encrypted!.lastUpdatedSlot.toString()} dim />
          <Row label="Last Flushed" value={props.entry.encrypted!.lastFlushedSlot.toString()} dim />
          <div class={tui.dim} style={{ "font-size": "9px", "margin-top": "2px" }}>
            Encrypted state present but not yet decrypted
          </div>
        </Show>
      </div>
    </DraggablePanel>
  );
}
