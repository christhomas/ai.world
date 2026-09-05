import * as THREE from 'three';
import { buildChunkMesh } from '../world/mesher';
import { addPropInstances, disposeInstances, meshFromData } from '../render/instancing';
import type { PropLibrary } from '../render/props';
import type { DungeonWorld } from './world';

const MAX_TORCH_LIGHTS = 10;

/** Builds and owns the three.js scene for one dungeon visit. */
export class DungeonScene {
  readonly scene = new THREE.Scene();
  readonly heroLight = new THREE.PointLight(0xffc080, 3, 7, 1.6);
  private readonly terrain: THREE.Mesh[] = [];
  private propMeshes: THREE.Object3D[] = [];
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb040 });

  constructor(private readonly world: DungeonWorld, private readonly props: PropLibrary, waterMaterial: THREE.Material, seed: number, opened: Set<string>) {
    // Under a canopy rather than under rock: green light coming through leaves instead of the
    // cold blue of a cave, and a warmer glow from anything burning.
    const wooded = world.style === 'thicket';
    this.scene.background = new THREE.Color(wooded ? 0x0a1408 : 0x05060c);
    this.scene.add(new THREE.AmbientLight(wooded ? 0x35502e : 0x3a4260, 0.8));
    const hemi = new THREE.HemisphereLight(wooded ? 0x4a6a38 : 0x384060, wooded ? 0x1a2214 : 0x14141c, 0.7);
    this.scene.add(hemi);
    this.scene.add(this.heroLight);

    const landMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const per = world.chunksPerSide;
    for (let cz = 0; cz < per; cz++) {
      for (let cx = 0; cx < per; cx++) {
        const chunk = world.chunkData(cx, cz);
        if (chunk.empty) continue;
        const meshes = buildChunkMesh(chunk, seed);
        if (meshes.land) {
          const land = meshFromData(meshes.land, landMat);
          land.castShadow = true;
          land.receiveShadow = true;
          this.scene.add(land);
          this.terrain.push(land);
        }
        if (meshes.water) {
          const water = meshFromData(meshes.water, waterMaterial);
          water.renderOrder = 2;
          this.scene.add(water);
          this.terrain.push(water);
        }
      }
    }
    // a few torches carry real point lights; the rest just glow
    const torches = world.map.torches;
    const step = Math.max(1, Math.ceil(torches.length / MAX_TORCH_LIGHTS));
    for (let i = 0; i < torches.length; i += step) {
      const t = torches[i];
      const light = new THREE.PointLight(0xffa040, 5, 11, 1.5);
      light.position.set(t.x + 0.5 + Math.cos(t.rot) * 0.8, 2.0, t.z + 0.5 - Math.sin(t.rot) * 0.8);
      this.scene.add(light);
    }
    this.rebuildProps(opened);
  }

  /** Instanced torches, stairs and chests; called again when a chest opens. */
  rebuildProps(opened: Set<string>): void {
    for (const m of this.propMeshes) { this.scene.remove(m); disposeInstances(m); }
    this.propMeshes = [];
    const before = this.scene.children.length;
    addPropInstances(this.scene, this.props, this.world.props(opened), this.glowMaterial);
    this.propMeshes = this.scene.children.slice(before);
  }

  dispose(): void {
    for (const t of this.terrain) t.geometry.dispose();
    for (const m of this.propMeshes) disposeInstances(m);
    this.glowMaterial.dispose();
  }
}
