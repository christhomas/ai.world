import { WORLD } from '../core/config';
import { despeckle } from './despeckle';
import { rollProp } from './props';
import { stampStructure } from './stamp';
import { TileType, type ChunkData, type SampleGrid, type TileSample } from './ground';
import type { Ranges } from './ranges';
import type { Structure, Structures } from './structures';

/**
 * Building one square of country out of many samples of it.
 *
 * Split from `terrain.ts` when that file reached the seven hundred lines `architecture.test.ts`
 * allows — twice in one evening, and the second time was nearly paid for in whitespace rather than
 * in an extraction, which is what #306 was filed to stop.
 *
 * It is a good seam rather than a convenient one, and the shape of the two halves says why. A
 * sampler answers about a **point**: what is the ground doing at this x and this z. Assembling a
 * **square** is a different job — an apron two tiles wider than the output so every tile has its
 * eight neighbours for the de-speckle filter, a pass that turns samples into the flat arrays a
 * mesher can read, and the buildings stamped on afterwards. Nothing in here has to know how a river
 * cuts or where a road wanders; everything in here has to know how the arrays are laid out.
 */

/**
 * What building a square needs to ask of the country it is a square of.
 *
 * Deliberately small, and `TerrainSampler` is the only thing that satisfies it today. The point is
 * not to have two of them — it is that the list is short enough to read, so what a chunk actually
 * depends on is a paragraph rather than a class.
 */
export interface Terrain {
  readonly seed: number;
  /** The mountains standing on it, which decide what can grow under one. Null where there are none. */
  readonly ranges: Ranges | null;
  readonly structures: Structures;
  /** How many storeys the houses of each village have. See `TerrainSampler.storeys`. */
  readonly storeys: ReadonlyMap<string, number>;
  /** Somewhere to put one tile's answer, reused down the whole grid rather than allocated per tile. */
  newSample(): TileSample;
  sampleTile(tx: number, tz: number, out: TileSample, cands?: number[], riverCands?: number[]): void;
  /** The roads and rivers a box has to be sampled against. No roads means open sea. */
  near(x0: number, z0: number, x1: number, z1: number): { roads: number[]; rivers: number[] };
  /** And what is built on it, asked later and only of a square that turned out to have ground. */
  builtOn(x0: number, z0: number, x1: number, z1: number): number[];
}

/**
 * Raw samples for the chunk plus a two-tile apron, so every output tile (including the mesher's
 * one-tile apron) has all eight neighbours available for the de-speckle filter. Null if the whole
 * area is open sea.
 */
function sampleGrid(terrain: Terrain, cx: number, cz: number): SampleGrid | null {
  const CS = WORLD.CHUNK_SIZE;
  const G = CS + 4;
  const x0 = cx * CS - 2, z0 = cz * CS - 2;
  const { roads, rivers } = terrain.near(x0, z0, x0 + G, z0 + G);
  if (roads.length === 0) return null;
  const n = G * G;
  const grid: SampleGrid = {
    G, x0, z0,
    type: new Uint8Array(n), biome: new Uint8Array(n), bank: new Uint8Array(n),
    level: new Float32Array(n), height: new Float32Array(n), water: new Float32Array(n), shore: new Float32Array(n),
    roadDist: new Float32Array(n), roadWidth: new Float32Array(n), base: new Int16Array(n),
    corners: new Float32Array(n * 4), sloped: new Uint8Array(n),
  };
  const s = terrain.newSample();
  for (let gz = 0; gz < G; gz++) {
    for (let gx = 0; gx < G; gx++) {
      const gi = gz * G + gx;
      terrain.sampleTile(x0 + gx, z0 + gz, s, roads, rivers);
      grid.type[gi] = s.type;
      if (s.type === TileType.Skip) continue;
      grid.biome[gi] = s.biome; grid.bank[gi] = s.bank ? 1 : 0;
      grid.level[gi] = s.level; grid.height[gi] = s.height; grid.water[gi] = s.water; grid.shore[gi] = s.shore;
      grid.roadDist[gi] = s.roadDist; grid.roadWidth[gi] = s.roadWidth; grid.base[gi] = s.base;
      grid.corners.set(s.corners, gi * 4);
      grid.sloped[gi] = s.sloped ? 1 : 0;
    }
  }
  return grid;
}

/**
 * Which of this world's villages a building belongs to, by standing in it.
 *
 * This looks like a question for `world/around.ts` and is not, which is worth saying because the
 * next person to read it will reach for the seam. A sampler answers for its own square of country:
 * in a patchwork the house being stamped was founded by *this* sampler, out of towns this sampler
 * placed, so the list below is already the bounded one. Asking the patchwork would have a patch
 * reaching up into the thing that holds it to find out about itself.
 */
function villageHolding(terrain: Terrain, s: Structure): string {
  for (const v of terrain.structures.villages) {
    if (Math.hypot(v.x - s.tx, v.z - s.tz) <= v.radius) return v.name;
  }
  return '';
}

function stampStructures(terrain: Terrain, chunk: ChunkData, ox: number, oz: number): void {
  for (const si of terrain.builtOn(ox, oz, ox + chunk.size, oz + chunk.size)) {
    const s = terrain.structures.all[si];
    // a house is as tall as the village it stands in has managed to become
    stampStructure(chunk, ox, oz, s, terrain.storeys.get(villageHolding(terrain, s)) ?? 1);
  }
}

/** One square of country, as the arrays a mesher and a collider read. */
export function chunkOf(terrain: Terrain, cx: number, cz: number): ChunkData {
  const CS = WORLD.CHUNK_SIZE;
  const size = CS + 2;
  const n = size * size;
  const chunk: ChunkData = {
    cx, cz, size,
    height: new Float32Array(n),
    type: new Uint8Array(n),
    biome: new Uint8Array(n),
    prop: new Uint8Array(n),
    propRot: new Float32Array(n).fill(Number.NaN),
    shore: new Float32Array(n),
    corners: new Float32Array(n * 4),
    sloped: new Uint8Array(n),
    water: new Float32Array(n),
    empty: true,
  };
  const grid = sampleGrid(terrain, cx, cz);
  if (!grid) return chunk;

  let drawn = 0;
  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) {
      // output tile (lx,lz) is grid tile (lx+1, lz+1): the grid carries one extra ring for the filter
      const gi = (lz + 1) * grid.G + (lx + 1);
      const idx = lz * size + lx;
      if (grid.type[gi] === TileType.Skip) continue;
      drawn++;
      const { type, level } = despeckle(grid, gi, terrain.seed);
      chunk.type[idx] = type;
      chunk.biome[idx] = grid.biome[gi];
      chunk.water[idx] = grid.water[gi];
      chunk.shore[idx] = grid.shore[gi];
      if (type === TileType.Road || type === TileType.Bridge) {
        chunk.height[idx] = grid.height[gi];
        chunk.corners.set(grid.corners.subarray(gi * 4, gi * 4 + 4), idx * 4);
        continue;
      }
      if (grid.sloped[gi] === 1) {
        // a mountain face is taken exactly as it was cut, corners and all. The de-speckle filter
        // works in whole terraces and has nothing to say about a surface that has none.
        chunk.sloped[idx] = 1;
        chunk.height[idx] = grid.height[gi];
        chunk.corners.set(grid.corners.subarray(gi * 4, gi * 4 + 4), idx * 4);
      } else {
        chunk.height[idx] = level * WORLD.STEP;
        chunk.corners.fill(level * WORLD.STEP, idx * 4, idx * 4 + 4);
      }
      if (type !== TileType.Seabed) chunk.prop[idx] = rollProp(grid, gi, type, terrain.seed, terrain.ranges);
    }
  }

  chunk.empty = drawn === 0;
  if (!chunk.empty) stampStructures(terrain, chunk, cx * CS - 1, cz * CS - 1);
  return chunk;
}
