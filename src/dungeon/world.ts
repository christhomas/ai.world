import { WORLD } from '../core/config';
import { Biome, PropKind } from '../world/biomes';
import { TileType, type ChunkData } from '../world/terrain';
import type { TileWorld } from '../entities/entity';
import { DTile, type DungeonMap } from './generate';

/** Dungeon floors sit one terrace up so pools (bed at 0) read as sunk. */
export const DUNGEON_FLOOR_LEVEL = 1;
export const DUNGEON_WALL_LEVEL = 5;
const FLOOR_Y = DUNGEON_FLOOR_LEVEL * WORLD.STEP;
const WALL_Y = DUNGEON_WALL_LEVEL * WORLD.STEP;

/** Walkability + chunk data for one dungeon; the same shape the overworld hands the hero. */
export class DungeonWorld implements TileWorld {
  private readonly chestTiles = new Set<number>();

  constructor(readonly map: DungeonMap, readonly anchorId: string) {
    for (const c of map.chests) this.chestTiles.add(c.z * map.size + c.x);
  }

  tile(x: number, z: number): DTile | null {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.map.size || tz >= this.map.size) return null;
    return this.map.tiles[tz * this.map.size + tx] as DTile;
  }

  heightAt(x: number, z: number): number | null {
    const t = this.tile(x, z);
    return t === DTile.Floor || t === DTile.Stairs ? FLOOR_Y : null;
  }

  waterAt(x: number, z: number): number | null {
    return this.tile(x, z) === DTile.Water ? WORLD.WATER_Y : null;
  }

  blocked(x: number, z: number): boolean {
    return this.chestTiles.has(Math.floor(z) * this.map.size + Math.floor(x));
  }

  isRoad(): boolean { return false; }

  /** Number of chunks per side needed to cover the map. */
  get chunksPerSide(): number { return Math.ceil(this.map.size / WORLD.CHUNK_SIZE); }

  /** Chunk in the mesher's format: rock as high cliffs, floor as cobbles, pools as water. */
  chunkData(cx: number, cz: number): ChunkData {
    const CS = WORLD.CHUNK_SIZE;
    const size = CS + 2;
    const n = size * size;
    const chunk: ChunkData = {
      cx, cz, size,
      height: new Float32Array(n), type: new Uint8Array(n), biome: new Uint8Array(n).fill(Biome.Mountain),
      prop: new Uint8Array(n), propRot: new Float32Array(n).fill(Number.NaN), shore: new Float32Array(n),
      corners: new Float32Array(n * 4), water: new Float32Array(n), empty: true,
    };
    const ox = cx * CS - 1, oz = cz * CS - 1;
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const t = this.tile(ox + lx, oz + lz);
        if (t === null) continue;
        const i = lz * size + lx;
        chunk.empty = false;
        switch (t) {
          case DTile.Rock: chunk.type[i] = TileType.High; chunk.height[i] = WALL_Y; break;
          case DTile.Water: chunk.type[i] = TileType.Water; chunk.height[i] = 0; chunk.water[i] = WORLD.WATER_Y; break;
          default: chunk.type[i] = TileType.Plaza; chunk.height[i] = FLOOR_Y;
        }
      }
    }
    return chunk;
  }

  /** Props with fixed placement: torches on wall faces, stairs at the entrance, chests by state. */
  props(opened: Set<string>): Array<{ kind: PropKind; x: number; y: number; z: number; rot: number }> {
    const out: Array<{ kind: PropKind; x: number; y: number; z: number; rot: number }> = [];
    for (const t of this.map.torches) out.push({ kind: PropKind.Torch, x: t.x + 0.5, y: WALL_Y, z: t.z + 0.5, rot: t.rot });
    out.push({ kind: PropKind.Stairs, x: this.map.entrance[0] + 0.5, y: FLOOR_Y, z: this.map.entrance[1] + 0.5, rot: 0 });
    this.map.chests.forEach((c, i) => {
      out.push({ kind: opened.has(this.chestId(i)) ? PropKind.ChestOpen : PropKind.Chest, x: c.x + 0.5, y: FLOOR_Y, z: c.z + 0.5, rot: 0 });
    });
    return out;
  }

  chestId(i: number): string { return `${this.anchorId}:chest:${i}`; }

  /** Index of an unopened chest within reach, or -1. */
  chestNear(x: number, z: number, range: number, opened: Set<string>): number {
    let best = -1, bestD = range * range;
    this.map.chests.forEach((c, i) => {
      if (opened.has(this.chestId(i))) return;
      const d = (c.x + 0.5 - x) ** 2 + (c.z + 0.5 - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  nearStairs(x: number, z: number, range: number): boolean {
    return Math.hypot(this.map.entrance[0] + 0.5 - x, this.map.entrance[1] + 0.5 - z) < range;
  }
}
