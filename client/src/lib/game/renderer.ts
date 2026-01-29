/**
 * Planet rendering for Encrypted Forest.
 *
 * Creates and updates ThreeJS meshes for planets based on
 * their type, size, and ownership. Handles fog of war by
 * dimming unexplored areas.
 */

import * as THREE from "three";
import { CelestialBodyType } from "@encrypted-forest/core";
import type { PlanetEntry } from "@encrypted-forest/client";

// ---------------------------------------------------------------------------
// Color mapping by celestial body type
// ---------------------------------------------------------------------------

const BODY_COLORS: Record<CelestialBodyType, number> = {
  [CelestialBodyType.Planet]: 0x22cc66,       // Green
  [CelestialBodyType.Quasar]: 0x4488ff,       // Blue
  [CelestialBodyType.SpacetimeRip]: 0xaa44ff,  // Purple
  [CelestialBodyType.AsteroidBelt]: 0xbb8844,  // Brown
};

const BODY_EMISSIVE: Record<CelestialBodyType, number> = {
  [CelestialBodyType.Planet]: 0x115533,
  [CelestialBodyType.Quasar]: 0x224488,
  [CelestialBodyType.SpacetimeRip]: 0x552288,
  [CelestialBodyType.AsteroidBelt]: 0x443322,
};

// ---------------------------------------------------------------------------
// Planet mesh management
// ---------------------------------------------------------------------------

/** Managed planet mesh with metadata */
interface PlanetMesh {
  mesh: THREE.Mesh;
  hashHex: string;
  ringMesh?: THREE.Mesh;
}

/**
 * Manages planet meshes in the scene.
 */
export class PlanetRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, PlanetMesh> = new Map();

  /** Scale factor for coordinates to world space */
  private coordScale: number;

  constructor(scene: THREE.Scene, coordScale: number = 1.0) {
    this.scene = scene;
    this.coordScale = coordScale;
  }

  /**
   * Update the scene with the current set of planets.
   * Adds new planets, updates existing ones, removes missing ones.
   */
  updatePlanets(
    planets: PlanetEntry[],
    playerPubkey?: string
  ): void {
    const currentHashes = new Set<string>();

    for (const entry of planets) {
      currentHashes.add(entry.hashHex);

      if (this.meshes.has(entry.hashHex)) {
        // Update existing
        this.updateExistingMesh(entry, playerPubkey);
      } else {
        // Create new
        this.createPlanetMesh(entry, playerPubkey);
      }
    }

    // Remove meshes that are no longer in the planet list
    for (const [hash, planetMesh] of this.meshes) {
      if (!currentHashes.has(hash)) {
        this.scene.remove(planetMesh.mesh);
        if (planetMesh.ringMesh) {
          this.scene.remove(planetMesh.ringMesh);
        }
        planetMesh.mesh.geometry.dispose();
        (planetMesh.mesh.material as THREE.Material).dispose();
        this.meshes.delete(hash);
      }
    }
  }

  /**
   * Remove all planet meshes.
   */
  clear(): void {
    for (const [, planetMesh] of this.meshes) {
      this.scene.remove(planetMesh.mesh);
      if (planetMesh.ringMesh) {
        this.scene.remove(planetMesh.ringMesh);
      }
      planetMesh.mesh.geometry.dispose();
      (planetMesh.mesh.material as THREE.Material).dispose();
    }
    this.meshes.clear();
  }

  /**
   * Get the mesh for a planet by hash.
   */
  getMesh(hashHex: string): THREE.Mesh | undefined {
    return this.meshes.get(hashHex)?.mesh;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private createPlanetMesh(
    entry: PlanetEntry,
    playerPubkey?: string
  ): void {
    const { discovery, onChain } = entry;
    const bodyType = discovery.properties.bodyType;
    const size = discovery.properties.size;

    // Sphere radius based on size (1-6)
    const radius = 0.3 + size * 0.2;

    const geometry = new THREE.SphereGeometry(radius, 16, 12);
    const material = new THREE.MeshStandardMaterial({
      color: BODY_COLORS[bodyType],
      emissive: BODY_EMISSIVE[bodyType],
      emissiveIntensity: 0.3,
      roughness: 0.7,
      metalness: 0.3,
    });

    // Highlight owned planets
    if (onChain?.owner && playerPubkey) {
      const ownerStr = onChain.owner.toBase58();
      if (ownerStr === playerPubkey) {
        material.emissiveIntensity = 0.6;
        material.wireframe = false;
      }
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      Number(discovery.x) * this.coordScale,
      0,
      Number(discovery.y) * this.coordScale
    );
    mesh.userData = {
      hashHex: entry.hashHex,
      type: "planet",
    };

    this.scene.add(mesh);

    const planetMesh: PlanetMesh = { mesh, hashHex: entry.hashHex };

    // Add ring for asteroid belts
    if (bodyType === CelestialBodyType.AsteroidBelt) {
      const ringGeo = new THREE.RingGeometry(radius + 0.2, radius + 0.5, 32);
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x886644,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(mesh.position);
      this.scene.add(ring);
      planetMesh.ringMesh = ring;
    }

    this.meshes.set(entry.hashHex, planetMesh);
  }

  private updateExistingMesh(
    entry: PlanetEntry,
    playerPubkey?: string
  ): void {
    const planetMesh = this.meshes.get(entry.hashHex);
    if (!planetMesh) return;

    const material = planetMesh.mesh.material as THREE.MeshStandardMaterial;

    // Update ownership highlight
    if (entry.onChain?.owner && playerPubkey) {
      const ownerStr = entry.onChain.owner.toBase58();
      if (ownerStr === playerPubkey) {
        material.emissiveIntensity = 0.6;
      } else {
        material.emissiveIntensity = 0.3;
      }
    } else {
      material.emissiveIntensity = 0.3;
    }
  }
}

/**
 * Create a fog-of-war overlay mesh.
 * This is a large dark plane at ground level that is made
 * transparent at explored coordinates.
 */
export function createFogPlane(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshBasicMaterial({
    color: 0x050510,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.5;

  return mesh;
}
