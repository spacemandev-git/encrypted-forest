# Three.js Reference Documentation

## Overview

Three.js is a JavaScript 3D library that makes WebGL easy. It provides a high-level API for creating 3D graphics in the browser, handling scenes, lights, shadows, materials, textures, 3D math, and much more.

> **Source**: This documentation is derived from the official [Three.js Manual](https://threejs.org/manual/)

## What is Three.js?

Three.js is a cross-browser JavaScript library and application programming interface (API) used to create and display animated 3D computer graphics in a web browser using WebGL. While WebGL is a very low-level system that only draws points, lines, and triangles, Three.js abstracts away this complexity.

## Core Concepts

### 1. The Renderer
The `WebGLRenderer` is responsible for taking all the data you provide and rendering it to a canvas. It draws the portion of the 3D scene that is inside the camera's frustum as a 2D image.

### 2. The Scene
A `Scene` is the root of a scene graph - a tree-like structure containing various objects. Everything you want Three.js to draw needs to be added to the scene.

### 3. The Camera
Cameras define what portion of the scene is visible. The most common types are:
- **PerspectiveCamera** - Mimics human eye perspective (things far away appear smaller)
- **OrthographicCamera** - No perspective, used for 2D or isometric views

### 4. Meshes
A `Mesh` represents the combination of:
- **Geometry** - The shape of the object (vertices)
- **Material** - How the object looks (color, texture, shininess)

### 5. Lights
Lights illuminate the scene. Types include:
- AmbientLight, HemisphereLight, DirectionalLight, PointLight, SpotLight, RectAreaLight

## Basic Three.js App Structure

```
                              ┌─────────────────────┐
                              │      Renderer       │
                              │  (WebGLRenderer)    │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │       Scene         │
                              └──────────┬──────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
    ┌─────────▼─────────┐     ┌─────────▼─────────┐     ┌─────────▼─────────┐
    │       Mesh        │     │       Light       │     │      Camera       │
    │  (Geometry +      │     │  (DirectionalLight,│     │  (Perspective or  │
    │   Material)       │     │   PointLight, etc.)│     │   Orthographic)   │
    └───────────────────┘     └───────────────────┘     └───────────────────┘
```

## Installation

### Using NPM (Recommended)

```bash
npm install three
```

```javascript
import * as THREE from 'three';
```

### Using CDN with Import Maps

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@<version>/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@<version>/examples/jsm/"
  }
}
</script>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
</script>
```

## Documentation Index

| File | Description |
|------|-------------|
| [01-GETTING-STARTED.md](./01-GETTING-STARTED.md) | Creating your first scene, render loop basics |
| [02-SCENE-AND-SCENEGRAPH.md](./02-SCENE-AND-SCENEGRAPH.md) | Scene management, Object3D hierarchy |
| [03-GEOMETRY.md](./03-GEOMETRY.md) | Built-in primitives, custom BufferGeometry |
| [04-MATERIALS.md](./04-MATERIALS.md) | Material types, properties, and usage |
| [05-TEXTURES.md](./05-TEXTURES.md) | Loading and applying textures, filtering, wrapping |
| [06-LIGHTING.md](./06-LIGHTING.md) | Light types, shadows, and configuration |
| [07-CAMERAS.md](./07-CAMERAS.md) | PerspectiveCamera, OrthographicCamera, controls |
| [08-ANIMATION.md](./08-ANIMATION.md) | Animation system, loading animated models |
| [09-LOADING-MODELS.md](./09-LOADING-MODELS.md) | GLTF loader, scene inspection |
| [10-ADVANCED.md](./10-ADVANCED.md) | Post-processing, render targets, custom shaders |

## Quick Start Example

```javascript
import * as THREE from 'three';

// Create scene
const scene = new THREE.Scene();

// Create camera
const camera = new THREE.PerspectiveCamera(
  75,                                    // Field of view (degrees)
  window.innerWidth / window.innerHeight, // Aspect ratio
  0.1,                                   // Near clipping plane
  1000                                   // Far clipping plane
);
camera.position.z = 5;

// Create renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Create a cube
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Add light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(1, 2, 4);
scene.add(light);

// Animation loop
function animate() {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

## ES6 Modules & Addons

Three.js uses ES6 modules. To import addons (like OrbitControls):

```javascript
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
```

## Key Links

- [Official Documentation](https://threejs.org/docs/)
- [Official Examples](https://threejs.org/examples/)
- [GitHub Repository](https://github.com/mrdoob/three.js)
- [Three.js Manual](https://threejs.org/manual/)
