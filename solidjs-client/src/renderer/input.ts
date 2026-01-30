/**
 * Mouse/keyboard handler for canvas interaction.
 */

import { panCamera, zoomCamera, screenToWorld, type Camera } from "./camera.js";
import { CELL_WIDTH, CELL_HEIGHT } from "./font.js";

export interface InputState {
  /** Currently pressed keys */
  keys: Set<string>;
  /** Is mouse button held */
  mouseDown: boolean;
  /** Last mouse position */
  mouseX: number;
  mouseY: number;
  /** Current hovered grid cell */
  hoveredCell: { x: number; y: number } | null;
  /** Click handler for planet selection */
  onClick: ((worldX: number, worldY: number) => void) | null;
}

export function createInputState(): InputState {
  return {
    keys: new Set(),
    mouseDown: false,
    mouseX: 0,
    mouseY: 0,
    hoveredCell: null,
    onClick: null,
  };
}

/** Attach event listeners to canvas */
export function attachInputHandlers(
  canvas: HTMLCanvasElement,
  camera: Camera,
  input: InputState
): () => void {
  function onKeyDown(e: KeyboardEvent) {
    input.keys.add(e.key.toLowerCase());
  }

  function onKeyUp(e: KeyboardEvent) {
    input.keys.delete(e.key.toLowerCase());
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button === 0) {
      input.mouseDown = true;
      input.mouseX = e.clientX;
      input.mouseY = e.clientY;
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (e.button === 0) {
      // Detect click (minimal movement)
      const dx = Math.abs(e.clientX - input.mouseX);
      const dy = Math.abs(e.clientY - input.mouseY);
      if (dx < 5 && dy < 5 && input.onClick) {
        const [wx, wy] = screenToWorld(
          camera,
          e.clientX,
          e.clientY,
          canvas.width,
          canvas.height
        );
        input.onClick(wx, wy);
      }
      input.mouseDown = false;
    }
  }

  function onMouseMove(e: MouseEvent) {
    if (input.mouseDown) {
      const dx = e.clientX - input.mouseX;
      const dy = e.clientY - input.mouseY;
      panCamera(camera, dx, dy);
    }
    input.mouseX = e.clientX;
    input.mouseY = e.clientY;

    // Update hovered cell
    const [wx, wy] = screenToWorld(
      camera,
      e.clientX,
      e.clientY,
      canvas.width,
      canvas.height
    );
    input.hoveredCell = {
      x: Math.round(wx / CELL_WIDTH),
      y: Math.round(wy / CELL_HEIGHT),
    };
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomCamera(camera, factor, e.clientX, e.clientY, canvas.width, canvas.height);
  }

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

/** Process WASD keys for camera panning (call per frame) */
export function processKeyboardPan(
  camera: Camera,
  input: InputState,
  speed: number = 5
): void {
  const s = speed / camera.zoom;
  if (input.keys.has("w") || input.keys.has("arrowup")) camera.y -= s;
  if (input.keys.has("s") || input.keys.has("arrowdown")) camera.y += s;
  if (input.keys.has("a") || input.keys.has("arrowleft")) camera.x -= s;
  if (input.keys.has("d") || input.keys.has("arrowright")) camera.x += s;
}
