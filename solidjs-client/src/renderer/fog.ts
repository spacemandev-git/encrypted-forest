/**
 * Fog of war overlay.
 *
 * The black canvas background (PALETTE.background) already acts as fog.
 * Explored cells are drawn with a brighter background by the grid renderer,
 * and planets draw their wireframes on top.  No additional fog pass is needed.
 *
 * This function is kept as a no-op so the call site in TuiCanvas doesn't
 * need to change.  Future enhancements (edge glow, scan-line effects)
 * can be added here.
 */

import type { Camera } from "./camera.js";

export function renderFog(
  _ctx: CanvasRenderingContext2D,
  _cam: Camera,
  _canvasW: number,
  _canvasH: number,
  _exploredCoords: ReadonlySet<string>,
  _mapDiameter: number
): void {
  // No-op — black background is the fog.
}
