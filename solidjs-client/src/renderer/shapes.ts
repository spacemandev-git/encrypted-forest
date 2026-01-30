/**
 * 3D vertex/edge data for each wireframe shape type.
 * Each shape is defined by vertices (3D coords) and edges (index pairs).
 */

export interface ShapeData {
  vertices: [number, number, number][];
  edges: [number, number][];
}

/** Size 1: Tetrahedron (4 vertices, 6 edges) */
export function tetrahedron(scale: number = 1): ShapeData {
  const s = scale;
  const vertices: [number, number, number][] = [
    [0, s, 0],
    [s * 0.943, -s * 0.333, 0],
    [-s * 0.471, -s * 0.333, s * 0.816],
    [-s * 0.471, -s * 0.333, -s * 0.816],
  ];
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3],
    [1, 2], [2, 3], [3, 1],
  ];
  return { vertices, edges };
}

/** Size 2: Cube (8 vertices, 12 edges) */
export function cube(scale: number = 1): ShapeData {
  const s = scale * 0.7;
  const vertices: [number, number, number][] = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0], // front
    [4, 5], [5, 6], [6, 7], [7, 4], // back
    [0, 4], [1, 5], [2, 6], [3, 7], // connecting
  ];
  return { vertices, edges };
}

/** Size 3: Octahedron (6 vertices, 12 edges) */
export function octahedron(scale: number = 1): ShapeData {
  const s = scale;
  const vertices: [number, number, number][] = [
    [0, s, 0], [0, -s, 0],
    [s, 0, 0], [-s, 0, 0],
    [0, 0, s], [0, 0, -s],
  ];
  const edges: [number, number][] = [
    [0, 2], [0, 3], [0, 4], [0, 5],
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 4], [4, 3], [3, 5], [5, 2],
  ];
  return { vertices, edges };
}

/** Size 4: Icosahedron (12 vertices, 30 edges) */
export function icosahedron(scale: number = 1): ShapeData {
  const s = scale;
  const t = s * (1 + Math.sqrt(5)) / 2;
  const n = (v: number) => v / Math.sqrt(s * s + t * t) * s; // normalize to radius
  const vertices: [number, number, number][] = [
    [n(-s), n(t), 0], [n(s), n(t), 0], [n(-s), n(-t), 0], [n(s), n(-t), 0],
    [0, n(-s), n(t)], [0, n(s), n(t)], [0, n(-s), n(-t)], [0, n(s), n(-t)],
    [n(t), 0, n(-s)], [n(t), 0, n(s)], [n(-t), 0, n(-s)], [n(-t), 0, n(s)],
  ];
  const edges: [number, number][] = [
    [0, 1], [0, 5], [0, 7], [0, 10], [0, 11],
    [1, 5], [1, 7], [1, 8], [1, 9],
    [2, 3], [2, 4], [2, 6], [2, 10], [2, 11],
    [3, 4], [3, 6], [3, 8], [3, 9],
    [4, 5], [4, 9], [4, 11],
    [5, 9], [5, 11],
    [6, 7], [6, 8], [6, 10],
    [7, 8], [7, 10],
    [8, 9],
    [10, 11],
  ];
  return { vertices, edges };
}

/** Size 5: Sphere wireframe (lat/long grid, ~40 vertices) */
export function sphereWireframe(scale: number = 1, latDiv: number = 5, lonDiv: number = 8): ShapeData {
  const vertices: [number, number, number][] = [];
  const edges: [number, number][] = [];

  // Generate vertices on latitude/longitude grid
  for (let lat = 0; lat <= latDiv; lat++) {
    const theta = (Math.PI * lat) / latDiv;
    for (let lon = 0; lon < lonDiv; lon++) {
      const phi = (2 * Math.PI * lon) / lonDiv;
      vertices.push([
        scale * Math.sin(theta) * Math.cos(phi),
        scale * Math.cos(theta),
        scale * Math.sin(theta) * Math.sin(phi),
      ]);
    }
  }

  // Connect latitude rings
  for (let lat = 0; lat <= latDiv; lat++) {
    for (let lon = 0; lon < lonDiv; lon++) {
      const curr = lat * lonDiv + lon;
      const next = lat * lonDiv + ((lon + 1) % lonDiv);
      edges.push([curr, next]);
    }
  }

  // Connect longitude lines
  for (let lat = 0; lat < latDiv; lat++) {
    for (let lon = 0; lon < lonDiv; lon++) {
      const curr = lat * lonDiv + lon;
      const below = (lat + 1) * lonDiv + lon;
      edges.push([curr, below]);
    }
  }

  return { vertices, edges };
}

/** Size 6: Dense sphere wireframe (~80 vertices) */
export function denseSphereWireframe(scale: number = 1): ShapeData {
  return sphereWireframe(scale, 8, 12);
}

/** Star-burst wireframe for quasars */
export function starBurst(scale: number = 1, spikes: number = 8): ShapeData {
  const vertices: [number, number, number][] = [[0, 0, 0]]; // center
  const edges: [number, number][] = [];

  for (let i = 0; i < spikes; i++) {
    const theta = (Math.PI * 2 * i) / spikes;
    const phi = Math.PI * 0.4 + Math.random() * 0.4;
    vertices.push([
      scale * 1.5 * Math.sin(phi) * Math.cos(theta),
      scale * 1.5 * Math.cos(phi),
      scale * 1.5 * Math.sin(phi) * Math.sin(theta),
    ]);
    // Connect center to spike
    edges.push([0, vertices.length - 1]);
    // Add inner ring vertex
    vertices.push([
      scale * 0.4 * Math.sin(phi) * Math.cos(theta + 0.3),
      scale * 0.4 * Math.cos(phi),
      scale * 0.4 * Math.sin(phi) * Math.sin(theta + 0.3),
    ]);
    edges.push([0, vertices.length - 1]);
  }

  // Connect spikes in a ring
  for (let i = 0; i < spikes; i++) {
    edges.push([1 + i * 2, 1 + ((i + 1) % spikes) * 2]);
  }

  return { vertices, edges };
}

/** Torus wireframe for spacetime rips */
export function torus(
  scale: number = 1,
  majorSegments: number = 12,
  minorSegments: number = 6,
  majorRadius: number = 1,
  minorRadius: number = 0.4
): ShapeData {
  const vertices: [number, number, number][] = [];
  const edges: [number, number][] = [];

  for (let i = 0; i < majorSegments; i++) {
    const theta = (2 * Math.PI * i) / majorSegments;
    for (let j = 0; j < minorSegments; j++) {
      const phi = (2 * Math.PI * j) / minorSegments;
      const r = majorRadius + minorRadius * Math.cos(phi);
      vertices.push([
        scale * r * Math.cos(theta),
        scale * minorRadius * Math.sin(phi),
        scale * r * Math.sin(theta),
      ]);
    }
  }

  // Connect minor rings
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      const curr = i * minorSegments + j;
      const nextJ = i * minorSegments + ((j + 1) % minorSegments);
      edges.push([curr, nextJ]);
    }
  }

  // Connect major rings
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      const curr = i * minorSegments + j;
      const nextI = ((i + 1) % majorSegments) * minorSegments + j;
      edges.push([curr, nextI]);
    }
  }

  return { vertices, edges };
}

/** Ring of small cubes for asteroid belts */
export function asteroidRing(scale: number = 1, count: number = 8): ShapeData {
  const vertices: [number, number, number][] = [];
  const edges: [number, number][] = [];
  const cubeSize = scale * 0.15;

  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const r = scale * 0.9;
    const cx = r * Math.cos(angle);
    const cy = (Math.random() - 0.5) * scale * 0.2;
    const cz = r * Math.sin(angle);
    const base = vertices.length;

    // Add mini cube vertices
    for (let dx = -1; dx <= 1; dx += 2) {
      for (let dy = -1; dy <= 1; dy += 2) {
        for (let dz = -1; dz <= 1; dz += 2) {
          vertices.push([
            cx + dx * cubeSize,
            cy + dy * cubeSize,
            cz + dz * cubeSize,
          ]);
        }
      }
    }

    // Mini cube edges (same pattern as cube)
    const b = base;
    edges.push(
      [b, b + 1], [b + 2, b + 3], [b + 4, b + 5], [b + 6, b + 7],
      [b, b + 2], [b + 1, b + 3], [b + 4, b + 6], [b + 5, b + 7],
      [b, b + 4], [b + 1, b + 5], [b + 2, b + 6], [b + 3, b + 7]
    );
  }

  return { vertices, edges };
}

/** Get shape data based on body type and size */
export function getShapeForPlanet(
  bodyType: number,
  size: number,
  scale: number
): ShapeData {
  // Body type: 0=Planet, 1=Quasar, 2=SpacetimeRip, 3=AsteroidBelt
  switch (bodyType) {
    case 1: return starBurst(scale);
    case 2: return torus(scale);
    case 3: return asteroidRing(scale);
    default: // Planet - size determines shape
      switch (size) {
        case 1: return tetrahedron(scale);
        case 2: return cube(scale);
        case 3: return octahedron(scale);
        case 4: return icosahedron(scale);
        case 5: return sphereWireframe(scale);
        case 6: return denseSphereWireframe(scale);
        default: return octahedron(scale);
      }
  }
}

/** Get pixel radius for a given size */
export function sizeToRadius(size: number): number {
  switch (size) {
    case 1: return 8;
    case 2: return 14;
    case 3: return 22;
    case 4: return 32;
    case 5: return 44;
    case 6: return 60;
    default: return 16;
  }
}
