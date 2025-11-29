# Geometry in Three.js

## Built-in Primitives

Three.js provides many built-in geometry primitives that are generated at runtime.

### BoxGeometry

```javascript
const geometry = new THREE.BoxGeometry(
  width,          // Default: 1
  height,         // Default: 1
  depth,          // Default: 1
  widthSegments,  // Default: 1
  heightSegments, // Default: 1
  depthSegments   // Default: 1
);
```

### SphereGeometry

```javascript
const geometry = new THREE.SphereGeometry(
  radius,           // Default: 1
  widthSegments,    // Default: 32 (horizontal)
  heightSegments,   // Default: 16 (vertical)
  phiStart,         // Default: 0 (horizontal start angle)
  phiLength,        // Default: Math.PI * 2 (horizontal sweep)
  thetaStart,       // Default: 0 (vertical start angle)
  thetaLength       // Default: Math.PI (vertical sweep)
);
```

### PlaneGeometry

```javascript
const geometry = new THREE.PlaneGeometry(
  width,          // Default: 1
  height,         // Default: 1
  widthSegments,  // Default: 1
  heightSegments  // Default: 1
);
```

### CylinderGeometry

```javascript
const geometry = new THREE.CylinderGeometry(
  radiusTop,      // Default: 1
  radiusBottom,   // Default: 1
  height,         // Default: 1
  radialSegments, // Default: 32
  heightSegments, // Default: 1
  openEnded,      // Default: false
  thetaStart,     // Default: 0
  thetaLength     // Default: Math.PI * 2
);
```

### ConeGeometry

```javascript
const geometry = new THREE.ConeGeometry(
  radius,         // Default: 1
  height,         // Default: 1
  radialSegments, // Default: 32
  heightSegments, // Default: 1
  openEnded,      // Default: false
  thetaStart,     // Default: 0
  thetaLength     // Default: Math.PI * 2
);
```

### TorusGeometry (Donut)

```javascript
const geometry = new THREE.TorusGeometry(
  radius,          // Default: 1
  tube,            // Default: 0.4 (tube radius)
  radialSegments,  // Default: 12
  tubularSegments  // Default: 48
);
```

### TorusKnotGeometry

```javascript
const geometry = new THREE.TorusKnotGeometry(
  radius,          // Default: 1
  tube,            // Default: 0.4
  tubularSegments, // Default: 64
  radialSegments,  // Default: 8
  p,               // Default: 2 (winds around axis)
  q                // Default: 3 (winds around torus)
);
```

### CircleGeometry

```javascript
const geometry = new THREE.CircleGeometry(
  radius,      // Default: 1
  segments,    // Default: 32
  thetaStart,  // Default: 0
  thetaLength  // Default: Math.PI * 2
);
```

### RingGeometry

```javascript
const geometry = new THREE.RingGeometry(
  innerRadius,    // Default: 0.5
  outerRadius,    // Default: 1
  thetaSegments,  // Default: 32
  phiSegments,    // Default: 1
  thetaStart,     // Default: 0
  thetaLength     // Default: Math.PI * 2
);
```

### Polyhedron Geometries

```javascript
// Tetrahedron (4 sides)
const geometry = new THREE.TetrahedronGeometry(radius, detail);

// Octahedron (8 sides)
const geometry = new THREE.OctahedronGeometry(radius, detail);

// Dodecahedron (12 sides)
const geometry = new THREE.DodecahedronGeometry(radius, detail);

// Icosahedron (20 sides)
const geometry = new THREE.IcosahedronGeometry(radius, detail);
```

## Shape-Based Geometries

### ShapeGeometry (2D Shape)

```javascript
const shape = new THREE.Shape();
const x = -2.5;
const y = -5;
shape.moveTo(x + 2.5, y + 2.5);
shape.bezierCurveTo(x + 2.5, y + 2.5, x + 2, y, x, y);
shape.bezierCurveTo(x - 3, y, x - 3, y + 3.5, x - 3, y + 3.5);
// ... more curve commands

const geometry = new THREE.ShapeGeometry(shape);
```

### ExtrudeGeometry (3D from 2D Shape)

```javascript
const extrudeSettings = {
  steps: 2,
  depth: 2,
  bevelEnabled: true,
  bevelThickness: 1,
  bevelSize: 1,
  bevelSegments: 2,
};

const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
```

### LatheGeometry (Rotate Profile)

```javascript
const points = [];
for (let i = 0; i < 10; i++) {
  points.push(new THREE.Vector2(
    Math.sin(i * 0.2) * 3 + 3,
    (i - 5) * 0.8
  ));
}

const geometry = new THREE.LatheGeometry(
  points,    // Array of Vector2
  segments,  // Default: 12
  phiStart,  // Default: 0
  phiLength  // Default: Math.PI * 2
);
```

### TubeGeometry (Follow Path)

```javascript
class CustomCurve extends THREE.Curve {
  getPoint(t) {
    const tx = t * 3 - 1.5;
    const ty = Math.sin(2 * Math.PI * t);
    const tz = 0;
    return new THREE.Vector3(tx, ty, tz);
  }
}

const path = new CustomCurve();
const geometry = new THREE.TubeGeometry(
  path,             // Curve
  tubularSegments,  // Default: 64
  radius,           // Default: 1
  radialSegments,   // Default: 8
  closed            // Default: false
);
```

## Helper Geometries

### EdgesGeometry

Shows edges only where face angle exceeds threshold:

```javascript
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const edgesGeometry = new THREE.EdgesGeometry(boxGeometry, thresholdAngle);

const material = new THREE.LineBasicMaterial({ color: 0x000000 });
const edges = new THREE.LineSegments(edgesGeometry, material);
scene.add(edges);
```

### WireframeGeometry

Shows all edges:

```javascript
const wireframeGeometry = new THREE.WireframeGeometry(boxGeometry);
const wireframe = new THREE.LineSegments(wireframeGeometry, lineMaterial);
scene.add(wireframe);
```

## Custom BufferGeometry

### Basic Structure

```javascript
const geometry = new THREE.BufferGeometry();

// Positions (required)
const positions = new Float32Array([
  -1, -1, 0,  // vertex 0
   1, -1, 0,  // vertex 1
   0,  1, 0,  // vertex 2
]);
geometry.setAttribute('position', 
  new THREE.BufferAttribute(positions, 3));

// Normals (optional but usually needed for lighting)
const normals = new Float32Array([
  0, 0, 1,
  0, 0, 1,
  0, 0, 1,
]);
geometry.setAttribute('normal', 
  new THREE.BufferAttribute(normals, 3));

// UVs (optional, needed for textures)
const uvs = new Float32Array([
  0, 0,
  1, 0,
  0.5, 1,
]);
geometry.setAttribute('uv', 
  new THREE.BufferAttribute(uvs, 2));
```

### Using Indices

Indices allow sharing vertices between triangles:

```javascript
const positions = new Float32Array([
  // 4 vertices for a quad
  -1, -1, 0,  // 0
   1, -1, 0,  // 1
  -1,  1, 0,  // 2
   1,  1, 0,  // 3
]);

geometry.setAttribute('position', 
  new THREE.BufferAttribute(positions, 3));

// Two triangles sharing vertices
geometry.setIndex([
  0, 1, 2,  // first triangle
  2, 1, 3,  // second triangle
]);
```

### Complete Cube Example

```javascript
const vertices = [
  // front
  { pos: [-1, -1,  1], norm: [0, 0, 1], uv: [0, 0] },
  { pos: [ 1, -1,  1], norm: [0, 0, 1], uv: [1, 0] },
  { pos: [-1,  1,  1], norm: [0, 0, 1], uv: [0, 1] },
  { pos: [ 1,  1,  1], norm: [0, 0, 1], uv: [1, 1] },
  // back
  { pos: [ 1, -1, -1], norm: [0, 0, -1], uv: [0, 0] },
  { pos: [-1, -1, -1], norm: [0, 0, -1], uv: [1, 0] },
  { pos: [ 1,  1, -1], norm: [0, 0, -1], uv: [0, 1] },
  { pos: [-1,  1, -1], norm: [0, 0, -1], uv: [1, 1] },
  // ... other faces
];

const positions = [];
const normals = [];
const uvs = [];

for (const vertex of vertices) {
  positions.push(...vertex.pos);
  normals.push(...vertex.norm);
  uvs.push(...vertex.uv);
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', 
  new THREE.BufferAttribute(new Float32Array(positions), 3));
geometry.setAttribute('normal', 
  new THREE.BufferAttribute(new Float32Array(normals), 3));
geometry.setAttribute('uv', 
  new THREE.BufferAttribute(new Float32Array(uvs), 2));

geometry.setIndex([
  0, 1, 2, 2, 1, 3,   // front
  4, 5, 6, 6, 5, 7,   // back
  // ... other faces
]);
```

### Computing Normals

If you don't provide normals, you can compute them:

```javascript
geometry.computeVertexNormals();
```

**Note**: This creates smooth normals. For flat shading, each face needs unique vertices with face normals.

### Dynamic Updates

```javascript
const positionAttribute = geometry.getAttribute('position');
positionAttribute.setUsage(THREE.DynamicDrawUsage);

// In render loop
positionAttribute.array[0] = newValue;
positionAttribute.needsUpdate = true;
```

## Points and Lines

### Points (Particle Systems)

```javascript
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(count * 3);

// Fill positions...

geometry.setAttribute('position', 
  new THREE.BufferAttribute(positions, 3));

const material = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.1,
  sizeAttenuation: true,  // Points get smaller with distance
});

const points = new THREE.Points(geometry, material);
scene.add(points);
```

### Lines

```javascript
const geometry = new THREE.BufferGeometry();
const points = [
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0),
];
geometry.setFromPoints(points);

const material = new THREE.LineBasicMaterial({ color: 0x0000ff });

// Continuous line
const line = new THREE.Line(geometry, material);

// Line segments (pairs of points)
const lineSegments = new THREE.LineSegments(geometry, material);

// Closed loop
const lineLoop = new THREE.LineLoop(geometry, material);
```

## Performance Considerations

### Segment Count

Higher segment counts = more triangles = slower rendering:

```javascript
// Low poly (fast)
const sphere = new THREE.SphereGeometry(1, 8, 6);

// Medium (balanced)
const sphere = new THREE.SphereGeometry(1, 32, 16);

// High poly (slow but smooth)
const sphere = new THREE.SphereGeometry(1, 64, 32);
```

### Reuse Geometry

```javascript
// Good - one geometry, multiple meshes
const geometry = new THREE.BoxGeometry(1, 1, 1);
for (let i = 0; i < 100; i++) {
  const material = new THREE.MeshPhongMaterial({ color: Math.random() * 0xffffff });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
}

// Bad - 100 separate geometries
for (let i = 0; i < 100; i++) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);  // Don't do this!
  // ...
}
```

### Dispose Unused Geometry

```javascript
geometry.dispose();  // Free GPU memory
```
