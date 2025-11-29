# Scene and Scene Graph

## Understanding the Scene Graph

The scene graph is a hierarchy of nodes where each node represents a local space. Objects positioned as children are positioned and oriented relative to their parent.

```
Scene
├── Group (Solar System)
│   ├── Mesh (Sun)
│   ├── Group (Earth Orbit)
│   │   ├── Mesh (Earth)
│   │   └── Group (Moon Orbit)
│   │       └── Mesh (Moon)
```

## The Scene Object

```javascript
const scene = new THREE.Scene();

// Set background color
scene.background = new THREE.Color(0xAAAAAA);

// Or use a texture as background
const loader = new THREE.TextureLoader();
scene.background = loader.load('path/to/texture.jpg');
```

## Object3D - The Base Class

`Object3D` is the base class for most objects in Three.js. It provides:
- Position, rotation, and scale
- Parent-child relationships
- Matrix transformations

```javascript
const parent = new THREE.Object3D();
const child = new THREE.Object3D();

parent.add(child);
scene.add(parent);
```

## Transformations

### Position

```javascript
object.position.set(x, y, z);
// Or individually
object.position.x = 5;
object.position.y = 10;
object.position.z = -3;
```

### Rotation

```javascript
// In radians
object.rotation.x = Math.PI / 4;  // 45 degrees
object.rotation.y = Math.PI / 2;  // 90 degrees

// Or use set
object.rotation.set(x, y, z);
```

### Scale

```javascript
object.scale.set(2, 2, 2);  // Double size
object.scale.x = 0.5;        // Half width
```

## Parent-Child Relationships

Children are positioned relative to their parent:

```javascript
const parent = new THREE.Object3D();
parent.position.x = 10;

const child = new THREE.Mesh(geometry, material);
child.position.x = 5;  // Actually at world position x=15

parent.add(child);
scene.add(parent);
```

### Solar System Example

```javascript
// Create an empty Object3D for the solar system
const solarSystem = new THREE.Object3D();
scene.add(solarSystem);

// Sun at the center
const sunMaterial = new THREE.MeshPhongMaterial({ emissive: 0xFFFF00 });
const sunMesh = new THREE.Mesh(sphereGeometry, sunMaterial);
sunMesh.scale.set(5, 5, 5);
solarSystem.add(sunMesh);

// Earth orbit (empty node for rotation)
const earthOrbit = new THREE.Object3D();
earthOrbit.position.x = 10;
solarSystem.add(earthOrbit);

// Earth mesh
const earthMaterial = new THREE.MeshPhongMaterial({ 
  color: 0x2233FF, 
  emissive: 0x112244 
});
const earthMesh = new THREE.Mesh(sphereGeometry, earthMaterial);
earthOrbit.add(earthMesh);

// Moon orbit
const moonOrbit = new THREE.Object3D();
moonOrbit.position.x = 2;
earthOrbit.add(moonOrbit);

// Moon mesh
const moonMaterial = new THREE.MeshPhongMaterial({ 
  color: 0x888888, 
  emissive: 0x222222 
});
const moonMesh = new THREE.Mesh(sphereGeometry, moonMaterial);
moonMesh.scale.set(0.5, 0.5, 0.5);
moonOrbit.add(moonMesh);

// Animate - rotating parents rotates children!
function animate(time) {
  solarSystem.rotation.y = time * 0.5;
  earthOrbit.rotation.y = time * 2;
  moonOrbit.rotation.y = time * 3;
  
  renderer.render(scene, camera);
}
```

## Groups

`Group` is almost identical to `Object3D` but semantically indicates a collection:

```javascript
const group = new THREE.Group();
group.add(mesh1);
group.add(mesh2);
group.add(mesh3);
scene.add(group);

// Transform entire group
group.position.y = 5;
group.rotation.z = Math.PI / 4;
```

## Scene Traversal

### Finding Objects

```javascript
// By name
object.name = 'myCube';
const found = scene.getObjectByName('myCube');

// By property
const found = scene.getObjectByProperty('uuid', someUuid);
```

### Traversing All Objects

```javascript
scene.traverse((object) => {
  console.log(object.name, object.type);
  
  if (object.isMesh) {
    object.castShadow = true;
    object.receiveShadow = true;
  }
});

// Only traverse visible objects
scene.traverseVisible((object) => {
  // ...
});
```

## Dumping the Scene Graph

Useful debugging function:

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
console.log(dumpObject(scene).join('\n'));
```

Output:
```
Scene [Scene]
└─solarSystem [Object3D]
  ├─sunMesh [Mesh]
  └─earthOrbit [Object3D]
    ├─earthMesh [Mesh]
    └─moonOrbit [Object3D]
      └─moonMesh [Mesh]
```

## World vs Local Space

### Getting World Position

```javascript
const worldPosition = new THREE.Vector3();
object.getWorldPosition(worldPosition);
```

### Getting World Quaternion

```javascript
const worldQuaternion = new THREE.Quaternion();
object.getWorldQuaternion(worldQuaternion);
```

### Important: Update Matrix World

After moving objects, you may need to update the world matrix:

```javascript
object.updateMatrixWorld(true);  // Force update of all children
```

## LookAt

Point an object at a position:

```javascript
// Look at a point
object.lookAt(0, 0, 0);

// Look at another object
const target = new THREE.Vector3();
otherObject.getWorldPosition(target);
object.lookAt(target);
```

## Visibility

```javascript
object.visible = false;  // Hide object and all children
```

## Common Patterns

### Vehicle Example (Car with Wheels)

```javascript
const car = new THREE.Object3D();

// Body
const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
car.add(bodyMesh);

// Wheels - children of car
const wheels = [];
const wheelPositions = [
  { x: -1, y: -0.5, z: 1 },
  { x: 1, y: -0.5, z: 1 },
  { x: -1, y: -0.5, z: -1 },
  { x: 1, y: -0.5, z: -1 },
];

wheelPositions.forEach(pos => {
  const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
  wheel.position.set(pos.x, pos.y, pos.z);
  car.add(wheel);
  wheels.push(wheel);
});

scene.add(car);

// Moving the car moves all wheels
car.position.x += 1;

// Rotating wheels independently
wheels.forEach(wheel => {
  wheel.rotation.x += 0.1;
});
```

### Tank with Turret Example

```javascript
const tank = new THREE.Object3D();
scene.add(tank);

// Tank body
const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
tank.add(bodyMesh);

// Turret pivot (so turret can rotate independently)
const turretPivot = new THREE.Object3D();
turretPivot.position.y = 1;  // On top of body
tank.add(turretPivot);

// Turret mesh
const turretMesh = new THREE.Mesh(turretGeometry, turretMaterial);
turretPivot.add(turretMesh);

// Moving tank moves everything
tank.position.x += 1;

// Rotating turret only affects turret
turretPivot.rotation.y = targetAngle;
```

## Helpers

Three.js provides visual helpers for debugging:

### AxesHelper

```javascript
const axesHelper = new THREE.AxesHelper(5);  // Size 5
scene.add(axesHelper);
// Red = X, Green = Y, Blue = Z
```

### GridHelper

```javascript
const gridHelper = new THREE.GridHelper(10, 10);  // Size 10, 10 divisions
scene.add(gridHelper);
```

### Box3Helper

```javascript
const box = new THREE.Box3().setFromObject(mesh);
const helper = new THREE.Box3Helper(box, 0xffff00);
scene.add(helper);
```

## Best Practices

1. **Use Object3D for grouping** - Even if you don't need a mesh, use Object3D to organize transforms

2. **Keep scale at 1** - Scaling causes issues with lighting and physics. Scale your assets in modeling software instead

3. **Use meaningful names** - `object.name = 'player'` helps debugging

4. **Update matrices manually when needed** - After changing transforms outside the render loop, call `updateMatrixWorld()`

5. **Avoid deep hierarchies** - Each level adds matrix multiplication overhead
