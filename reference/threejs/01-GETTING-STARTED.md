# Getting Started with Three.js

## Creating Your First Scene

To display anything with Three.js, you need three things:
1. **Scene** - Container for all objects
2. **Camera** - Defines what you see
3. **Renderer** - Draws everything to the canvas

### Basic Setup

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My First Three.js App</title>
  <style>
    body { margin: 0; }
  </style>
</head>
<body>
  <script type="module" src="/main.js"></script>
</body>
</html>
```

```javascript
// main.js
import * as THREE from 'three';

// 1. Create the scene
const scene = new THREE.Scene();

// 2. Create the camera
const camera = new THREE.PerspectiveCamera(
  75,                                      // FOV in degrees
  window.innerWidth / window.innerHeight,  // Aspect ratio
  0.1,                                     // Near plane
  1000                                     // Far plane
);

// 3. Create the renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Create geometry and material
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// 5. Position the camera
camera.position.z = 5;

// 6. Create animation loop
function animate() {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

## Understanding the Components

### PerspectiveCamera

```javascript
const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
```

| Parameter | Description |
|-----------|-------------|
| `fov` | Field of view in degrees (vertical). Typically 45-75 |
| `aspect` | Aspect ratio (width / height) |
| `near` | Objects closer than this won't be rendered |
| `far` | Objects farther than this won't be rendered |

**The Frustum**: The camera defines a "frustum" - a pyramid with the tip cut off. Only objects inside this frustum are rendered.

```
         near plane
            ┌───┐
           /     \
          /       \
         /         \
        /           \
       /             \
      /               \
     └─────────────────┘
         far plane
```

### WebGLRenderer

```javascript
const renderer = new THREE.WebGLRenderer({
  antialias: true,    // Smooth edges
  canvas: myCanvas,   // Optional: use existing canvas
  alpha: true,        // Transparent background
});

renderer.setSize(width, height);
renderer.setPixelRatio(window.devicePixelRatio); // For HD displays
```

### Mesh = Geometry + Material

```javascript
// Geometry defines the shape
const geometry = new THREE.BoxGeometry(width, height, depth);

// Material defines the appearance
const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });

// Mesh combines both
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
```

## The Render Loop

### Using setAnimationLoop (Recommended)

```javascript
function animate() {
  // Update objects
  cube.rotation.x += 0.01;
  
  // Render the scene
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

### Using requestAnimationFrame (Alternative)

```javascript
function animate() {
  requestAnimationFrame(animate);
  
  cube.rotation.x += 0.01;
  renderer.render(scene, camera);
}
animate();
```

### Time-Based Animation

```javascript
function animate(time) {
  time *= 0.001; // Convert to seconds
  
  cube.rotation.x = time;
  cube.rotation.y = time;
  
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

## Adding Lights

`MeshBasicMaterial` is not affected by lights. Use `MeshPhongMaterial` or `MeshStandardMaterial` instead:

```javascript
// Change material to one that responds to light
const material = new THREE.MeshPhongMaterial({ color: 0x44aa88 });

// Add a directional light
const color = 0xFFFFFF;
const intensity = 1;
const light = new THREE.DirectionalLight(color, intensity);
light.position.set(-1, 2, 4);
scene.add(light);
```

## Responsive Design

### Making the Canvas Responsive

```css
html, body {
  margin: 0;
  height: 100%;
}
#c {
  width: 100%;
  height: 100%;
  display: block;
}
```

### Handling Resize

```javascript
function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}

function animate() {
  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
}
```

### HD-DPI Display Support

```javascript
function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const pixelRatio = window.devicePixelRatio;
  const width = Math.floor(canvas.clientWidth * pixelRatio);
  const height = Math.floor(canvas.clientHeight * pixelRatio);
  const needResize = canvas.width !== width || canvas.height !== height;
  
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}
```

## Complete Working Example

```javascript
import * as THREE from 'three';

function main() {
  // Setup
  const canvas = document.querySelector('#c');
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });

  // Camera
  const fov = 75;
  const aspect = 2;
  const near = 0.1;
  const far = 5;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.z = 2;

  // Scene
  const scene = new THREE.Scene();

  // Light
  const color = 0xFFFFFF;
  const intensity = 3;
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(-1, 2, 4);
  scene.add(light);

  // Geometry
  const boxWidth = 1;
  const boxHeight = 1;
  const boxDepth = 1;
  const geometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);

  // Create multiple cubes
  function makeInstance(geometry, color, x) {
    const material = new THREE.MeshPhongMaterial({ color });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
    cube.position.x = x;
    return cube;
  }

  const cubes = [
    makeInstance(geometry, 0x44aa88, 0),
    makeInstance(geometry, 0x8844aa, -2),
    makeInstance(geometry, 0xaa8844, 2),
  ];

  // Resize handler
  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }

  // Render loop
  function render(time) {
    time *= 0.001;

    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    cubes.forEach((cube, ndx) => {
      const speed = 1 + ndx * 0.1;
      const rot = time * speed;
      cube.rotation.x = rot;
      cube.rotation.y = rot;
    });

    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(render);
}

main();
```

## Next Steps

- [Scene and Scenegraph](./02-SCENE-AND-SCENEGRAPH.md) - Learn about parent-child relationships
- [Geometry](./03-GEOMETRY.md) - Explore built-in shapes
- [Materials](./04-MATERIALS.md) - Make things look good
- [Lighting](./06-LIGHTING.md) - Illuminate your scenes
