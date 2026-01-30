/**
 * Fog of war overlay rendering.
 * Draws a dark overlay over unexplored regions.
 */

import { CELL_WIDTH, CELL_HEIGHT } from "./font.js";
import { PALETTE } from "./palette.js";
import { worldToScreen, type Camera } from "./camera.js";

/** Render fog of war overlay (covers entire canvas, then clears explored cells) */
export function renderFog(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  exploredCoords: ReadonlySet<string>,
  mapDiameter: number
): void {
  // Draw fog layer over everything
  ctx.save();
  ctx.fillStyle = PALETTE.fog;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.restore();

  // Clear explored cells by drawing explored background over fog
  const halfMap = Math.floor(mapDiameter / 2);
  const cellW = CELL_WIDTH * cam.zoom;
  const cellH = CELL_HEIGHT * cam.zoom;

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";

  for (const key of exploredCoords) {
    const [xStr, yStr] = key.split(",");
    const gx = parseInt(xStr);
    const gy = parseInt(yStr);

    if (isNaN(gx) || isNaN(gy)) continue;
    if (Math.abs(gx) > halfMap || Math.abs(gy) > halfMap) continue;

    const [sx, sy] = worldToScreen(
      cam,
      gx * CELL_WIDTH,
      gy * CELL_HEIGHT,
      canvasW,
      canvasH
    );

    // Only process if visible on screen
    if (sx + cellW / 2 < 0 || sx - cellW / 2 > canvasW) continue;
    if (sy + cellH / 2 < 0 || sy - cellH / 2 > canvasH) continue;

    ctx.fillStyle = "white";
    ctx.fillRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
  }

  ctx.restore();
}
