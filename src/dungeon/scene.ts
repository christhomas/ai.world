import * as THREE from 'three';
import { buildChunkMesh } from '../world/mesher';
import { addPropInstances, disposeInstances, meshFromData } from '../render/instancing';
import type { PropLibrary } from '../render/props';
import type { DungeonWorld } from './world';

const MAX_TORCH_LIGHTS = 10;

/**
 * The air of each sort of place underground: what the sky behind it is, and what light reaches
 * the floor before anything is set alight.
 *
 * Kept as three named sets rather than as nested conditionals because there are three of them now
 * and a fourth would have been unreadable as a chain of ternaries. `strength` is the one number
 * worth arguing about: a barrow at 0.8 is a place you carry a light into, and a keep at 1.05 is a
 * place that has its own.
 */
const UNDER_ROCK = { sky: 0x05060c, ambient: 0x3a4260, above: 0x384060, below: 0x14141c, strength: 0.8 };
const WOODED = { sky: 0x0a1408, ambient: 0x35502e, above: 0x4a6a38, below: 0x1a2214, strength: 0.8 };
const KEEP = { sky: 0x0c0e14, ambient: 0x5a5e70, above: 0x6a7088, below: 0x22242e, strength: 1.05 };

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
    //
    // A castle is the third case and is lit differently again, because it is the only one of these
    // that is above ground. Its windows are arrow slits and its halls are lit by fire, so the
    // ground light is a cold daylight grey rather than a cave's blue, and there is more of it —
    // enough to see the far end of a gallery, which a castle needs and a barrow must not have. Its
    // whole point is that you can tell you are inside a building.
    const air = world.style === 'thicket' ? WOODED : world.style === 'castle' ? KEEP : UNDER_ROCK;
    this.scene.background = new THREE.Color(air.sky);
    this.scene.add(new THREE.AmbientLight(air.ambient, air.strength));
    const hemi = new THREE.HemisphereLight(air.above, air.below, 0.7);
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
