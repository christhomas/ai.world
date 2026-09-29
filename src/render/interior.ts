import * as THREE from 'three';
import { WORLD } from '../core/config';
import { hexToLinear } from '../world/mesher';
import type { PropLibrary } from './props';
import { addPropInstances, disposeInstances } from './instancing';
import { ITile, type InteriorMap } from '../interior/generate';
import { FLOOR_Y, WALL_HEIGHT } from '../interior/world';
import { SceneGraph, type SceneGeometry } from '../core/scenegraph';
import { mountSceneGraph } from './scenegraph';

interface Palette { floor: number; floorAlt: number; wall: number; wallTop: number; counter: number; rug: number; light: number }

/** Counters stand this far above the floor: waist height, not a wall. */
const COUNTER_HEIGHT = 0.4;

const PALETTES: Record<string, Palette> = {
  house: { floor: 0xc09a68, floorAlt: 0xb08d5f, wall: 0xe8dcc0, wallTop: 0x8a6a4a, counter: 0x8a6a3d, rug: 0x8a3a3a, light: 0xffd9a0 },
  store: { floor: 0xc0a070, floorAlt: 0xb39566, wall: 0xe4d6b4, wallTop: 0x8a6a4a, counter: 0x8a6a3d, rug: 0x8a3a3a, light: 0xffe0b0 },
  smith: { floor: 0x9a9a9a, floorAlt: 0x8d8d8d, wall: 0x9a9a92, wallTop: 0x6e6e6e, counter: 0x6b4a2b, rug: 0x6a3a2a, light: 0xffb070 },
  inn: { floor: 0xb8865a, floorAlt: 0xa8794a, wall: 0xe0cfa8, wallTop: 0x7a5a3a, counter: 0x8a6a3d, rug: 0x8a3a3a, light: 0xffcf8a },
  apothecary: { floor: 0xa89a78, floorAlt: 0x9c8f6f, wall: 0xdcd8bc, wallTop: 0x7a7458, counter: 0x8a6a3d, rug: 0x5a7a4a, light: 0xd6ffcf },
  church: { floor: 0xcfc9b4, floorAlt: 0xc4bda8, wall: 0xe8e4d4, wallTop: 0x9a9484, counter: 0xd8d2c0, rug: 0x8a3a5a, light: 0xfff0c8 },
  // a hall is boards and panelling with a red carpet up the middle of it, and a watch house is
  // stone, kept colder than anywhere else you can walk into
  townhall: { floor: 0xb08d5f, floorAlt: 0xa48252, wall: 0xdccfae, wallTop: 0x6e5436, counter: 0x6b4a2b, rug: 0x8a2f2f, light: 0xffe3b0 },
  watchhouse: { floor: 0x8f8f8f, floorAlt: 0x848484, wall: 0xa8a49a, wallTop: 0x5e5e5e, counter: 0x5a4632, rug: 0x4a5a6a, light: 0xd0e0ff },
};

/** Builds the room: a floor, four walls seen from above, and the furniture in it. */
export class InteriorScene {
  readonly graph: SceneGraph;
  readonly scene: THREE.Scene;
  private readonly mounted: ReturnType<typeof mountSceneGraph>;
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffc060 });

  constructor(map: InteriorMap, props: PropLibrary) {
    const pal = PALETTES[map.kind] ?? PALETTES.house;
    this.graph = new SceneGraph(0x0d1018);
    this.graph.add({ kind: 'ambient', colour: 0xffe9cc, intensity: 1.35 });
    this.graph.add({ kind: 'hemisphere', sky: 0xfff0d8, ground: 0x4a3a2a, intensity: 0.9 });
    this.graph.add({
      kind: 'point', colour: pal.light, intensity: 14,
      distance: Math.max(map.w, map.h) * 1.6, decay: 1.4,
      position: [map.w / 2, 4.5, map.h / 2],
    });
    this.graph.add({ kind: 'mesh', geometry: buildRoom(map, pal), material: 'lit-vertex-colours', receiveShadow: true });
    this.mounted = mountSceneGraph(this.graph);
    this.scene = this.mounted.scene;

    addPropInstances(
      this.scene, props,
      map.furniture.map((f) => ({ kind: f.kind, x: f.x + 0.5, y: FLOOR_Y, z: f.z + 0.5, rot: f.rot })),
      this.glowMaterial,
      true,
      this.graph,
    );
  }

  dispose(): void {
    disposeInstances(this.scene);
    this.mounted.dispose();
    this.glowMaterial.dispose();
  }
}

/** One mesh for the whole room: floor quads, wall tops, and inward-facing wall faces. */
function buildRoom(map: InteriorMap, pal: Palette): SceneGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const push = (p: number[][], n: number[], hex: number) => {
    const [r, g, b] = hexToLinear(hex);
    const tri = (a: number[], c: number[], d: number[]) => {
      for (const v of [a, c, d]) { positions.push(v[0], v[1], v[2]); normals.push(n[0], n[1], n[2]); colors.push(r, g, b); }
    };
    tri(p[0], p[1], p[2]);
    tri(p[0], p[2], p[3]);
  };
  const wallY = FLOOR_Y + WALL_HEIGHT * WORLD.STEP;

  for (let z = 0; z < map.h; z++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[z * map.w + x] as ITile;
      if (t === ITile.Wall) {
        // wall tops, plus the inward face so the room has visible sides
        push([[x, wallY, z], [x, wallY, z + 1], [x + 1, wallY, z + 1], [x + 1, wallY, z]], [0, 1, 0], pal.wallTop);
        const faces: Array<[number[][], number[]]> = [
          [[[x, FLOOR_Y, z + 1], [x + 1, FLOOR_Y, z + 1], [x + 1, wallY, z + 1], [x, wallY, z + 1]], [0, 0, 1]],
          [[[x + 1, FLOOR_Y, z], [x, FLOOR_Y, z], [x, wallY, z], [x + 1, wallY, z]], [0, 0, -1]],
          [[[x + 1, FLOOR_Y, z + 1], [x + 1, FLOOR_Y, z], [x + 1, wallY, z], [x + 1, wallY, z + 1]], [1, 0, 0]],
          [[[x, FLOOR_Y, z], [x, FLOOR_Y, z + 1], [x, wallY, z + 1], [x, wallY, z]], [-1, 0, 0]],
        ];
        const neighbour = (dx: number, dz: number) => {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= map.w || nz >= map.h) return ITile.Wall;
          return map.tiles[nz * map.w + nx] as ITile;
        };
        const dirs: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        faces.forEach(([quad, n], i) => {
          if (neighbour(dirs[i][0], dirs[i][1]) !== ITile.Wall) push(quad, n, pal.wall);
        });
        continue;
      }
      const hex = t === ITile.Counter ? pal.counter
        : t === ITile.Rug ? pal.rug
        : t === ITile.Door ? pal.floorAlt
        : (x + z) % 2 === 0 ? pal.floor : pal.floorAlt;
      const y = t === ITile.Counter ? FLOOR_Y + COUNTER_HEIGHT : FLOOR_Y;
      push([[x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z]], [0, 1, 0], hex);
      if (t === ITile.Counter) {
        // a low front so the counter reads as a solid block, not a painted tile
        push([[x, FLOOR_Y, z + 1], [x + 1, FLOOR_Y, z + 1], [x + 1, y, z + 1], [x, y, z + 1]], [0, 0, 1], pal.counter);
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
  };
}
