/**
 * Mining scan patterns — generate coordinate sequences in different shapes.
 * Each pattern is an iterator yielding [x, y] pairs from a center point.
 */

export type ScanPattern = "spiral" | "checkerboard" | "ring" | "quadrant" | "random";

/**
 * Generate coordinates in an expanding spiral from center.
 * Visits every cell in order of distance.
 */
export function* spiralPattern(
  centerX: number,
  centerY: number,
  maxRadius: number
): Generator<[number, number]> {
  yield [centerX, centerY];

  for (let r = 1; r <= maxRadius; r++) {
    // Top edge: left to right
    for (let x = centerX - r; x <= centerX + r; x++) {
      yield [x, centerY - r];
    }
    // Right edge: top+1 to bottom
    for (let y = centerY - r + 1; y <= centerY + r; y++) {
      yield [centerX + r, y];
    }
    // Bottom edge: right-1 to left
    for (let x = centerX + r - 1; x >= centerX - r; x--) {
      yield [x, centerY + r];
    }
    // Left edge: bottom-1 to top+1
    for (let y = centerY + r - 1; y > centerY - r; y--) {
      yield [centerX - r, y];
    }
  }
}

/**
 * Checkerboard pattern — only hashes every other cell.
 * Covers area faster at the cost of gaps (which can be filled in a second pass).
 */
export function* checkerboardPattern(
  centerX: number,
  centerY: number,
  maxRadius: number
): Generator<[number, number]> {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only yield cells where (x+y) is even (checkerboard)
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if ((Math.abs(dx) + Math.abs(dy)) % 2 !== 0) continue;
        yield [centerX + dx, centerY + dy];
      }
    }
  }
}

/**
 * Ring pattern — expands in concentric rings (circle approximation).
 * Each ring samples points at increasing angular resolution.
 */
export function* ringPattern(
  centerX: number,
  centerY: number,
  maxRadius: number
): Generator<[number, number]> {
  yield [centerX, centerY];

  const visited = new Set<string>();
  visited.add(`${centerX},${centerY}`);

  for (let r = 1; r <= maxRadius; r++) {
    // Number of points on this ring scales with circumference
    const numPoints = Math.max(8, Math.floor(2 * Math.PI * r));
    for (let i = 0; i < numPoints; i++) {
      const angle = (2 * Math.PI * i) / numPoints;
      const x = Math.round(centerX + r * Math.cos(angle));
      const y = Math.round(centerY + r * Math.sin(angle));
      const key = `${x},${y}`;
      if (!visited.has(key)) {
        visited.add(key);
        yield [x, y];
      }
    }
  }
}

/**
 * Quadrant pattern — explores one quadrant at a time (NE, SE, SW, NW).
 * Good for methodical coverage when you know a general direction.
 */
export function* quadrantPattern(
  centerX: number,
  centerY: number,
  maxRadius: number
): Generator<[number, number]> {
  yield [centerX, centerY];

  // Quadrants: NE, SE, SW, NW
  const quads: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

  for (let r = 1; r <= maxRadius; r++) {
    for (const [sx, sy] of quads) {
      for (let dy = 0; dy <= r; dy++) {
        for (let dx = 0; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (Math.max(dx, dy) !== r) continue;
          yield [centerX + dx * sx, centerY + dy * sy];
        }
      }
    }
  }
}

/**
 * Random pattern — random coordinates within the radius.
 * Good for quick probabilistic discovery.
 */
export function* randomPattern(
  centerX: number,
  centerY: number,
  maxRadius: number
): Generator<[number, number]> {
  const visited = new Set<string>();
  const maxCells = (2 * maxRadius + 1) ** 2;

  while (visited.size < maxCells) {
    const dx = Math.floor(Math.random() * (2 * maxRadius + 1)) - maxRadius;
    const dy = Math.floor(Math.random() * (2 * maxRadius + 1)) - maxRadius;
    const key = `${centerX + dx},${centerY + dy}`;
    if (!visited.has(key)) {
      visited.add(key);
      yield [centerX + dx, centerY + dy];
    }
  }
}

/** Get a pattern generator by name */
export function getPatternGenerator(
  pattern: ScanPattern,
  centerX: number,
  centerY: number,
  maxRadius: number
): Generator<[number, number]> {
  switch (pattern) {
    case "spiral": return spiralPattern(centerX, centerY, maxRadius);
    case "checkerboard": return checkerboardPattern(centerX, centerY, maxRadius);
    case "ring": return ringPattern(centerX, centerY, maxRadius);
    case "quadrant": return quadrantPattern(centerX, centerY, maxRadius);
    case "random": return randomPattern(centerX, centerY, maxRadius);
  }
}

export const PATTERN_DESCRIPTIONS: Record<ScanPattern, string> = {
  spiral: "Expanding spiral from center — visits every cell in distance order",
  checkerboard: "Every other cell — faster coverage with gaps to fill later",
  ring: "Concentric circles — good for radial exploration",
  quadrant: "One quadrant at a time (NE, SE, SW, NW) — methodical coverage",
  random: "Random coordinates — quick probabilistic discovery",
};
