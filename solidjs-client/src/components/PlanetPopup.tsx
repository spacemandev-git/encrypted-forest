/**
 * Draggable popup panel showing full details of a selected planet.
 * Stats are always derived from discovery data; live on-chain values overlay when available.
 * Owned planets show live-ticking ship/metal regeneration based on on-chain snapshot.
 */

import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import { baseStats, applyCometBoosts } from "@encrypted-forest/core";
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

/** Approximate Solana slot duration in ms */
const SLOT_MS = 400;

/**
 * Global regen anchor per planet hash.
 * Persists across popup close/reopen so the regen counter doesn't reset.
 * Key = snapshotKey (hashHex:shipCount:metalCount), Value = wall-clock ms when snapshot was first seen.
 */
const regenAnchors = new Map<string, number>();

interface PlanetPopupProps {
  entry: PlanetEntry;
  playerId?: bigint | null;
  gameSpeed?: bigint;
  x?: number;
  y?: number;
  onPositionChange?: (x: number, y: number) => void;
  onClose: () => void;
  targeting?: boolean;
  shipCount?: number;
  onShipCountChange?: (count: number) => void;
  onSendShips?: () => void;
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

  const stats = () => applyCometBoosts(baseStats(p().bodyType, p().size), p().comets);

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

  // ---------------------------------------------------------------------------
  // Regen ticking — uses global anchor so it persists across popup close/reopen
  // ---------------------------------------------------------------------------
  const [now, setNow] = createSignal(performance.now());

  // Derive the snapshot key from on-chain state (changes when state is updated)
  const snapshotKey = () => {
    const state = dec();
    return props.entry.hashHex
      + (state ? `:${state.dynamic.shipCount}:${state.dynamic.metalCount}` : "");
  };

  // Get or create the anchor time for the current snapshot
  const anchorTime = () => {
    const key = snapshotKey();
    let anchor = regenAnchors.get(key);
    if (anchor == null) {
      anchor = performance.now();
      regenAnchors.set(key, anchor);
    }
    return anchor;
  };

  // Elapsed slots since the anchor (persists across close/reopen)
  const regenElapsed = () => {
    const elapsed = now() - anchorTime();
    return Math.max(0, Math.floor(elapsed / SLOT_MS));
  };

  // Tick the clock for owned planets
  createEffect(() => {
    if (!isOwned()) return;
    const interval = setInterval(() => {
      setNow(performance.now());
    }, SLOT_MS);
    onCleanup(() => clearInterval(interval));
  });

  const regenShips = () => {
    if (!isOwned()) return 0n;
    const s = stats();
    const state = dec();
    const genSpeed = state ? state.static.shipGenSpeed : BigInt(s.shipGenSpeed);
    const gs = props.gameSpeed ?? 10000n;
    if (genSpeed === 0n || gs === 0n) return 0n;
    return (genSpeed * BigInt(regenElapsed()) * 10000n) / gs;
  };

  const regenMetal = () => {
    if (!isOwned()) return 0n;
    const s = stats();
    const state = dec();
    const genSpeed = state ? state.static.metalGenSpeed : BigInt(s.metalGenSpeed);
    const gs = props.gameSpeed ?? 10000n;
    if (genSpeed === 0n || gs === 0n) return 0n;
    return (genSpeed * BigInt(regenElapsed()) * 10000n) / gs;
  };

  // ---------------------------------------------------------------------------
  // Clipboard copy
  // ---------------------------------------------------------------------------
  const [copied, setCopied] = createSignal(false);

  function copyHash() {
    navigator.clipboard.writeText(props.entry.hashHex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // ---------------------------------------------------------------------------
  // Ownership label
  // ---------------------------------------------------------------------------
  const ownerLabel = () => {
    const state = dec();
    if (!state || !state.dynamic.ownerExists) return "PIRATES";
    return isOwned() ? "YOU" : "ENEMY";
  };

  return (
    <DraggablePanel
      title={BODY_TYPE_NAMES[p().bodyType] ?? "Unknown"}
      borderColor={props.targeting ? "#662222" : undefined}
      titleExtra={
        <span class={tui.dim} title="Level" style={{ "font-size": "10px" }}>
          {"\u2605"}{(() => {
            const state = dec();
            return state ? state.static.level : 1;
          })()}
        </span>
      }
      initialX={window.innerWidth - 310}
      initialY={80}
      x={props.x}
      y={props.y}
      onPositionChange={props.onPositionChange}
      width="280px"
      zIndex={200}
      onClose={props.onClose}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "5px", "font-size": "12px" }}>
        {/* -- Row 1: Ships + Metal side by side -- */}
        {(() => {
          const s = stats();
          const state = dec();
          const owned = isOwned();

          const baseShipCount = state ? Number(state.dynamic.shipCount) : s.nativeShips;
          const baseMetalCount = state ? Number(state.dynamic.metalCount) : 0;
          const maxShips = state ? Number(state.static.maxShipCapacity) : s.maxShipCapacity;
          const shipGen = state ? Number(state.static.shipGenSpeed) : s.shipGenSpeed;
          const maxMetal = state ? Number(state.static.maxMetalCapacity) : s.maxMetalCapacity;
          const metalGen = state ? Number(state.static.metalGenSpeed) : s.metalGenSpeed;

          const displayShips = owned
            ? Math.min(maxShips, baseShipCount + Number(regenShips()))
            : baseShipCount;
          const displayMetal = owned
            ? Math.min(maxMetal, baseMetalCount + Number(regenMetal()))
            : baseMetalCount;

          return (
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: "1", "text-align": "center" }}>
                <div class={tui.dim} style={{ "font-size": "9px", "letter-spacing": "1px" }}>SHIPS</div>
                <div class={tui.value} style={{ "font-size": "11px" }}>
                  {displayShips}/{maxShips}
                </div>
                <div class={tui.dim} style={{ "font-size": "9px" }}>(+{shipGen})</div>
              </div>
              <div style={{ flex: "1", "text-align": "center" }}>
                <div class={tui.dim} style={{ "font-size": "9px", "letter-spacing": "1px" }}>METAL</div>
                <div class={tui.value} style={{ "font-size": "11px" }}>
                  {displayMetal}/{maxMetal}
                </div>
                <div class={tui.dim} style={{ "font-size": "9px" }}>(+{metalGen})</div>
              </div>
            </div>
          );
        })()}

        <div style={{ "border-top": "1px solid #333333", margin: "1px 0" }} />

        {/* -- Row 2: Size | Range | Velocity -- */}
        {(() => {
          const s = stats();
          const state = dec();
          const range = state ? Number(state.static.range) : s.range;
          const velocity = state ? Number(state.static.launchVelocity) : s.launchVelocity;

          return (
            <div style={{ display: "flex" }}>
              <div style={{ flex: "1", "text-align": "center" }}>
                <div class={tui.dim} style={{ "font-size": "9px", "letter-spacing": "1px" }}>SIZE</div>
                <div class={tui.value} style={{ "font-size": "11px" }}>{SIZE_NAMES[p().size] ?? "?"}</div>
              </div>
              <div style={{ flex: "1", "text-align": "center" }}>
                <div class={tui.dim} style={{ "font-size": "9px", "letter-spacing": "1px" }}>RANGE</div>
                <div class={tui.value} style={{ "font-size": "11px" }}>{range}</div>
              </div>
              <div style={{ flex: "1", "text-align": "center" }}>
                <div class={tui.dim} style={{ "font-size": "9px", "letter-spacing": "1px" }}>SPEED</div>
                <div class={tui.value} style={{ "font-size": "11px" }}>{velocity}</div>
              </div>
            </div>
          );
        })()}

        {/* -- Comets (if any) -- */}
        <Show when={p().comets.length > 0}>
          <div style={{ "border-top": "1px dashed #222222", margin: "1px 0" }} />
          {p().comets.map((c: number) => (
            <Row label="Comet" value={`+${COMET_NAMES[c] ?? `Boost ${c}`}`} success />
          ))}
        </Show>

        <div style={{ "border-top": "1px solid #333333", margin: "1px 0" }} />

        {/* -- Row 3: Coordinates centered -- */}
        <div style={{ "text-align": "center" }}>
          <span class={tui.value} style={{ "font-size": "11px" }}>
            ({d().x.toString()}, {d().y.toString()})
          </span>
        </div>

        {/* -- Row 4: Hash | Ownership -- */}
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <div
            style={{ display: "flex", "align-items": "center", gap: "3px", cursor: "pointer" }}
            onClick={copyHash}
            title="Copy full hash to clipboard"
          >
            <span class={tui.dim} style={{ "font-size": "9px", "font-family": "monospace" }}>
              {props.entry.hashHex.slice(0, 10)}..{props.entry.hashHex.slice(-4)}
            </span>
            <span style={{ "font-size": "9px", opacity: "0.5" }}>
              {copied() ? "\u2713" : "\u2398"}
            </span>
          </div>
          <span
            class={isOwned() ? tui.valueSuccess : isEnemy() ? tui.valueWarning : tui.dim}
            style={{ "font-size": "11px" }}
          >
            {ownerLabel()}
          </span>
        </div>

        {/* -- Raw Encrypted Account (when available but not decoded) -- */}
        <Show when={props.entry.encrypted != null && dec() == null}>
          <div style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />
          <div class={tui.dim} style={{ "font-size": "9px", "text-align": "center" }}>
            Encrypted state present but not yet decrypted
          </div>
        </Show>

        {/* -- Ship send controls (owned planets only) -- */}
        <Show when={isOwned()}>
          <div style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />
          {(() => {
            const s = stats();
            const state = dec();
            const owned = isOwned();
            const maxShips = state ? Number(state.static.maxShipCapacity) : s.maxShipCapacity;
            const baseShipCount = state ? Number(state.dynamic.shipCount) : s.nativeShips;
            const displayShips = owned
              ? Math.min(maxShips, baseShipCount + Number(regenShips()))
              : baseShipCount;
            const currentCount = props.shipCount ?? Math.max(1, Math.floor(displayShips / 2));
            const maxSend = Math.max(1, displayShips);

            return (
              <div style={{ display: "flex", "flex-direction": "column", gap: "3px" }}>
                <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                  <input
                    type="range"
                    min="1"
                    max={maxSend}
                    value={currentCount}
                    onInput={(e) => props.onShipCountChange?.(parseInt(e.currentTarget.value))}
                    style={{
                      flex: "1",
                      height: "4px",
                      "accent-color": "#00ff88",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="number"
                    min="1"
                    max={maxSend}
                    value={currentCount}
                    onInput={(e) => {
                      const v = parseInt(e.currentTarget.value);
                      if (!isNaN(v)) props.onShipCountChange?.(Math.min(maxSend, Math.max(1, v)));
                    }}
                    style={{
                      width: "48px",
                      background: "#111111",
                      border: "1px solid #333333",
                      color: "#cccccc",
                      "font-size": "10px",
                      "font-family": "monospace",
                      "text-align": "center",
                      padding: "1px 2px",
                    }}
                  />
                </div>
                <Show when={!props.targeting}>
                  <div
                    class={tui.dim}
                    style={{ "font-size": "9px", "text-align": "center", "letter-spacing": "1px" }}
                  >
                    [Q] SEND SHIPS
                  </div>
                </Show>
                <Show when={props.targeting}>
                  <div style={{
                    "font-size": "9px",
                    "text-align": "center",
                    "letter-spacing": "1px",
                    color: "#ff5050",
                  }}>
                    SELECT TARGET... [ESC] Cancel
                  </div>
                </Show>
              </div>
            );
          })()}
        </Show>
      </div>
    </DraggablePanel>
  );
}
