import { PlaneGeometry, Color, BufferAttribute, type BufferGeometry } from 'three';
import { SceneGraph, type SceneGeometry, type SceneNode } from '../core/scenegraph';
import { WORLD } from '../core/config';
import { fogReach } from './scene-math';

export interface SceneLighting {
  sun: Extract<SceneNode, { kind: 'directional' }>;
  hemi: Extract<SceneNode, { kind: 'hemisphere' }>;
  ambient: Extract<SceneNode, { kind: 'ambient' }>;
  lantern: Extract<SceneNode, { kind: 'point' }>;
}
const translated = (x: number, y: number, z: number): number[] =>
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** CPU geometry, retained by the graph; no renderer, canvas or GPU resource is constructed. */
function surfaceGeometry(geometry: BufferGeometry): SceneGeometry {
  const data = {
    positions: geometry.getAttribute('position').array as Float32Array,
    normals: geometry.getAttribute('normal').array as Float32Array,
    colors: geometry.getAttribute('color')?.array as Float32Array | undefined,
    flow: geometry.getAttribute('flow')?.array as Float32Array | undefined,
    sea: geometry.getAttribute('sea')?.array as Float32Array | undefined,
    indices: geometry.index?.array as Uint16Array | Uint32Array | undefined,
  };
  geometry.dispose();
  return data;
}

/** The production surface's initial water, lights and fog, independently of its host mount. */
export class SceneState {
  readonly graph = new SceneGraph(0x8fc1e6);
  readonly lighting: SceneLighting = {
    ambient: this.graph.add({ kind: 'ambient', colour: 0xc9dcff, intensity: 0.45 }) as SceneLighting['ambient'],
    hemi: this.graph.add({ kind: 'hemisphere', sky: 0xcfe6ff, ground: 0x6f8f4f, intensity: 1 }) as SceneLighting['hemi'],
    sun: this.graph.add({ kind: 'directional', colour: 0xfff3dc, intensity: 2.6,
      position: [38, 72, 22], target: [0, 0, 0], castShadow: true }) as SceneLighting['sun'],
    lantern: this.graph.add({ kind: 'point', colour: 0xffb060, intensity: 0, distance: 9, decay: 1.6,
      position: [0, 0, 0] }) as SceneLighting['lantern'],
  };
  readonly waterNode: Extract<SceneNode, { kind: 'mesh' }>;
  readonly deepNode: Extract<SceneNode, { kind: 'mesh' }>;
  private disposed = false;

  constructor() {
    this.graph.fog = { colour: this.graph.background, ...fogReach() };
    const sea = new PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2);
    const colour = new Color(0x2f86bf), count = sea.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = colour.r; colors[i * 3 + 1] = colour.g; colors[i * 3 + 2] = colour.b; }
    sea.setAttribute('color', new BufferAttribute(colors, 3));
    sea.setAttribute('flow', new BufferAttribute(new Float32Array(count), 1));
    sea.setAttribute('sea', new BufferAttribute(new Float32Array(count).fill(1), 1));
    this.waterNode = { kind: 'mesh', geometry: surfaceGeometry(sea), material: 'water',
      receiveShadow: false, renderOrder: 1, world: translated(0, WORLD.WATER_Y, 0) };
    this.deepNode = { kind: 'mesh', geometry: surfaceGeometry(new PlaneGeometry(900, 900).rotateX(-Math.PI / 2)),
      material: 'lit-solid', colour: 0x1d4f78, receiveShadow: true, world: translated(0, -0.03, 0) };
    this.graph.add(this.waterNode); this.graph.add(this.deepNode);
  }

  followWater(x: number, z: number): void {
    if (this.disposed) return;
    this.waterNode.world = translated(x, WORLD.WATER_Y, z);
    this.deepNode.world = translated(x, -0.03, z);
  }

  updateWater(time: number): void { if (!this.disposed) this.graph.renderTimeMs = time * 1000; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of [...this.graph.nodes]) this.graph.remove(node);
  }
}
