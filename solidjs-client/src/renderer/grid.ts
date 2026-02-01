/**
 * Top-down grid cell rendering for the TUI map.
 * Only draws explored cells (background + dot glyph + grid outline).
 * Unexplored space is simply the black canvas background (= fog).
 */

import { CELL_WIDTH, CELL_HEIGHT, font, GLYPH_FONT_SIZE } from "./font.js";
import { PALETTE } from "./palette.js";
import { worldToScreen, type Camera } from "./camera.js";

/** Glyph for explored empty cell */
const EMPTY_GLYPH = ".";

/** Render explored cells on the grid */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  exploredCoords: ReadonlySet<string>,
  _mapDiameter: number,
  planetCoords?: ReadonlySet<string>
): void {
  const cellW = CELL_WIDTH * cam.zoom;
  const cellH = CELL_HEIGHT * cam.zoom;

  ctx.font = font(GLYPH_FONT_SIZE * cam.zoom);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const key of exploredCoords) {
    const comma = key.indexOf(",");
    const gx = parseInt(key.substring(0, comma));
    const gy = parseInt(key.substring(comma + 1));
    if (isNaN(gx) || isNaN(gy)) continue;

    const [sx, sy] = worldToScreen(
      cam,
      gx * CELL_WIDTH,
      gy * CELL_HEIGHT,
      canvasW,
      canvasH
    );

    // Skip off-screen cells
    if (sx + cellW / 2 < 0 || sx - cellW / 2 > canvasW) continue;
    if (sy + cellH / 2 < 0 || sy - cellH / 2 > canvasH) continue;

    // Explored cell background
    ctx.fillStyle = PALETTE.explored;
    ctx.fillRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);

    // Draw dot glyph only if a planet occupies this cell
    if (planetCoords?.has(key)) {
      ctx.fillStyle = PALETTE.gridDot;
      ctx.fillText(EMPTY_GLYPH, sx, sy);
    }

    // Grid outline (subtle)
    if (cam.zoom > 0.3) {
      ctx.strokeStyle = PALETTE.gridLine;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
    }
  }
}
