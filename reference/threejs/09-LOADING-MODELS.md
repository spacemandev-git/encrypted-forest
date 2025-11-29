# Loading 3D Models in Three.js

Three.js supports various 3D file formats through loaders.

## Format Comparison

| Format | Extension | Use Case |
|--------|-----------|----------|
| **GLTF/GLB** | `.gltf`, `.glb` | **Recommended** - Web-optimized, supports everything |
| OBJ | `.obj` + `.mtl` | Legacy, no animations |
| FBX | `.fbx` | Complex scenes, Autodesk |
| Collada | `.dae` | Legacy, XML-based |
| STL | `.stl` | 3D printing, no materials |

**Always use GLTF when possible!**

## GLTF Format

GLTF (GL Transmission Format) is designed for web delivery:
- Binary data for vertices (fast GPU upload)
- Supports animations, materials, textures
- Two variants: `.gltf` (JSON + separate files) or `.glb` (single binary)

### GLTFLoader

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

loader.load(
  'model.gltf',
  (gltf) => {
    // Success
    scene.add(gltf.scene);
    console.log('Loaded!');
  },
  (progress) => {
    // Progress
    console.log(`${(progress.loaded / progress.total * 100)}% loaded`);
  },
  (error) => {
    // Error
    console.error('Error loading model:', error);
  }
);
```

### GLTF Result Structure

```javascript
loader.load('model.gltf', (gltf) => {
  gltf.scene;        // THREE.Group - the root
  gltf.scenes;       // Array of scenes
  gltf.cameras;      // Array of cameras
  gltf.animations;   // Array of AnimationClips
  gltf.asset;        // Asset info (version, generator)
  
  // Add to scene
  scene.add(gltf.scene);
});
```

### With Draco Compression

Draco provides better compression for geometry:

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

gltfLoader.load('compressed-model.glb', (gltf) => {
  scene.add(gltf.scene);
});
```

## Inspecting Loaded Models

### Dump Scene Graph

```javascript
function dumpObject(obj, lines = [], isLast = true, prefix = '') {
  const localPrefix = isLast ? '└─' : '├─';
  lines.push(`${prefix}${prefix ? localPrefix : ''}${obj.name || '*no-name*'} [${obj.type}]`);
  
  const newPrefix = prefix + (isLast ? '  ' : '│ ');
  const lastNdx = obj.children.length - 1;
  
  obj.children.forEach((child, ndx) => {
    const isLast = ndx === lastNdx;
    dumpObject(child, lines, isLast, newPrefix);
  });
  
  return lines;
}

// Usage
loader.load('model.gltf', (gltf) => {
  console.log(dumpObject(gltf.scene).join('\n'));
});
```

Output example:
```
Scene [Scene]
└─Root [Object3D]
  ├─Body [Mesh]
  ├─Wheel_FL [Mesh]
  ├─Wheel_FR [Mesh]
  ├─Wheel_RL [Mesh]
  └─Wheel_RR [Mesh]
```

### Finding Objects

```javascript
// By name
const mesh = gltf.scene.getObjectByName('Wheel_FL');

// By type
gltf.scene.traverse((child) => {
  if (child.isMesh) {
    console.log('Found mesh:', child.name);
    child.castShadow = true;
    child.receiveShadow = true;
  }
});
```

## Handling Animations

```javascript
let mixer;

loader.load('animated-model.gltf', (gltf) => {
  scene.add(gltf.scene);
  
  // Create mixer
  mixer = new THREE.AnimationMixer(gltf.scene);
  
  // List available animations
  console.log('Animations:', gltf.animations.map(a => a.name));
  
  // Play first animation
  if (gltf.animations.length > 0) {
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  }
  
  // Or play specific animation
  const walkClip = THREE.AnimationClip.findByName(gltf.animations, 'walk');
  if (walkClip) {
    mixer.clipAction(walkClip).play();
  }
});

// Update in render loop
function animate() {
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);
  renderer.render(scene, camera);
}
```

## Auto-Framing Camera

Position camera to see the entire model:

```javascript
loader.load('model.gltf', (gltf) => {
  const model = gltf.scene;
  scene.add(model);
  
  // Compute bounding box
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  // Frame the model
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
  cameraZ *= 1.5;  // Add some padding
  
  camera.position.set(center.x, center.y, center.z + cameraZ);
  camera.lookAt(center);
  
  // Update controls if using OrbitControls
  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
});
```

## Loading Progress UI

```javascript
const loadingManager = new THREE.LoadingManager();

const progressBar = document.querySelector('.progress-bar');
const loadingScreen = document.querySelector('.loading-screen');

loadingManager.onProgress = (url, loaded, total) => {
  const progress = loaded / total;
  progressBar.style.width = `${progress * 100}%`;
};

loadingManager.onLoad = () => {
  loadingScreen.style.display = 'none';
};

const loader = new GLTFLoader(loadingManager);
```

## OBJ Loader (Legacy)

```javascript
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// Load materials first
const mtlLoader = new MTLLoader();
mtlLoader.load('model.mtl', (materials) => {
  materials.preload();
  
  // Then load OBJ
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('model.obj', (obj) => {
    scene.add(obj);
  });
});
```

## FBX Loader

```javascript
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const loader = new FBXLoader();
loader.load('model.fbx', (fbx) => {
  scene.add(fbx);
  
  // FBX animations
  if (fbx.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(fbx);
    mixer.clipAction(fbx.animations[0]).play();
  }
});
```

## Dealing with Scale Issues

Many models have incorrect scale:

```javascript
loader.load('model.gltf', (gltf) => {
  const model = gltf.scene;
  
  // Check model size
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  console.log('Model size:', size);
  
  // Scale if needed
  const desiredSize = 10;
  const scale = desiredSize / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(scale);
  
  // Center model
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  
  scene.add(model);
});
```

## Material Overrides

Replace materials on loaded models:

```javascript
loader.load('model.gltf', (gltf) => {
  const model = gltf.scene;
  
  // Override all materials
  model.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        roughness: 0.5,
        metalness: 0.5
      });
    }
  });
  
  scene.add(model);
});
```

## Enabling Shadows

```javascript
loader.load('model.gltf', (gltf) => {
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  
  scene.add(gltf.scene);
});
```

## Common Issues

### Model Not Visible

1. Check position and scale
2. Check camera position (model might be behind camera)
3. Add lighting (PBR materials need light)
4. Check material `side` property

### Wrong Orientation

Models may have different up-axis:

```javascript
// Rotate if Y-up model shows sideways
model.rotation.x = -Math.PI / 2;

// Or adjust in Blender before export:
// Export settings -> Transform -> +Y Up
```

### Missing Textures

1. Check texture paths in console
2. Use same folder structure as the model
3. For GLB, textures should be embedded

### Performance Issues

1. Reduce polygon count in modeling software
2. Use Draco compression
3. Combine meshes when possible
4. Use LOD (Level of Detail)

## Caching Models

```javascript
const modelCache = new Map();

async function loadModel(url) {
  if (modelCache.has(url)) {
    return modelCache.get(url).clone();
  }
  
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      modelCache.set(url, gltf.scene);
      resolve(gltf.scene.clone());
    }, undefined, reject);
  });
}

// Usage
const model1 = await loadModel('character.gltf');
const model2 = await loadModel('character.gltf');  // Uses cache
```

## Async/Await Loading

```javascript
function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function init() {
  try {
    const gltf = await loadGLTF('model.gltf');
    scene.add(gltf.scene);
  } catch (error) {
    console.error('Failed to load model:', error);
  }
}

init();
```

## Best Practices

1. **Use GLTF/GLB** - Best format for web
2. **Compress with Draco** - Smaller file sizes
3. **Optimize in modeling software** - Reduce polys before export
4. **Use texture atlases** - Combine textures
5. **Bake lighting** - For static scenes
6. **Test on mobile** - Performance varies greatly
