/**
 * Wireframe rotation, projection, and drawing.
 * Per-planet: rotate vertices by time-based angle, translate to world position,
 * apply x/z y/z projection, draw edges.
 */

import type { ShapeData } from "./shapes.js";
import { project3D } from "./perspective.js";

/** Rotate a vertex around the Y-axis */
export function rotateY(
  v: [number, number, number],
  angle: number
): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    v[0] * cos + v[2] * sin,
    v[1],
    -v[0] * sin + v[2] * cos,
  ];
}

/** Rotate a vertex around the X-axis (for slight tilt) */
export function rotateX(
  v: [number, number, number],
  angle: number
): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    v[0],
    v[1] * cos - v[2] * sin,
    v[1] * sin + v[2] * cos,
  ];
}

/** Translate a vertex into screen depth */
export function translateZ(
  v: [number, number, number],
  depth: number
): [number, number, number] {
  return [v[0], v[1], v[2] + depth];
}

export interface WireframeRenderParams {
  shape: ShapeData;
  screenX: number;
  screenY: number;
  angle: number;
  tilt: number;
  depth: number;
  color: string;
  alpha: number;
}

/** Draw a wireframe shape on a 2D canvas context */
export function drawWireframe(
  ctx: CanvasRenderingContext2D,
  params: WireframeRenderParams
): void {
  const { shape, screenX, screenY, angle, tilt, depth, color, alpha } = params;

  // Transform vertices: rotate → tilt → translate into depth
  const projected: [number, number][] = shape.vertices.map((v) => {
    let transformed = rotateY(v, angle);
    transformed = rotateX(transformed, tilt);
    transformed = translateZ(transformed, depth);
    return project3D(
      transformed[0],
      transformed[1],
      transformed[2],
      screenX,
      screenY,
      300
    );
  });

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (const [i, j] of shape.edges) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[j];
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}
