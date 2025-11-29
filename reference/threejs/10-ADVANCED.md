# Advanced Three.js Topics

## Post-Processing

Post-processing applies effects to the rendered image (bloom, blur, color grading, etc.).

### Setup

```javascript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Create composer
const composer = new EffectComposer(renderer);

// Add render pass (renders the scene)
composer.addPass(new RenderPass(scene, camera));

// Add output pass (color space conversion)
composer.addPass(new OutputPass());

// In render loop
function animate() {
  composer.render();  // Instead of renderer.render()
}
```

### Common Effects

#### Bloom

```javascript
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,   // strength
  0.4,   // radius
  0.85   // threshold
);
composer.addPass(bloomPass);
```

#### Film Grain

```javascript
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';

const filmPass = new FilmPass(
  0.35,   // intensity
  false   // grayscale
);
composer.addPass(filmPass);
```

#### Outline

```javascript
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
outlinePass.selectedObjects = [mesh1, mesh2];
outlinePass.edgeStrength = 3;
outlinePass.edgeGlow = 1;
outlinePass.edgeThickness = 1;
outlinePass.visibleEdgeColor.set(0xffffff);
composer.addPass(outlinePass);
```

### Custom Post-Processing Shader

```javascript
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const customShader = {
  uniforms: {
    tDiffuse: { value: null },  // Previous pass result
    amount: { value: 1.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // Custom effect: invert colors
      gl_FragColor = vec4(1.0 - color.rgb * amount, color.a);
    }
  `
};

const customPass = new ShaderPass(customShader);
composer.addPass(customPass);
```

### Resize Handling

```javascript
function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
  composer.setSize(width, height);
}
```

## Render Targets

Render to a texture instead of the screen:

```javascript
// Create render target
const renderTarget = new THREE.WebGLRenderTarget(
  512, 512,  // Resolution
  {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat
  }
);

// Render to target
renderer.setRenderTarget(renderTarget);
renderer.render(scene, camera);

// Use as texture
const material = new THREE.MeshBasicMaterial({
  map: renderTarget.texture
});

// Render back to screen
renderer.setRenderTarget(null);
renderer.render(mainScene, mainCamera);
```

### Use Cases

- Portals
- Mirrors
- Dynamic textures
- Multi-pass rendering

## Raycasting

Detect objects under the mouse:

```javascript
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(event) {
  // Normalize mouse coordinates (-1 to 1)
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function checkIntersections() {
  raycaster.setFromCamera(mouse, camera);
  
  const intersects = raycaster.intersectObjects(scene.children, true);
  
  if (intersects.length > 0) {
    const firstHit = intersects[0];
    console.log('Hit:', firstHit.object.name);
    console.log('Point:', firstHit.point);
    console.log('Distance:', firstHit.distance);
    console.log('Face:', firstHit.face);
  }
}
```

### Raycasting Optimization

```javascript
// Only check specific objects
const pickableObjects = [mesh1, mesh2, mesh3];
const intersects = raycaster.intersectObjects(pickableObjects);

// Set ray length
raycaster.far = 100;

// Use layers for selective raycasting
mesh1.layers.set(1);
raycaster.layers.set(1);
```

## Instanced Meshes

Render thousands of identical objects efficiently:

```javascript
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });

const count = 10000;
const mesh = new THREE.InstancedMesh(geometry, material, count);

const dummy = new THREE.Object3D();
const color = new THREE.Color();

for (let i = 0; i < count; i++) {
  // Set position/rotation/scale
  dummy.position.set(
    Math.random() * 100 - 50,
    Math.random() * 100 - 50,
    Math.random() * 100 - 50
  );
  dummy.rotation.set(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    0
  );
  dummy.scale.setScalar(Math.random() + 0.5);
  dummy.updateMatrix();
  
  mesh.setMatrixAt(i, dummy.matrix);
  
  // Optional: per-instance color
  color.setHSL(Math.random(), 0.7, 0.5);
  mesh.setColorAt(i, color);
}

mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;

scene.add(mesh);
```

## Custom Shaders

### ShaderMaterial

```javascript
const material = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0 },
    color: { value: new THREE.Color(0xff0000) }
  },
  vertexShader: `
    uniform float time;
    varying vec2 vUv;
    
    void main() {
      vUv = uv;
      vec3 pos = position;
      pos.z += sin(pos.x * 10.0 + time) * 0.1;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    varying vec2 vUv;
    
    void main() {
      gl_FragColor = vec4(color * vUv.x, 1.0);
    }
  `
});

// Update in render loop
material.uniforms.time.value = clock.getElapsedTime();
```

### Built-in Uniforms (available automatically)

```glsl
// Vertex shader
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
```

## Level of Detail (LOD)

Show simpler models at distance:

```javascript
const lod = new THREE.LOD();

// Add levels (detail, distance)
lod.addLevel(highDetailMesh, 0);
lod.addLevel(mediumDetailMesh, 50);
lod.addLevel(lowDetailMesh, 100);

scene.add(lod);

// LOD updates automatically based on camera distance
```

## Fog

### Linear Fog

```javascript
scene.fog = new THREE.Fog(
  0xcccccc,  // color
  10,        // near
  100        // far
);
```

### Exponential Fog

```javascript
scene.fog = new THREE.FogExp2(
  0xcccccc,  // color
  0.02       // density
);
```

### Match Background

```javascript
scene.background = new THREE.Color(0xcccccc);
scene.fog = new THREE.Fog(0xcccccc, 10, 100);
```

## Custom BufferGeometry Attributes

### Per-Vertex Data

```javascript
const geometry = new THREE.BufferGeometry();

// Position (required)
const positions = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0.5, 1, 0
]);
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

// Custom attribute
const customData = new Float32Array([1.0, 0.5, 0.8]);
geometry.setAttribute('customAttribute', new THREE.BufferAttribute(customData, 1));
```

### Access in Shader

```glsl
attribute float customAttribute;

void main() {
  // Use customAttribute
}
```

## Web Workers (OffscreenCanvas)

Render in a worker thread:

```javascript
// main.js
const canvas = document.querySelector('#c');
const offscreen = canvas.transferControlToOffscreen();

const worker = new Worker('worker.js');
worker.postMessage({ canvas: offscreen }, [offscreen]);
```

```javascript
// worker.js
self.onmessage = (event) => {
  const canvas = event.data.canvas;
  
  const renderer = new THREE.WebGLRenderer({ canvas });
  // ... setup scene
  
  function animate() {
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
};
```

## Disposing Resources

Prevent memory leaks:

```javascript
function dispose(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(material => disposeMaterial(material));
      } else {
        disposeMaterial(child.material);
      }
    }
  });
}

function disposeMaterial(material) {
  material.dispose();
  
  // Dispose textures
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value && value.isTexture) {
      value.dispose();
    }
  }
}

// Usage
scene.remove(object);
dispose(object);
```

## Performance Monitoring

### Stats.js

```javascript
import Stats from 'three/addons/libs/stats.module.js';

const stats = new Stats();
document.body.appendChild(stats.dom);

function animate() {
  stats.begin();
  
  renderer.render(scene, camera);
  
  stats.end();
}
```

### Renderer Info

```javascript
console.log(renderer.info);
// {
//   render: { calls, triangles, points, lines },
//   memory: { geometries, textures },
//   programs: [...]
// }
```

## Performance Tips Summary

1. **Geometry**
   - Use BufferGeometry
   - Merge static geometries
   - Use InstancedMesh for duplicates
   - Reduce polygon count

2. **Materials**
   - Share materials between meshes
   - Use simpler materials when possible
   - Limit transparent objects

3. **Textures**
   - Use power-of-2 sizes
   - Compress textures
   - Use mipmaps
   - Limit texture size

4. **Rendering**
   - Frustum culling (automatic)
   - Use LOD for distant objects
   - Limit shadow-casting lights
   - Use smaller shadow maps

5. **General**
   - Dispose unused resources
   - Profile with Stats.js
   - Test on target devices
   - Use requestAnimationFrame

## WebXR (VR/AR)

```javascript
import { VRButton } from 'three/addons/webxr/VRButton.js';

// Enable XR
renderer.xr.enabled = true;

// Add VR button
document.body.appendChild(VRButton.createButton(renderer));

// Use setAnimationLoop (required for XR)
renderer.setAnimationLoop(animate);
```
