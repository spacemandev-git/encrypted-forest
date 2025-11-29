# Materials in Three.js

Materials define how objects appear in the scene. They control color, texture, shininess, transparency, and more.

## Material Types Overview

| Material | Lighting | Use Case |
|----------|----------|----------|
| `MeshBasicMaterial` | ❌ No | Unlit objects, always visible |
| `MeshLambertMaterial` | ✅ Vertex | Fast, matte surfaces |
| `MeshPhongMaterial` | ✅ Per-pixel | Shiny surfaces with specular highlights |
| `MeshStandardMaterial` | ✅ PBR | Realistic materials (recommended) |
| `MeshPhysicalMaterial` | ✅ PBR+ | Advanced PBR with clearcoat, transmission |
| `MeshToonMaterial` | ✅ Toon | Cartoon/cel-shading style |
| `MeshNormalMaterial` | ❌ | Debugging, shows surface normals |
| `MeshDepthMaterial` | ❌ | Debugging, shows depth |

## MeshBasicMaterial

Not affected by lights. Useful for UI elements, skyboxes, or stylized graphics.

```javascript
const material = new THREE.MeshBasicMaterial({
  color: 0xff0000,           // Hex color
  wireframe: false,          // Show as wireframe
  transparent: false,        // Enable transparency
  opacity: 1.0,              // 0 = invisible, 1 = opaque
  side: THREE.FrontSide,     // Which side to render
  map: texture,              // Color texture
});
```

## MeshLambertMaterial

Diffuse lighting only (no specular highlights). Fast but less realistic.

```javascript
const material = new THREE.MeshLambertMaterial({
  color: 0xff0000,
  emissive: 0x000000,        // Self-illumination color
  emissiveIntensity: 1,
});
```

## MeshPhongMaterial

Adds specular highlights. Good for shiny surfaces.

```javascript
const material = new THREE.MeshPhongMaterial({
  color: 0xff0000,           // Base color
  emissive: 0x000000,        // Self-illumination
  specular: 0x111111,        // Specular highlight color
  shininess: 30,             // 0-100, higher = sharper highlights
  flatShading: false,        // Faceted look
});
```

## MeshStandardMaterial (Recommended)

Physically-based rendering (PBR). Most realistic for most use cases.

```javascript
const material = new THREE.MeshStandardMaterial({
  color: 0xff0000,
  roughness: 0.5,            // 0 = mirror, 1 = matte
  metalness: 0.0,            // 0 = plastic, 1 = metal
  emissive: 0x000000,
  emissiveIntensity: 1,
  
  // Maps (textures)
  map: colorTexture,         // Base color
  normalMap: normalTexture,  // Surface detail
  roughnessMap: roughTexture,
  metalnessMap: metalTexture,
  aoMap: aoTexture,          // Ambient occlusion
  displacementMap: dispTexture,
  displacementScale: 1,
});
```

### Roughness and Metalness

```
           Roughness
           0 ←——→ 1
         ┌─────────┐
     0   │ Mirror  │ Matte
  M      │ Plastic │ Plastic
  e      ├─────────┤
  t      │ Mirror  │ Matte
  a  1   │ Metal   │ Metal
  l      └─────────┘
```

## MeshPhysicalMaterial

Extended PBR with advanced features like clearcoat, transmission, and sheen.

```javascript
const material = new THREE.MeshPhysicalMaterial({
  // All MeshStandardMaterial properties plus:
  
  clearcoat: 0.5,            // Clear lacquer layer
  clearcoatRoughness: 0.1,
  
  transmission: 0.9,         // Glass-like transparency
  thickness: 0.5,            // Thickness for refraction
  ior: 1.5,                  // Index of refraction
  
  sheen: 0.5,                // Fabric-like sheen
  sheenRoughness: 0.5,
  sheenColor: 0xffffff,
  
  iridescence: 0.5,          // Rainbow effect
  iridescenceIOR: 1.3,
});
```

## MeshToonMaterial

Cartoon/cel-shading style with discrete color bands.

```javascript
const material = new THREE.MeshToonMaterial({
  color: 0xff0000,
  gradientMap: gradientTexture,  // Controls color bands
});

// Create gradient for 2-tone look
const colors = new Uint8Array([0, 255]);  // Dark, light
const gradientMap = new THREE.DataTexture(colors, 2, 1, THREE.LuminanceFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
```

## Special Materials

### MeshNormalMaterial

Shows surface normals as colors. Great for debugging.

```javascript
const material = new THREE.MeshNormalMaterial({
  flatShading: false,
});
// X = Red, Y = Green, Z = Blue
```

### MeshDepthMaterial

Shows depth from camera. Used for shadows and special effects.

```javascript
const material = new THREE.MeshDepthMaterial();
```

### ShadowMaterial

Only receives shadows, otherwise transparent.

```javascript
const material = new THREE.ShadowMaterial({
  opacity: 0.5,
});
```

## Line Materials

```javascript
// Basic line
const material = new THREE.LineBasicMaterial({
  color: 0xffffff,
  linewidth: 1,  // Note: linewidth > 1 only works on some systems
});

// Dashed line
const material = new THREE.LineDashedMaterial({
  color: 0xffffff,
  linewidth: 1,
  scale: 1,
  dashSize: 3,
  gapSize: 1,
});
```

## Point Materials

```javascript
const material = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 1,
  sizeAttenuation: true,  // Size decreases with distance
  map: spriteTexture,
  transparent: true,
  alphaTest: 0.5,
});
```

## Common Properties

### Setting Color

```javascript
// At creation
const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const material = new THREE.MeshBasicMaterial({ color: 'red' });
const material = new THREE.MeshBasicMaterial({ color: '#ff0000' });
const material = new THREE.MeshBasicMaterial({ color: 'rgb(255, 0, 0)' });

// After creation
material.color.set(0x00ff00);
material.color.set('blue');
material.color.setHSL(0.5, 1, 0.5);  // Hue, Saturation, Lightness
material.color.setRGB(1, 0, 0);      // Values 0-1
```

### Side

```javascript
material.side = THREE.FrontSide;   // Default - render front faces
material.side = THREE.BackSide;    // Render back faces only
material.side = THREE.DoubleSide;  // Render both sides
```

### Transparency

```javascript
const material = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.5,
  
  // For textures with alpha
  alphaTest: 0.5,       // Discard pixels below threshold
  alphaMap: alphaTexture,
  
  // Depth buffer behavior
  depthWrite: true,     // Write to depth buffer
  depthTest: true,      // Test against depth buffer
});
```

### Wireframe

```javascript
material.wireframe = true;
material.wireframeLinewidth = 1;  // Limited browser support
```

### Flat Shading

```javascript
material.flatShading = true;  // Faceted look
```

## Material Updates

When changing certain properties after creation, you need to flag the material:

```javascript
material.needsUpdate = true;
```

Properties that require `needsUpdate`:
- `flatShading`
- Adding/removing textures
- Changing `side`

## Disposing Materials

```javascript
material.dispose();
// Also dispose textures
material.map?.dispose();
material.normalMap?.dispose();
// etc.
```

## Multiple Materials

Apply different materials to different faces of a geometry:

```javascript
const materials = [
  new THREE.MeshBasicMaterial({ map: texture1 }),
  new THREE.MeshBasicMaterial({ map: texture2 }),
  new THREE.MeshBasicMaterial({ map: texture3 }),
  new THREE.MeshBasicMaterial({ map: texture4 }),
  new THREE.MeshBasicMaterial({ map: texture5 }),
  new THREE.MeshBasicMaterial({ map: texture6 }),
];

const cube = new THREE.Mesh(boxGeometry, materials);
```

**Supported geometries for multiple materials:**
- `BoxGeometry` - 6 materials (one per face)
- `ConeGeometry` - 2 materials (bottom, side)
- `CylinderGeometry` - 3 materials (bottom, top, side)

## Cloning Materials

```javascript
const newMaterial = material.clone();
newMaterial.color.set(0x00ff00);
```

## Performance Tips

1. **Reuse materials** when possible
2. **Use simpler materials** for distant objects
3. **Limit transparent objects** - they're slower to render
4. **Use texture atlases** instead of many small textures
5. **MeshLambertMaterial** is faster than MeshPhongMaterial
6. **Avoid DoubleSide** unless necessary

## Material Comparison

```javascript
// Speed comparison (fastest to slowest):
// MeshBasicMaterial     -> No lighting calculations
// MeshLambertMaterial   -> Per-vertex lighting
// MeshPhongMaterial     -> Per-pixel lighting
// MeshStandardMaterial  -> PBR (but optimized)
// MeshPhysicalMaterial  -> Full PBR with extras
```
