/**
 * ThreeJS scene setup for Encrypted Forest.
 *
 * Creates the scene, camera, renderer, lights, and the basic
 * star field background. Provides an API for the game canvas
 * component to drive rendering.
 */

import * as THREE from "three";

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Call on each animation frame */
  render(): void;
  /** Call when canvas resizes */
  resize(width: number, height: number): void;
  /** Clean up all resources */
  dispose(): void;
}

/**
 * Create and initialize a ThreeJS scene for the game.
 */
export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x050510, 1);

  // Scene
  const scene = new THREE.Scene();

  // Camera - top-down orthographic-like perspective
  const camera = new THREE.PerspectiveCamera(
    60,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    10000
  );
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);

  // Ambient light
  const ambientLight = new THREE.AmbientLight(0x334466, 0.4);
  scene.add(ambientLight);

  // Directional light (simulating a distant star)
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Point light at center (game center glow)
  const centerLight = new THREE.PointLight(0x6644ff, 1.0, 200);
  centerLight.position.set(0, 5, 0);
  scene.add(centerLight);

  // Star field background
  createStarField(scene);

  // Grid helper for development
  const gridHelper = new THREE.GridHelper(100, 100, 0x222244, 0x111133);
  gridHelper.position.y = -0.1;
  scene.add(gridHelper);

  return {
    scene,
    camera,
    renderer,

    render() {
      renderer.render(scene, camera);
    },

    resize(width: number, height: number) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    },

    dispose() {
      renderer.dispose();
      scene.clear();
    },
  };
}

/**
 * Create a particle star field background.
 */
function createStarField(scene: THREE.Scene): void {
  const starCount = 2000;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * 500;
    positions[i3 + 1] = (Math.random() - 0.5) * 200 + 50;
    positions[i3 + 2] = (Math.random() - 0.5) * 500;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.3,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.6,
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
}
