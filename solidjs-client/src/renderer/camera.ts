/**
 * 2D pan/zoom camera for the TUI canvas.
 */

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

/** Convert world coordinates to screen coordinates */
export function worldToScreen(
  cam: Camera,
  wx: number,
  wy: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const sx = (wx - cam.x) * cam.zoom + canvasW / 2;
  const sy = (wy - cam.y) * cam.zoom + canvasH / 2;
  return [sx, sy];
}

/** Convert screen coordinates to world coordinates */
export function screenToWorld(
  cam: Camera,
  sx: number,
  sy: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const wx = (sx - canvasW / 2) / cam.zoom + cam.x;
  const wy = (sy - canvasH / 2) / cam.zoom + cam.y;
  return [wx, wy];
}

/** Pan camera by a pixel delta */
export function panCamera(cam: Camera, dx: number, dy: number): void {
  cam.x -= dx / cam.zoom;
  cam.y -= dy / cam.zoom;
}

/** Zoom camera toward a screen point */
export function zoomCamera(
  cam: Camera,
  factor: number,
  screenX: number,
  screenY: number,
  canvasW: number,
  canvasH: number
): void {
  const [wx, wy] = screenToWorld(cam, screenX, screenY, canvasW, canvasH);
  cam.zoom *= factor;
  cam.zoom = Math.max(0.2, Math.min(5, cam.zoom));
  // Adjust position so the zoom is centered on the cursor
  cam.x = wx - (screenX - canvasW / 2) / cam.zoom;
  cam.y = wy - (screenY - canvasH / 2) / cam.zoom;
}
