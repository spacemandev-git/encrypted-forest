/**
 * Planet rendering — adaptive detail based on zoom level.
 *
 * - Zoomed out (zoom < 0.5):  colored dots (1–3px)
 * - Mid zoom  (0.5–2.0):     filled circles with body-type glyph
 * - Zoomed in (zoom > 2.0):   rotating 3D wireframes
 */

import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import {
  CELL_WIDTH,
  CELL_HEIGHT,
  font,
  SHIP_COUNT_FONT_SIZE,
} from "./font.js";
import { PALETTE, BODY_COLORS } from "./palette.js";
import { worldToScreen, type Camera } from "./camera.js";
import { getShapeForPlanet, sizeToRadius } from "./shapes.js";
import { drawWireframe } from "./wireframe.js";

export interface PlanetRenderState {
  hashHex: string;
  angle: number;
  rotSpeed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlanetColor(
  entry: PlanetEntry,
  playerId: bigint | null
): string {
  if (!entry.decrypted || entry.decrypted.dynamic.ownerExists === 0) {
    return BODY_COLORS.neutral;
  }
  if (playerId !== null && entry.decrypted.dynamic.ownerId === playerId) {
    return BODY_COLORS.owned;
  }
  return BODY_COLORS.enemy;
}

function getRotSpeed(hashHex: string): number {
  const seed = parseInt(hashHex.slice(0, 8), 16);
  return 0.3 + ((seed % 1000) / 1000) * 0.7;
}

const BODY_GLYPHS = ["◆", "✦", "◎", "▣"];

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderPlanets(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  planets: ReadonlyMap<string, PlanetEntry>,
  playerId: bigint | null,
  selectedHash: string | null,
  time: number,
  planetStates: Map<string, PlanetRenderState>
): void {
  for (const [hashHex, entry] of planets) {
    const wx = Number(entry.discovery.x) * CELL_WIDTH;
    const wy = Number(entry.discovery.y) * CELL_HEIGHT;
    const [sx, sy] = worldToScreen(cam, wx, wy, canvasW, canvasH);

    const size = entry.discovery.properties.size;
    const screenRadius = sizeToRadius(size) * cam.zoom;
    const color = getPlanetColor(entry, playerId);

    // Smaller bodies require higher zoom to be visible
    // Size 1 needs zoom >= 1.0, size 6 is always visible (zoom >= 0.1)
    const minZoom = 1.1 - size * 0.17;
    if (cam.zoom < minZoom) continue;

    // Skip if off-screen (with margin for wireframes/labels)
    const margin = screenRadius + 20;
    if (sx < -margin || sx > canvasW + margin || sy < -margin || sy > canvasH + margin) {
      continue;
    }

    // Wireframe rendering — scales with zoom to stay proportional to grid
    let state = planetStates.get(hashHex);
    if (!state) {
      state = { hashHex, angle: 0, rotSpeed: getRotSpeed(hashHex) };
      planetStates.set(hashHex, state);
    }
    state.angle += state.rotSpeed * 0.016;

    let alpha = 1;
    if (
      entry.decrypted &&
      entry.decrypted.dynamic.ownerExists !== 0 &&
      playerId !== null &&
      entry.decrypted.dynamic.ownerId === playerId
    ) {
      alpha = 0.7 + 0.3 * Math.sin(time * 3);
    }

    const shape = getShapeForPlanet(entry.discovery.properties.bodyType, size, screenRadius);

    drawWireframe(ctx, {
      shape,
      screenX: sx,
      screenY: sy,
      angle: state.angle,
      tilt: 0.3,
      depth: 5,
      color,
      alpha,
    });

    // Selection ring
    if (hashHex === selectedHash) {
      ctx.save();
      ctx.strokeStyle = PALETTE.highlight;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, screenRadius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Ship count label (skip zero — synthetic/placeholder data)
    if (entry.decrypted && screenRadius >= 8 && entry.decrypted.dynamic.shipCount > 0n) {
      const shipCount = entry.decrypted.dynamic.shipCount;
      ctx.save();
      ctx.font = font(SHIP_COUNT_FONT_SIZE * cam.zoom);
      ctx.fillStyle = PALETTE.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.globalAlpha = 0.8;
      ctx.fillText(`${shipCount}`, sx, sy + screenRadius + 4);
      ctx.restore();
    }
  }
}
