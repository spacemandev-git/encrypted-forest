# Textures in Three.js

Textures are images applied to geometry surfaces. They can define color, surface detail, transparency, and more.

## Loading Textures

### TextureLoader

```javascript
const loader = new THREE.TextureLoader();

// Simple load
const texture = loader.load('path/to/texture.jpg');

// With callbacks
const texture = loader.load(
  'path/to/texture.jpg',
  (texture) => { console.log('Loaded'); },   // onLoad
  (progress) => { console.log('Progress'); }, // onProgress
  (error) => { console.log('Error', error); } // onError
);
```

### LoadingManager

Track multiple texture loads:

```javascript
const loadingManager = new THREE.LoadingManager();

loadingManager.onLoad = () => {
  console.log('All textures loaded');
};

loadingManager.onProgress = (url, loaded, total) => {
  console.log(`Loading: ${loaded}/${total}`);
};

const loader = new THREE.TextureLoader(loadingManager);

const texture1 = loader.load('texture1.jpg');
const texture2 = loader.load('texture2.jpg');
const texture3 = loader.load('texture3.jpg');
```

## Applying Textures

### Basic Usage

```javascript
const texture = loader.load('texture.jpg');
texture.colorSpace = THREE.SRGBColorSpace;  // Important for color textures!

const material = new THREE.MeshBasicMaterial({
  map: texture,
});
```

### Multiple Textures per Cube

```javascript
const materials = [
  new THREE.MeshBasicMaterial({ map: loader.load('px.jpg') }), // right
  new THREE.MeshBasicMaterial({ map: loader.load('nx.jpg') }), // left
  new THREE.MeshBasicMaterial({ map: loader.load('py.jpg') }), // top
  new THREE.MeshBasicMaterial({ map: loader.load('ny.jpg') }), // bottom
  new THREE.MeshBasicMaterial({ map: loader.load('pz.jpg') }), // front
  new THREE.MeshBasicMaterial({ map: loader.load('nz.jpg') }), // back
];

const cube = new THREE.Mesh(geometry, materials);
```

## Texture Types

### map (Color/Diffuse)

The base color texture:

```javascript
material.map = colorTexture;
```

### normalMap

Adds surface detail without extra geometry:

```javascript
material.normalMap = normalTexture;
material.normalScale = new THREE.Vector2(1, 1);  // Strength
```

### roughnessMap / metalnessMap

For PBR materials:

```javascript
material.roughnessMap = roughnessTexture;
material.metalnessMap = metalnessTexture;
```

### aoMap (Ambient Occlusion)

Darkens crevices:

```javascript
material.aoMap = aoTexture;
material.aoMapIntensity = 1.0;

// Requires UV2 attribute
geometry.setAttribute('uv2', geometry.attributes.uv);
```

### displacementMap

Actually moves vertices:

```javascript
material.displacementMap = displacementTexture;
material.displacementScale = 1;
material.displacementBias = 0;
```

### alphaMap

Transparency based on texture:

```javascript
material.alphaMap = alphaTexture;
material.transparent = true;
```

### emissiveMap

Glowing areas:

```javascript
material.emissive = new THREE.Color(0xffffff);
material.emissiveMap = emissiveTexture;
material.emissiveIntensity = 1;
```

### envMap (Environment Map)

Reflections:

```javascript
const cubeTextureLoader = new THREE.CubeTextureLoader();
const envMap = cubeTextureLoader.load([
  'px.jpg', 'nx.jpg',
  'py.jpg', 'ny.jpg',
  'pz.jpg', 'nz.jpg'
]);

material.envMap = envMap;
material.envMapIntensity = 1;
```

## Color Space

**Important:** Color textures should use SRGB color space:

```javascript
// For color/diffuse textures
texture.colorSpace = THREE.SRGBColorSpace;

// For data textures (normal, roughness, etc.) - leave as default
// They use LinearSRGBColorSpace by default
```

## Texture Wrapping

How textures repeat beyond 0-1 UV coordinates:

```javascript
// Repeat (tile)
texture.wrapS = THREE.RepeatWrapping;  // Horizontal
texture.wrapT = THREE.RepeatWrapping;  // Vertical

// Mirror repeat
texture.wrapS = THREE.MirroredRepeatWrapping;
texture.wrapT = THREE.MirroredRepeatWrapping;

// Clamp to edge (default)
texture.wrapS = THREE.ClampToEdgeWrapping;
texture.wrapT = THREE.ClampToEdgeWrapping;
```

## Texture Repeat and Offset

```javascript
// Repeat texture 4 times in each direction
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
texture.repeat.set(4, 4);

// Offset texture
texture.offset.set(0.5, 0.5);  // Shift by half

// Rotate texture
texture.rotation = Math.PI / 4;  // 45 degrees
texture.center.set(0.5, 0.5);    // Rotate around center
```

## Texture Filtering

### Magnification Filter

When texture pixels are larger than screen pixels:

```javascript
texture.magFilter = THREE.LinearFilter;   // Smooth (default)
texture.magFilter = THREE.NearestFilter;  // Pixelated
```

### Minification Filter

When texture pixels are smaller than screen pixels:

```javascript
// With mipmaps (recommended)
texture.minFilter = THREE.LinearMipmapLinearFilter;  // Best quality (default)
texture.minFilter = THREE.LinearMipmapNearestFilter;
texture.minFilter = THREE.NearestMipmapLinearFilter;
texture.minFilter = THREE.NearestMipmapNearestFilter;

// Without mipmaps
texture.minFilter = THREE.LinearFilter;
texture.minFilter = THREE.NearestFilter;
```

### Filter Comparison

```
                    Quality
                    Low ←————→ High
                    
NearestFilter       ████████░░░░ Fast, pixelated
LinearFilter        ░░████████░░ Smooth
...MipmapNearest    ░░░░░████████ Better for distance
...MipmapLinear     ░░░░░░░░████ Best quality
```

## Mipmaps

Mipmaps are pre-calculated smaller versions of a texture. They improve performance and reduce aliasing when textures are viewed from a distance.

```javascript
// Mipmaps are generated automatically for power-of-2 textures
// (256, 512, 1024, 2048, etc.)

texture.generateMipmaps = true;  // Default

// Disable mipmaps
texture.generateMipmaps = false;
texture.minFilter = THREE.LinearFilter;
```

## Memory Considerations

Textures use significant GPU memory:

```
Memory ≈ width × height × 4 × 1.33 bytes

Example: 2048×2048 texture
= 2048 × 2048 × 4 × 1.33
= ~22 MB of GPU memory!
```

**Tips:**
- Keep textures as small as possible
- Use power-of-2 dimensions for mipmaps
- Compress textures where possible (JPG for color, PNG for alpha)

## JPG vs PNG

| Format | Compression | Transparency | Best For |
|--------|-------------|--------------|----------|
| JPG | Lossy | No | Photos, complex images |
| PNG | Lossless | Yes | Graphics with alpha, UI |

**Note:** Both use the same GPU memory once loaded!

## Creating Textures from Canvas

```javascript
const canvas = document.createElement('canvas');
canvas.width = 256;
canvas.height = 256;
const ctx = canvas.getContext('2d');

// Draw something
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 256, 256);

// Create texture
const texture = new THREE.CanvasTexture(canvas);
material.map = texture;

// Update texture when canvas changes
texture.needsUpdate = true;
```

## Data Textures

Create textures from raw data:

```javascript
const width = 256;
const height = 256;
const size = width * height;
const data = new Uint8Array(4 * size);

for (let i = 0; i < size; i++) {
  const stride = i * 4;
  data[stride] = Math.random() * 255;     // R
  data[stride + 1] = Math.random() * 255; // G
  data[stride + 2] = Math.random() * 255; // B
  data[stride + 3] = 255;                 // A
}

const texture = new THREE.DataTexture(data, width, height);
texture.needsUpdate = true;
```

## Video Textures

```javascript
const video = document.createElement('video');
video.src = 'video.mp4';
video.load();
video.play();

const texture = new THREE.VideoTexture(video);
material.map = texture;
```

## Cube Textures (Environment Maps)

```javascript
const loader = new THREE.CubeTextureLoader();
const texture = loader.load([
  'right.jpg',   // positive x
  'left.jpg',    // negative x
  'top.jpg',     // positive y
  'bottom.jpg',  // negative y
  'front.jpg',   // positive z
  'back.jpg'     // negative z
]);

// Use as scene background
scene.background = texture;

// Use as environment map
material.envMap = texture;
```

## Equirectangular Environment Maps

```javascript
const loader = new THREE.TextureLoader();
const texture = loader.load('environment.hdr');

texture.mapping = THREE.EquirectangularReflectionMapping;

scene.background = texture;
scene.environment = texture;  // Affects all PBR materials
```

## Disposing Textures

```javascript
texture.dispose();  // Free GPU memory
```

## Common Issues

### Texture Not Showing

1. Check path is correct
2. Ensure server supports the file type
3. Check for CORS issues

### Texture Looks Wrong

1. Set `colorSpace = THREE.SRGBColorSpace` for color textures
2. Check UV mapping on geometry
3. Verify wrapS/wrapT settings

### Performance Issues

1. Reduce texture size
2. Use compressed textures
3. Check mipmap settings

## Texture Properties Reference

```javascript
const texture = new THREE.Texture(image);

// Transform
texture.offset     // Vector2: UV offset
texture.repeat     // Vector2: UV repeat
texture.rotation   // Number: rotation in radians
texture.center     // Vector2: rotation center

// Wrapping
texture.wrapS      // Horizontal wrapping mode
texture.wrapT      // Vertical wrapping mode

// Filtering
texture.magFilter  // Magnification filter
texture.minFilter  // Minification filter

// Mipmaps
texture.generateMipmaps  // Boolean
texture.anisotropy       // Number: anisotropic filtering level

// Format
texture.format     // THREE.RGBAFormat, etc.
texture.type       // THREE.UnsignedByteType, etc.
texture.colorSpace // THREE.SRGBColorSpace, etc.

// Misc
texture.flipY      // Flip vertically (default: true)
texture.needsUpdate // Flag for updates
```
