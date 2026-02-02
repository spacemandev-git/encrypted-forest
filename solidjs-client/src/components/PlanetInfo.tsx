/**
 * Planet detail panel — shows info about the selected planet.
 */

import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import DraggablePanel from "./DraggablePanel.js";
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
      <DraggablePanel
        title={BODY_TYPE_NAMES[p()!.discovery.properties.bodyType] ?? "Unknown"}
        initialX={window.innerWidth - 310}
        initialY={48}
        width="280px"
        zIndex={200}
        onClose={props.onClose}
      >
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
      </DraggablePanel>
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
