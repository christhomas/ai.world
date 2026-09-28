import * as THREE from 'three';
import { buildChunkMesh, type WallCut } from '../world/mesher';
import { addPropInstances, disposeInstances } from './instancing';
import type { PropLibrary } from './props';
import type { DungeonWorld } from '../dungeon/world';
import { SceneGraph } from '../core/scenegraph';
import { mountSceneGraph } from './scenegraph';

const MAX_TORCH_LIGHTS = 10;

/**
 * What the walls of each sort of place are made of.
 *
 * A castle is built, so its walls are coursed masonry. A cave and a mine are dug, so theirs are
 * hewn rock — the same subdivision, twice the spread of shade and no courses, because what you are
 * looking at is where a pick went rather than where a mason laid.
 *
 * A thicket has no walls in this sense: what stands round you in one is trees and thorn, drawn as
 * props, and the ground between them is ordinary country. Cutting blocks into it would put
 * stonework along the edge of a hedge.
 */
function wallsOf(style: DungeonWorld['style']): WallCut | undefined {
  if (style === 'thicket') return undefined;
  return style === 'castle' ? 'stone' : 'hewn';
}

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
/*
 * And a cavern under the sea, which is the one of these that has light coming *in*.
 *
 * Green rather than blue, and brighter overhead than underfoot by more than any of the others: what
 * light there is has come down through fathoms of water, so it arrives from above, cold, and with
 * the red taken out of it. Dimmer overall than a barrow — you are further from the sun than
 * anywhere else in the game.
 */
const DROWNED = { sky: 0x03131a, ambient: 0x2c5a5e, above: 0x3f8a8a, below: 0x0a1c22, strength: 0.75 };

/** Builds and owns the three.js scene for one dungeon visit. */
export class DungeonScene {
  readonly graph: SceneGraph;
  readonly scene: THREE.Scene;
  readonly heroLight = new THREE.PointLight(0xffc080, 3, 7, 1.6);
  private readonly mounted: ReturnType<typeof mountSceneGraph>;
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
    const air = world.style === 'thicket' ? WOODED
      : world.style === 'castle' ? KEEP
        : world.style === 'sunken' ? DROWNED : UNDER_ROCK;
    this.graph = new SceneGraph(air.sky);
    this.graph.add({ kind: 'ambient', colour: air.ambient, intensity: air.strength });
    this.graph.add({ kind: 'hemisphere', sky: air.above, ground: air.below, intensity: 0.7 });

    const per = world.chunksPerSide;
    for (let cz = 0; cz < per; cz++) {
      for (let cx = 0; cx < per; cx++) {
        const chunk = world.chunkData(cx, cz);
        if (chunk.empty) continue;
        const meshes = buildChunkMesh(chunk, seed, wallsOf(world.style));
        if (meshes.land) {
          this.graph.add({
            kind: 'mesh', geometry: meshes.land, material: 'lit-vertex-colours',
            castShadow: true, receiveShadow: true,
          });
        }
        if (meshes.water) {
          this.graph.add({
            kind: 'mesh', geometry: meshes.water, material: 'water',
            receiveShadow: false, renderOrder: 2,
          });
        }
      }
    }
    // a few torches carry real point lights; the rest just glow
    const torches = world.map.torches;
    const step = Math.max(1, Math.ceil(torches.length / MAX_TORCH_LIGHTS));
    for (let i = 0; i < torches.length; i += step) {
      const t = torches[i];
      this.graph.add({
        kind: 'point', colour: 0xffa040, intensity: 5, distance: 11, decay: 1.5,
        position: [t.x + 0.5 + Math.cos(t.rot) * 0.8, 2.0, t.z + 0.5 - Math.sin(t.rot) * 0.8],
      });
    }
    this.mounted = mountSceneGraph(this.graph, waterMaterial);
    this.scene = this.mounted.scene;
    this.scene.add(this.heroLight);
    this.rebuildProps(opened);
  }

  /** Instanced torches, stairs and chests; called again when a chest opens. */
  rebuildProps(opened: Set<string>): void {
    for (const m of this.propMeshes) { this.scene.remove(m); disposeInstances(m); }
    this.propMeshes = [];
    const before = this.scene.children.length;
    addPropInstances(this.scene, this.props, this.world.props(opened), this.glowMaterial, true, this.graph);
    this.propMeshes = this.scene.children.slice(before);
  }

  dispose(): void {
    this.mounted.dispose();
    for (const m of this.propMeshes) disposeInstances(m);
    this.glowMaterial.dispose();
  }
}
