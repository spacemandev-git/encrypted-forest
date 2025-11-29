# Lighting in Three.js

Lights illuminate your scene and make materials react realistically.

## Light Types Overview

| Light | Description | Cast Shadows |
|-------|-------------|--------------|
| `AmbientLight` | Uniform lighting everywhere | ❌ |
| `HemisphereLight` | Sky/ground gradient | ❌ |
| `DirectionalLight` | Sun-like parallel rays | ✅ |
| `PointLight` | Light bulb, all directions | ✅ |
| `SpotLight` | Cone of light | ✅ |
| `RectAreaLight` | Rectangular light source | ❌ |

## AmbientLight

Illuminates all objects equally. No direction, no shadows.

```javascript
const light = new THREE.AmbientLight(
  0xffffff,  // color
  0.5        // intensity
);
scene.add(light);
```

**Use case:** Base lighting to prevent completely black shadows.

## HemisphereLight

Gradient from sky color to ground color based on surface orientation.

```javascript
const light = new THREE.HemisphereLight(
  0xB1E1FF,  // sky color
  0xB97A20,  // ground color
  1          // intensity
);
scene.add(light);
```

**Use case:** Natural outdoor lighting without harsh shadows.

## DirectionalLight

Parallel rays like sunlight. Has a position and target.

```javascript
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 10, 10);
light.target.position.set(0, 0, 0);  // Optional: defaults to origin
scene.add(light);
scene.add(light.target);  // Required if moving target
```

**Properties:**
```javascript
light.intensity = 1;
light.color.set(0xffffff);
light.castShadow = true;
```

## PointLight

Emits light in all directions from a single point.

```javascript
const light = new THREE.PointLight(
  0xffffff,  // color
  150,       // intensity (use higher values since r155)
  100,       // distance (0 = infinite)
  2          // decay (physically correct = 2)
);
light.position.set(0, 10, 0);
scene.add(light);
```

**Note:** Since Three.js r155, physically correct lighting is the default. Use higher intensity values.

## SpotLight

Cone of light with adjustable angle and penumbra.

```javascript
const light = new THREE.SpotLight(
  0xffffff,  // color
  150,       // intensity
  100,       // distance
  Math.PI / 4, // angle (max spread)
  0.5,       // penumbra (edge softness 0-1)
  2          // decay
);
light.position.set(0, 10, 0);
light.target.position.set(0, 0, 0);
scene.add(light);
scene.add(light.target);
```

**Properties:**
```javascript
light.angle = Math.PI / 6;  // Cone angle in radians
light.penumbra = 0.5;       // 0 = sharp edge, 1 = fully soft
```

## RectAreaLight

Rectangular light source (like a window or fluorescent light).

**Note:** Only works with `MeshStandardMaterial` and `MeshPhysicalMaterial`.

```javascript
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';

// Required initialization
RectAreaLightUniformsLib.init();

const light = new THREE.RectAreaLight(
  0xffffff,  // color
  5,         // intensity
  10,        // width
  10         // height
);
light.position.set(0, 5, 0);
light.lookAt(0, 0, 0);
scene.add(light);

// Optional helper
const helper = new RectAreaLightHelper(light);
light.add(helper);
```

## Light Helpers

Visual debugging aids:

```javascript
// DirectionalLight
const helper = new THREE.DirectionalLightHelper(light, 5);
scene.add(helper);

// PointLight
const helper = new THREE.PointLightHelper(light, 1);
scene.add(helper);

// SpotLight
const helper = new THREE.SpotLightHelper(light);
scene.add(helper);

// HemisphereLight
const helper = new THREE.HemisphereLightHelper(light, 5);
scene.add(helper);
```

Update helpers when light properties change:
```javascript
helper.update();
```

## Shadows

### Enabling Shadows

```javascript
// 1. Enable on renderer
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// 2. Enable on light
light.castShadow = true;

// 3. Enable on objects
mesh.castShadow = true;      // Object casts shadow
mesh.receiveShadow = true;   // Object receives shadow
```

### Shadow Map Types

```javascript
renderer.shadowMap.type = THREE.BasicShadowMap;     // Fast, low quality
renderer.shadowMap.type = THREE.PCFShadowMap;       // Default
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // Soft edges
renderer.shadowMap.type = THREE.VSMShadowMap;       // Very soft
```

### Shadow Camera (DirectionalLight)

```javascript
// Adjust shadow camera bounds
light.shadow.camera.left = -10;
light.shadow.camera.right = 10;
light.shadow.camera.top = 10;
light.shadow.camera.bottom = -10;
light.shadow.camera.near = 0.1;
light.shadow.camera.far = 50;

// Shadow map resolution
light.shadow.mapSize.width = 2048;
light.shadow.mapSize.height = 2048;

// Shadow bias (reduce shadow acne)
light.shadow.bias = -0.0001;

// Update camera after changes
light.shadow.camera.updateProjectionMatrix();

// Helper to visualize shadow camera
const helper = new THREE.CameraHelper(light.shadow.camera);
scene.add(helper);
```

### SpotLight Shadows

SpotLight automatically calculates shadow camera from its angle:

```javascript
light.shadow.mapSize.width = 1024;
light.shadow.mapSize.height = 1024;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = 500;
```

### PointLight Shadows

PointLight creates 6 shadow maps (cube map). Very expensive!

```javascript
light.shadow.mapSize.width = 1024;
light.shadow.mapSize.height = 1024;
light.shadow.camera.near = 0.1;
light.shadow.camera.far = 100;
```

## Fake Shadows

For better performance, use a blurred circle texture:

```javascript
const shadowTexture = loader.load('shadow.png');
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: shadowTexture,
  transparent: true,
  depthWrite: false,
});

const shadowMesh = new THREE.Mesh(planeGeometry, shadowMaterial);
shadowMesh.rotation.x = -Math.PI / 2;
shadowMesh.position.y = 0.01;  // Slightly above ground
```

## Common Lighting Setups

### Basic 3-Point Lighting

```javascript
// Key light (main)
const keyLight = new THREE.DirectionalLight(0xffffff, 1);
keyLight.position.set(5, 10, 5);
scene.add(keyLight);

// Fill light (soften shadows)
const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

// Back light (rim/edge)
const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
backLight.position.set(0, 5, -10);
scene.add(backLight);
```

### Outdoor Scene

```javascript
// Sun
const sun = new THREE.DirectionalLight(0xFFFFC0, 1);
sun.position.set(100, 100, 50);
sun.castShadow = true;
scene.add(sun);

// Sky/ground ambient
const ambient = new THREE.HemisphereLight(0x87CEEB, 0x8B4513, 0.5);
scene.add(ambient);
```

### Indoor Scene

```javascript
// Soft ambient
const ambient = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambient);

// Ceiling lights
for (let i = 0; i < 4; i++) {
  const light = new THREE.PointLight(0xFFFFE0, 100, 20);
  light.position.set(
    (i % 2) * 10 - 5,
    8,
    Math.floor(i / 2) * 10 - 5
  );
  scene.add(light);
}
```

## Performance Tips

1. **Limit shadow-casting lights** - Each shadow map is expensive
2. **Use smaller shadow map sizes** - 512-1024 is often sufficient
3. **Tight shadow camera bounds** - Don't make it larger than needed
4. **Fewer lights = better performance** - Combine with baked lighting
5. **Consider fake shadows** - Texture-based shadows are cheap
6. **PointLight shadows are expensive** - 6x the cost of DirectionalLight

## Light Properties Reference

```javascript
// Common to all lights
light.color = new THREE.Color(0xffffff);
light.intensity = 1;
light.visible = true;

// DirectionalLight / SpotLight
light.target = new THREE.Object3D();
light.castShadow = false;

// PointLight / SpotLight
light.distance = 0;  // 0 = infinite
light.decay = 2;     // Physically correct = 2

// SpotLight only
light.angle = Math.PI / 3;  // Max 90 degrees (PI/2)
light.penumbra = 0;         // 0-1, edge softness

// Shadow properties
light.shadow.mapSize.width = 512;
light.shadow.mapSize.height = 512;
light.shadow.camera = new THREE.Camera();  // Auto-created
light.shadow.bias = 0;
light.shadow.normalBias = 0;
light.shadow.radius = 1;  // PCFSoftShadowMap blur
```
