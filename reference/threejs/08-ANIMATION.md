# Animation in Three.js

Three.js provides a robust animation system for animating meshes, bones, materials, and more.

## Animation System Overview

```
AnimationClip (contains keyframe data)
       │
       ▼
AnimationMixer (controls playback)
       │
       ▼
AnimationAction (configures how clip plays)
       │
       ▼
   Mesh/Object (animated target)
```

## Basic Animation (Manual)

### Using the Render Loop

```javascript
function animate(time) {
  time *= 0.001;  // Convert to seconds
  
  // Rotate
  cube.rotation.x = time;
  cube.rotation.y = time * 0.5;
  
  // Move
  cube.position.y = Math.sin(time) * 2;
  
  // Scale
  cube.scale.x = 1 + Math.sin(time) * 0.5;
  
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
```

### Time-Based Animation

```javascript
let previousTime = 0;

function animate(currentTime) {
  currentTime *= 0.001;
  const deltaTime = currentTime - previousTime;
  previousTime = currentTime;
  
  // Move at consistent speed regardless of frame rate
  const speed = 2;  // Units per second
  cube.position.x += speed * deltaTime;
  
  renderer.render(scene, camera);
}
```

### Using Clock

```javascript
const clock = new THREE.Clock();

function animate() {
  const deltaTime = clock.getDelta();  // Time since last call
  const elapsedTime = clock.getElapsedTime();  // Total time
  
  cube.rotation.y = elapsedTime;
  cube.position.x += 2 * deltaTime;
  
  renderer.render(scene, camera);
}
```

## Animation System Components

### AnimationClip

Contains keyframe data for an animation:

```javascript
// Create keyframe tracks
const times = [0, 1, 2];  // Keyframe times in seconds
const values = [0, 0, 0, 0, 5, 0, 0, 0, 0];  // x,y,z positions

const positionTrack = new THREE.VectorKeyframeTrack(
  '.position',  // Property to animate
  times,
  values
);

// Create clip from tracks
const clip = new THREE.AnimationClip(
  'moveUp',  // Name
  2,         // Duration (-1 to auto-calculate)
  [positionTrack]
);
```

### Keyframe Track Types

```javascript
// Vector (position, scale)
new THREE.VectorKeyframeTrack(name, times, values);

// Quaternion (rotation)
new THREE.QuaternionKeyframeTrack(name, times, values);

// Number (opacity, intensity)
new THREE.NumberKeyframeTrack(name, times, values);

// Color
new THREE.ColorKeyframeTrack(name, times, values);

// Boolean (visible)
new THREE.BooleanKeyframeTrack(name, times, values);

// String (for morph targets)
new THREE.StringKeyframeTrack(name, times, values);
```

### AnimationMixer

Controls playback of clips:

```javascript
const mixer = new THREE.AnimationMixer(mesh);

// Update in render loop
function animate() {
  const deltaTime = clock.getDelta();
  mixer.update(deltaTime);
  renderer.render(scene, camera);
}
```

### AnimationAction

Configures how a clip plays:

```javascript
const action = mixer.clipAction(clip);

// Playback control
action.play();
action.stop();
action.reset();
action.paused = true;

// Timing
action.time = 0.5;           // Current time in clip
action.timeScale = 2;        // Speed (2 = double speed)
action.setDuration(3);       // Stretch clip to 3 seconds

// Loop modes
action.loop = THREE.LoopOnce;      // Play once
action.loop = THREE.LoopRepeat;    // Loop forever
action.loop = THREE.LoopPingPong;  // Loop back and forth
action.repetitions = 3;            // Loop count

// Blending
action.weight = 1;           // 0-1, for blending multiple animations
action.setEffectiveWeight(1);
action.fadeIn(0.5);          // Fade in over 0.5 seconds
action.fadeOut(0.5);         // Fade out
action.crossFadeFrom(otherAction, 0.5);  // Transition

// Clamping
action.clampWhenFinished = true;  // Hold final pose
```

## Loading Animated Models

Most animations come from 3D files (GLTF, FBX, etc.):

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

loader.load('model.gltf', (gltf) => {
  const model = gltf.scene;
  scene.add(model);
  
  // Setup animation
  const mixer = new THREE.AnimationMixer(model);
  
  // gltf.animations is an array of AnimationClips
  console.log('Animations:', gltf.animations.map(a => a.name));
  
  // Play all animations
  gltf.animations.forEach((clip) => {
    mixer.clipAction(clip).play();
  });
  
  // Or play specific animation by name
  const clip = THREE.AnimationClip.findByName(
    gltf.animations, 
    'walk'
  );
  if (clip) {
    mixer.clipAction(clip).play();
  }
});
```

## Morph Targets (Shape Keys)

Blend between different mesh shapes:

```javascript
// Access morph target influences
mesh.morphTargetInfluences[0] = 0.5;  // 50% blend

// If mesh has morph target dictionary
mesh.morphTargetDictionary;  // { 'smile': 0, 'frown': 1 }
mesh.morphTargetInfluences[mesh.morphTargetDictionary['smile']] = 1;

// Animate morph targets
const morphTrack = new THREE.NumberKeyframeTrack(
  '.morphTargetInfluences[0]',
  [0, 1, 2],        // times
  [0, 1, 0]         // values
);
```

## Skinned Meshes (Skeletal Animation)

Bones deform the mesh:

```javascript
// Access skeleton
const skeleton = skinnedMesh.skeleton;
const bones = skeleton.bones;

// Animate specific bone
const headBone = bones.find(b => b.name === 'head');
headBone.rotation.y = Math.sin(time);

// Skeleton helper for debugging
const helper = new THREE.SkeletonHelper(skinnedMesh);
scene.add(helper);
```

## Animation Events

```javascript
mixer.addEventListener('finished', (event) => {
  console.log('Animation finished:', event.action.getClip().name);
});

mixer.addEventListener('loop', (event) => {
  console.log('Animation looped');
});
```

## Blending Animations

Smoothly transition between animations:

```javascript
let currentAction = idleAction;
currentAction.play();

function switchAnimation(newAction, duration = 0.5) {
  if (currentAction === newAction) return;
  
  newAction.reset();
  newAction.setEffectiveTimeScale(1);
  newAction.setEffectiveWeight(1);
  newAction.fadeIn(duration);
  
  currentAction.fadeOut(duration);
  
  currentAction = newAction;
  newAction.play();
}

// Usage
switchAnimation(walkAction);
```

## Animation Utilities

### Finding Clips

```javascript
// By name
const clip = THREE.AnimationClip.findByName(clips, 'walk');

// Create from morph target sequence
const clip = THREE.AnimationClip.CreateFromMorphTargetSequence(
  'expression',
  mesh.morphTargetDictionary,
  30  // fps
);

// Create clips from bones
const clip = THREE.AnimationClip.CreateClipsFromMorphTargetSequences(
  morphTargets,
  30
);
```

### Modifying Clips

```javascript
// Trim clip
const subClip = THREE.AnimationUtils.subclip(
  originalClip,
  'newName',
  startFrame,
  endFrame,
  fps
);

// Merge clips
const mergedClip = THREE.AnimationUtils.makeClipAdditive(clip);
```

## Custom Keyframe Animation Example

```javascript
// Create a bouncing animation
function createBounceAnimation() {
  const times = [0, 0.5, 1];
  const positions = [
    0, 0, 0,    // Start
    0, 2, 0,    // Up
    0, 0, 0     // Back down
  ];
  
  const positionTrack = new THREE.VectorKeyframeTrack(
    '.position',
    times,
    positions,
    THREE.InterpolateSmooth  // Smooth interpolation
  );
  
  return new THREE.AnimationClip('bounce', 1, [positionTrack]);
}

const bounceClip = createBounceAnimation();
const action = mixer.clipAction(bounceClip);
action.loop = THREE.LoopRepeat;
action.play();
```

## Interpolation Modes

```javascript
// Track interpolation
const track = new THREE.VectorKeyframeTrack(
  '.position',
  times,
  values,
  THREE.InterpolateLinear    // Linear (default)
  // THREE.InterpolateSmooth  // Catmull-Rom spline
  // THREE.InterpolateDiscrete // No interpolation
);

// Can also set per-track
track.setInterpolation(THREE.InterpolateSmooth);
```

## Performance Tips

1. **Reuse AnimationActions** - Don't create new actions for the same clip
2. **Use `action.stop()`** - Stop unused animations
3. **Limit active animations** - Blend weight 0 animations still cost
4. **Use simpler rigs** - Fewer bones = better performance
5. **Consider LOD** - Use simpler animations for distant objects

## Complete Animation Example

```javascript
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clock = new THREE.Clock();
let mixer;
let actions = {};

// Load animated model
const loader = new GLTFLoader();
loader.load('character.gltf', (gltf) => {
  const model = gltf.scene;
  scene.add(model);
  
  mixer = new THREE.AnimationMixer(model);
  
  // Create actions for all clips
  gltf.animations.forEach((clip) => {
    actions[clip.name] = mixer.clipAction(clip);
  });
  
  // Start with idle
  actions.idle?.play();
});

// Animation state machine
let currentAction = 'idle';

function setAnimation(name, fadeTime = 0.5) {
  if (currentAction === name || !actions[name]) return;
  
  const prevAction = actions[currentAction];
  const nextAction = actions[name];
  
  prevAction?.fadeOut(fadeTime);
  nextAction?.reset().fadeIn(fadeTime).play();
  
  currentAction = name;
}

// Render loop
function animate() {
  const delta = clock.getDelta();
  
  if (mixer) {
    mixer.update(delta);
  }
  
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// Control animations
document.addEventListener('keydown', (e) => {
  if (e.key === 'w') setAnimation('walk');
  if (e.key === ' ') setAnimation('jump');
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'w') setAnimation('idle');
});
```
