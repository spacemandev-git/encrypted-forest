/**
 * Canvas element + TuiCanvas lifecycle.
 */

import { onMount, onCleanup } from "solid-js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import { TuiCanvas, type TuiCanvasOptions } from "../renderer/TuiCanvas.js";

interface GameCanvasProps {
  getPlanets: () => ReadonlyMap<string, PlanetEntry>;
  getExploredCoords: () => ReadonlySet<string>;
  getMapDiameter: () => number;
  getPlayerId: () => bigint | null;
  getSelectedHash: () => string | null;
  onCellClick?: (gridX: number, gridY: number) => void;
  ref?: (renderer: TuiCanvas) => void;
}

export default function GameCanvas(props: GameCanvasProps) {
  let canvasEl!: HTMLCanvasElement;

  onMount(() => {
    const renderer = new TuiCanvas({
      canvas: canvasEl,
      getPlanets: props.getPlanets,
      getExploredCoords: props.getExploredCoords,
      getMapDiameter: props.getMapDiameter,
      getPlayerId: props.getPlayerId,
      getSelectedHash: props.getSelectedHash,
      onCellClick: props.onCellClick,
    });

    renderer.start();
    props.ref?.(renderer);

    onCleanup(() => renderer.stop());
  });

  return (
    <canvas
      ref={canvasEl}
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        "z-index": "0",
      }}
    />
  );
}
