/**
 * Planet detail panel — shows info about the selected planet.
 */

import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import tui from "../styles/tui.module.css";

interface PlanetInfoProps {
  planet: Accessor<PlanetEntry | null>;
  playerId: Accessor<bigint | null>;
  onClose: () => void;
}

const BODY_TYPE_NAMES = ["Planet", "Quasar", "Spacetime Rift", "Asteroid Belt"];
const SIZE_NAMES = ["", "Miniscule", "Tiny", "Small", "Medium", "Large", "Gargantuan"];

export default function PlanetInfo(props: PlanetInfoProps) {
  const p = () => props.planet();

  const isOwned = () => {
    const entry = p();
    const pid = props.playerId();
    if (!entry?.decrypted || entry.decrypted.dynamic.ownerExists === 0 || pid === null) return false;
    return entry.decrypted.dynamic.ownerId === pid;
  };

  const isEnemy = () => {
    const entry = p();
    const pid = props.playerId();
    if (!entry?.decrypted || entry.decrypted.dynamic.ownerExists === 0) return false;
    if (pid === null) return true;
    return entry.decrypted.dynamic.ownerId !== pid;
  };

  return (
    <Show when={p()}>
      <div
        class={tui.panel}
        style={{
          position: "fixed",
          right: "16px",
          top: "48px",
          width: "280px",
          padding: "12px",
          "z-index": "200",
        }}
      >
        <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "12px" }}>
          <span class={tui.accent} style={{ "font-size": "14px", "font-weight": "600" }}>
            {BODY_TYPE_NAMES[p()!.discovery.properties.bodyType] ?? "Unknown"}
          </span>
          <button class={tui.button} onClick={props.onClose} style={{ padding: "2px 8px" }}>
            x
          </button>
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <Row label="COORDS" value={`${p()!.discovery.x}, ${p()!.discovery.y}`} />
          <Row label="SIZE" value={SIZE_NAMES[p()!.discovery.properties.size] ?? "?"} />
          <Row
            label="STATUS"
            value={isOwned() ? "OWNED" : isEnemy() ? "ENEMY" : "NEUTRAL"}
            highlight={isOwned()}
            warning={isEnemy()}
          />

          <Show when={p()!.decrypted}>
            <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "4px 0" }} />
            <Row label="SHIPS" value={p()!.decrypted!.dynamic.shipCount.toString()} />
            <Row label="METAL" value={p()!.decrypted!.dynamic.metalCount.toString()} />
            <Row label="RANGE" value={p()!.decrypted!.static.range.toString()} />
            <Row label="VELOCITY" value={p()!.decrypted!.static.launchVelocity.toString()} />
          </Show>
        </div>
      </div>
    </Show>
  );
}

function Row(props: { label: string; value: string; highlight?: boolean; warning?: boolean }) {
  return (
    <div style={{ display: "flex", "justify-content": "space-between" }}>
      <span class={tui.label}>{props.label}</span>
      <span
        class={props.warning ? tui.valueWarning : props.highlight ? tui.valueHighlight : tui.value}
      >
        {props.value}
      </span>
    </div>
  );
}
