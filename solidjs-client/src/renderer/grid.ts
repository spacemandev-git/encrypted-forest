/**
 * Top-down grid cell rendering for the TUI map.
 */

import { CELL_WIDTH, CELL_HEIGHT, font, GLYPH_FONT_SIZE } from "./font.js";
import { PALETTE } from "./palette.js";
import { worldToScreen, type Camera } from "./camera.js";

/** Glyph for explored empty cell */
const EMPTY_GLYPH = ".";

/** Render the grid background and explored cells */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  exploredCoords: ReadonlySet<string>,
  mapDiameter: number
): void {
  const halfMap = Math.floor(mapDiameter / 2);

  // Determine visible grid range
  const [topLeftWX, topLeftWY] = screenToWorldGrid(cam, 0, 0, canvasW, canvasH);
  const [botRightWX, botRightWY] = screenToWorldGrid(cam, canvasW, canvasH, canvasW, canvasH);

  const startX = Math.max(-halfMap, Math.floor(topLeftWX) - 1);
  const endX = Math.min(halfMap, Math.ceil(botRightWX) + 1);
  const startY = Math.max(-halfMap, Math.floor(topLeftWY) - 1);
  const endY = Math.min(halfMap, Math.ceil(botRightWY) + 1);

  ctx.font = font(GLYPH_FONT_SIZE * cam.zoom);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let gy = startY; gy <= endY; gy++) {
    for (let gx = startX; gx <= endX; gx++) {
      const [sx, sy] = worldToScreen(
        cam,
        gx * CELL_WIDTH,
        gy * CELL_HEIGHT,
        canvasW,
        canvasH
      );

      const cellW = CELL_WIDTH * cam.zoom;
      const cellH = CELL_HEIGHT * cam.zoom;

      const key = `${gx},${gy}`;
      const isExplored = exploredCoords.has(key);

      if (isExplored) {
        // Explored but empty cell
        ctx.fillStyle = PALETTE.explored;
        ctx.fillRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);

        // Draw dot glyph
        ctx.fillStyle = PALETTE.gridDot;
        ctx.fillText(EMPTY_GLYPH, sx, sy);
      }

      // Grid lines (subtle)
      if (cam.zoom > 0.5) {
        ctx.strokeStyle = PALETTE.gridLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
      }
    }
  }
}

function screenToWorldGrid(
  cam: Camera,
  sx: number,
  sy: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const wx = (sx - canvasW / 2) / cam.zoom + cam.x;
  const wy = (sy - canvasH / 2) / cam.zoom + cam.y;
  return [wx / CELL_WIDTH, wy / CELL_HEIGHT];
}
