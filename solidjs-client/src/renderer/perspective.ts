/**
 * Formula-style x/z y/z perspective projection for 3D wireframes.
 * Used for planet detail pop-up rendering (tsoding/formula style).
 */

/** Project a 3D point to 2D screen coords using perspective division */
export function project3D(
  x: number,
  y: number,
  z: number,
  screenCenterX: number,
  screenCenterY: number,
  focalLength: number = 300
): [number, number] {
  // Prevent division by zero; push point behind camera if z <= 0
  const safeZ = Math.max(z, 0.1);
  const sx = screenCenterX + (x * focalLength) / safeZ;
  const sy = screenCenterY - (y * focalLength) / safeZ;
  return [sx, sy];
}

/** Check if a point is visible (z > near plane) */
export function isVisible(z: number, nearPlane: number = 0.1): boolean {
  return z > nearPlane;
}
