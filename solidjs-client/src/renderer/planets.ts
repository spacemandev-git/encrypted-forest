/**
 * Planet rendering orchestrator — wireframe + labels on the grid.
 */

import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import { CELL_WIDTH, CELL_HEIGHT, font, SHIP_COUNT_FONT_SIZE, LABEL_FONT_SIZE } from "./font.js";
import { PALETTE, BODY_COLORS } from "./palette.js";
import { worldToScreen, type Camera } from "./camera.js";
import { getShapeForPlanet, sizeToRadius } from "./shapes.js";
import { drawWireframe } from "./wireframe.js";

export interface PlanetRenderState {
  hashHex: string;
  angle: number;
  rotSpeed: number;
}

/** Get the wireframe color for a planet */
function getPlanetColor(
  entry: PlanetEntry,
  playerId: bigint | null
): string {
  const bodyType = entry.discovery.properties.bodyType;

  switch (bodyType) {
    case 1: return BODY_COLORS.quasar;
    case 2: return BODY_COLORS.spacetimeRip;
    case 3: return BODY_COLORS.asteroidBelt;
    default: {
      if (!entry.decrypted || entry.decrypted.dynamic.ownerExists === 0) {
        return BODY_COLORS.planet.neutral;
      }
      if (playerId !== null && entry.decrypted.dynamic.ownerId === playerId) {
        return BODY_COLORS.planet.owned;
      }
      return BODY_COLORS.planet.enemy;
    }
  }
}

/** Get rotation speed seeded from hash */
function getRotSpeed(hashHex: string): number {
  const seed = parseInt(hashHex.slice(0, 8), 16);
  return 0.3 + (seed % 1000) / 1000 * 0.7;
}

/** Render all planets on the canvas */
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

    // Skip if off-screen
    if (sx < -100 || sx > canvasW + 100 || sy < -100 || sy > canvasH + 100) {
      continue;
    }

    const size = entry.discovery.properties.size;
    const bodyType = entry.discovery.properties.bodyType;
    const radius = sizeToRadius(size) * cam.zoom;
    const color = getPlanetColor(entry, playerId);

    // Get or create render state
    let state = planetStates.get(hashHex);
    if (!state) {
      state = {
        hashHex,
        angle: 0,
        rotSpeed: getRotSpeed(hashHex),
      };
      planetStates.set(hashHex, state);
    }

    // Update angle
    state.angle += state.rotSpeed * 0.016; // ~60fps dt

    // Pulse alpha for owned planets
    let alpha = 1;
    if (
      entry.decrypted &&
      entry.decrypted.dynamic.ownerExists !== 0 &&
      playerId !== null &&
      entry.decrypted.dynamic.ownerId === playerId
    ) {
      alpha = 0.7 + 0.3 * Math.sin(time * 3);
    }

    // Get shape and draw wireframe
    const scale = radius * 0.7;
    const shape = getShapeForPlanet(bodyType, size, scale);

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

    // Selected highlight
    if (hashHex === selectedHash) {
      ctx.save();
      ctx.strokeStyle = PALETTE.highlight;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Ship count label below wireframe
    if (entry.decrypted) {
      const shipCount = entry.decrypted.dynamic.shipCount;
      ctx.save();
      ctx.font = font(SHIP_COUNT_FONT_SIZE * cam.zoom);
      ctx.fillStyle = PALETTE.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.globalAlpha = 0.8;
      ctx.fillText(`${shipCount}`, sx, sy + radius + 4);
      ctx.restore();
    }

    // Planet type glyph at low zoom
    if (cam.zoom < 0.8) {
      const glyphs = ["O", "*", "~", "#"];
      ctx.save();
      ctx.font = font(LABEL_FONT_SIZE * cam.zoom, 600);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyphs[bodyType] ?? "O", sx, sy);
      ctx.restore();
    }
  }
}
