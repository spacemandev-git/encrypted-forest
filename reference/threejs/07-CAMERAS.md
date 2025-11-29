# Cameras in Three.js

Cameras determine what is visible in the rendered scene.

## Camera Types

| Camera | Perspective | Use Case |
|--------|-------------|----------|
| `PerspectiveCamera` | Yes | 3D scenes, games |
| `OrthographicCamera` | No | 2D games, CAD, UI |
| `CubeCamera` | Yes (6 directions) | Environment maps |
| `StereoCamera` | Yes (VR) | VR applications |

## PerspectiveCamera

Mimics human eye perspective - objects farther away appear smaller.

```javascript
const camera = new THREE.PerspectiveCamera(
  fov,      // Field of view (degrees, vertical)
  aspect,   // Aspect ratio (width / height)
  near,     // Near clipping plane
  far       // Far clipping plane
);

// Example
const camera = new THREE.PerspectiveCamera(
  75,                                      // 75 degree FOV
  window.innerWidth / window.innerHeight,  // Aspect ratio
  0.1,                                     // Near
  1000                                     // Far
);
```

### The Frustum

Only objects inside the frustum are rendered:

```
         Camera
            ◆
           /|\
          / | \
         /  |  \      near plane
        /   |   \     ┌───┐
       /    |    \   /     \
      /     |     \ /       \
     /      |      ▼         \
    /       |                 \
   └────────┴─────────────────┘
             far plane
```

### FOV (Field of View)

```javascript
camera.fov = 45;  // Narrow (zoomed in)
camera.fov = 75;  // Normal
camera.fov = 120; // Wide angle

// Must update after changing
camera.updateProjectionMatrix();
```

### Near and Far Planes

```javascript
// Near: Objects closer than this won't render
camera.near = 0.1;

// Far: Objects farther than this won't render
camera.far = 1000;

// Z-fighting tip: Don't make near too small or far too large
// Good ratio: far/near < 10000
```

## OrthographicCamera

No perspective - parallel projection. Objects appear same size regardless of distance.

```javascript
const camera = new THREE.OrthographicCamera(
  left,    // Left plane
  right,   // Right plane
  top,     // Top plane
  bottom,  // Bottom plane
  near,    // Near plane
  far      // Far plane
);

// Example: Fill window
const aspect = window.innerWidth / window.innerHeight;
const d = 10;  // Half the view height
const camera = new THREE.OrthographicCamera(
  -d * aspect,  // left
  d * aspect,   // right
  d,            // top
  -d,           // bottom
  0.1,          // near
  1000          // far
);
```

### 2D Canvas-like Coordinates

```javascript
// Origin at center
camera.left = -canvas.width / 2;
camera.right = canvas.width / 2;
camera.top = canvas.height / 2;
camera.bottom = -canvas.height / 2;

// Origin at top-left (like 2D canvas)
camera.left = 0;
camera.right = canvas.width;
camera.top = 0;
camera.bottom = canvas.height;
camera.near = -1;
camera.far = 1;
```

### Zoom

```javascript
camera.zoom = 2;  // Zoom in 2x
camera.zoom = 0.5; // Zoom out

// Must update after changing
camera.updateProjectionMatrix();
```

## Camera Positioning

### Position

```javascript
camera.position.set(0, 5, 10);
// or
camera.position.x = 0;
camera.position.y = 5;
camera.position.z = 10;
```

### LookAt

Point camera at a position:

```javascript
camera.lookAt(0, 0, 0);  // Look at origin
camera.lookAt(mesh.position);  // Look at object
```

### Camera Up Vector

Defines which direction is "up":

```javascript
camera.up.set(0, 1, 0);  // Y is up (default)
camera.up.set(0, 0, 1);  // Z is up (useful for top-down)
```

## Camera Controls

### OrbitControls

Orbit around a target, zoom, and pan:

```javascript
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);  // Point to orbit around
controls.update();

// Options
controls.enableDamping = true;  // Smooth movement
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.enablePan = true;
controls.enableRotate = true;
controls.minDistance = 1;
controls.maxDistance = 100;
controls.minPolarAngle = 0;           // Top
controls.maxPolarAngle = Math.PI;     // Bottom
controls.autoRotate = false;
controls.autoRotateSpeed = 2.0;

// In render loop (for damping)
function animate() {
  controls.update();
  renderer.render(scene, camera);
}
```

### FlyControls

First-person flying controls:

```javascript
import { FlyControls } from 'three/addons/controls/FlyControls.js';

const controls = new FlyControls(camera, renderer.domElement);
controls.movementSpeed = 10;
controls.rollSpeed = Math.PI / 6;
controls.dragToLook = true;

// In render loop
controls.update(deltaTime);
```

### PointerLockControls

First-person shooter controls:

```javascript
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const controls = new PointerLockControls(camera, document.body);

// Click to enable pointer lock
document.addEventListener('click', () => {
  controls.lock();
});

// Movement
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

document.addEventListener('keydown', (event) => {
  switch (event.code) {
    case 'KeyW': direction.z = 1; break;
    case 'KeyS': direction.z = -1; break;
    case 'KeyA': direction.x = -1; break;
    case 'KeyD': direction.x = 1; break;
  }
});

// In render loop
controls.moveForward(direction.z * speed);
controls.moveRight(direction.x * speed);
```

### TrackballControls

Like OrbitControls but allows full rotation:

```javascript
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const controls = new TrackballControls(camera, renderer.domElement);
controls.rotateSpeed = 1.0;
controls.zoomSpeed = 1.2;
controls.panSpeed = 0.8;
```

## Responsive Camera

Update camera when window resizes:

```javascript
function onWindowResize() {
  // PerspectiveCamera
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  
  // OrthographicCamera
  const aspect = window.innerWidth / window.innerHeight;
  const d = 10;
  camera.left = -d * aspect;
  camera.right = d * aspect;
  camera.updateProjectionMatrix();
  
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onWindowResize);
```

## Camera Helpers

### CameraHelper

Visualize camera frustum:

```javascript
const helper = new THREE.CameraHelper(camera);
scene.add(helper);

// Update when camera changes
helper.update();
```

## Multiple Cameras

### Split Screen

```javascript
const camera1 = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
const camera2 = new THREE.PerspectiveCamera(75, 1, 0.1, 100);

function render() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  // Left half
  renderer.setViewport(0, 0, width / 2, height);
  renderer.setScissor(0, 0, width / 2, height);
  renderer.setScissorTest(true);
  camera1.aspect = (width / 2) / height;
  camera1.updateProjectionMatrix();
  renderer.render(scene, camera1);
  
  // Right half
  renderer.setViewport(width / 2, 0, width / 2, height);
  renderer.setScissor(width / 2, 0, width / 2, height);
  camera2.aspect = (width / 2) / height;
  camera2.updateProjectionMatrix();
  renderer.render(scene, camera2);
}
```

## Z-Fighting Prevention

When objects are very close, you may see flickering. Solutions:

1. **Use logarithmic depth buffer:**
```javascript
const renderer = new THREE.WebGLRenderer({
  logarithmicDepthBuffer: true
});
```

2. **Increase near plane:**
```javascript
camera.near = 0.5;  // Instead of 0.001
```

3. **Decrease far plane:**
```javascript
camera.far = 100;  // Instead of 10000
```

4. **Offset geometry slightly**

## Camera Animation

### Smooth Camera Movement

```javascript
const targetPosition = new THREE.Vector3(10, 5, 10);
const targetLookAt = new THREE.Vector3(0, 0, 0);

function animate() {
  // Lerp position
  camera.position.lerp(targetPosition, 0.05);
  
  // Lerp lookAt (using a helper object)
  const currentLookAt = new THREE.Vector3();
  camera.getWorldDirection(currentLookAt);
  currentLookAt.add(camera.position);
  currentLookAt.lerp(targetLookAt, 0.05);
  camera.lookAt(currentLookAt);
  
  renderer.render(scene, camera);
}
```

### Follow Object

```javascript
function animate() {
  // Position behind and above object
  const offset = new THREE.Vector3(0, 5, -10);
  offset.applyQuaternion(target.quaternion);
  camera.position.copy(target.position).add(offset);
  
  // Look at object
  camera.lookAt(target.position);
  
  renderer.render(scene, camera);
}
```

## Camera in Scene Graph

Camera can be a child of another object:

```javascript
const car = new THREE.Object3D();
scene.add(car);

// Camera follows car
camera.position.set(0, 5, -10);
car.add(camera);

// Car moves, camera follows
car.position.x += 1;
```

## Properties Reference

```javascript
// Common
camera.position       // Vector3
camera.rotation       // Euler
camera.quaternion     // Quaternion
camera.up            // Vector3 (which way is up)
camera.matrixWorldInverse  // For shaders

// PerspectiveCamera
camera.fov           // Field of view (degrees)
camera.aspect        // Aspect ratio
camera.near          // Near plane
camera.far           // Far plane

// OrthographicCamera
camera.left          // Left plane
camera.right         // Right plane
camera.top           // Top plane
camera.bottom        // Bottom plane
camera.zoom          // Zoom level

// After changing any camera property
camera.updateProjectionMatrix();
```
