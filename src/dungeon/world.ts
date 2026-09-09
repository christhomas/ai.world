import { WORLD } from '../core/config';
import { Biome, PropKind } from '../world/biomes';
import { TileType, type ChunkData } from '../world/terrain';
import type { TileWorld } from '../entities/entity';
import { BASE_LEVEL, DTile, levelAt, type DungeonMap } from './map';

/**
 * How high the rock stands over the floor.
 *
 * The floor itself is `BASE_LEVEL` in `map.ts` — one terrace up, so a pool cut to nought reads as
 * sunk rather than painted on — and everything a castle raises is measured from there. Five is
 * chosen against the isometric camera: enough that a wall is a wall, not so much that the room
 * you are standing in is hidden behind the one in front of it.
 */
const DUNGEON_WALL_LEVEL = 5;
const WALL_Y = DUNGEON_WALL_LEVEL * WORLD.STEP;

/** Walkability + chunk data for one dungeon; the same shape the overworld hands the hero. */
export class DungeonWorld implements TileWorld {
  private readonly chestTiles = new Set<number>();
  private readonly doorTiles = new Set<number>();
  /** Set once the hero finds the key; doors then open. */
  unlocked = false;

  constructor(readonly map: DungeonMap, readonly anchorId: string, readonly style: 'vault' | 'cave' | 'thicket' | 'castle' = 'cave') {
    for (const c of map.chests) this.chestTiles.add(c.z * map.size + c.x);
    for (const d of map.doors) this.doorTiles.add(d.z * map.size + d.x);
  }

  tile(x: number, z: number): DTile | null {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.map.size || tz >= this.map.size) return null;
    return this.map.tiles[tz * this.map.size + tx] as DTile;
  }

  heightAt(x: number, z: number): number | null {
    const t = this.tile(x, z);
    if (t === null) return null;
    if (t === DTile.Door) return this.unlocked ? this.surface(x, z) : null;
    return t === DTile.Floor || t === DTile.Stairs || t === DTile.Descent ? this.surface(x, z) : null;
  }

  /**
   * How high the floor is at a tile.
   *
   * A hole in the ground is all one depth and this is one terrace everywhere in it. A castle is
   * not: it has daises you step up onto and galleries you cannot, and the difference between the
   * two is measured against the walker's own `climb` by `canStand` in `entities/entity.ts`. Which
   * is to say the balcony in the great hall is out of reach for the same reason a terrace on a
   * mountain is, and no code anywhere had to learn what a balcony is.
   */
  private surface(x: number, z: number): number {
    return levelAt(this.map, Math.floor(x), Math.floor(z)) * WORLD.STEP;
  }

  /** Standing on the stairs down? */
  nearDescent(x: number, z: number, range: number): boolean {
    const d = this.map.descent;
    return d !== null && Math.hypot(d[0] + 0.5 - x, d[1] + 0.5 - z) < range;
  }

  /** Is (x,z) a still-locked door? Used to explain why the way is barred. */
  lockedDoorAt(x: number, z: number, range: number): boolean {
    if (this.unlocked) return false;
    for (const d of this.map.doors) if (Math.hypot(d.x + 0.5 - x, d.z + 0.5 - z) < range) return true;
    return false;
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

  /**
   * Chunk in the mesher's format: rock as high cliffs, floor as cobbles, pools as water.
   *
   * The four corner heights matter and are not decoration. `buildChunkMesh` cuts every quad from
   * `corners` and never looks at `height` at all, and this file was setting `height` and nothing
   * else. The result was a dungeon whose every vertex sat at y nought: the walls were still there
   * to walk into, the minimap still drew them, and there was simply no rock standing up anywhere
   * in any hole in the ground. Measured rather than guessed at — meshing a vault off `main` gives
   * every land vertex a y of exactly nought, and off this branch a span from nought to `WALL_Y`;
   * `world.test.ts` is that measurement kept. Filling both is the whole fix, and the two are worth
   * keeping in step rather than dropping `height`, because a chunk is a record other things read.
   */
  chunkData(cx: number, cz: number): ChunkData {
    const CS = WORLD.CHUNK_SIZE;
    const size = CS + 2;
    const n = size * size;
    const chunk: ChunkData = {
      cx, cz, size,
      height: new Float32Array(n), type: new Uint8Array(n), // a thicket is wood the whole way through, so it takes the forest's colours; everything
      // else underground is rock
      biome: new Uint8Array(n).fill(this.style === 'thicket' ? Biome.Forest : Biome.Mountain),
      prop: new Uint8Array(n), propRot: new Float32Array(n).fill(Number.NaN), shore: new Float32Array(n),
      corners: new Float32Array(n * 4),
      sloped: new Uint8Array(n), water: new Float32Array(n), empty: true,
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
          default: chunk.type[i] = TileType.Plaza; chunk.height[i] = this.surface(ox + lx, oz + lz);
        }
        // flat tiles, so all four corners are the tile's own height: a terrace stays a terrace
        for (let k = 0; k < 4; k++) chunk.corners[i * 4 + k] = chunk.height[i];
      }
    }
    return chunk;
  }

  /**
   * Props with fixed placement: torches on wall faces, stairs at the entrance, chests by state,
   * and whatever the generator chose to stand in the rooms.
   *
   * Everything but a wall torch is set down at the height of the tile it is on rather than at
   * the floor's base, because a castle's floor is not all one height and a chest on a balcony
   * three terraces up would otherwise be drawn sunk into the hall below it. A torch is on a wall
   * and a wall is the same height everywhere.
   */
  props(opened: Set<string>): Array<{ kind: PropKind; x: number; y: number; z: number; rot: number }> {
    const out: Array<{ kind: PropKind; x: number; y: number; z: number; rot: number }> = [];
    for (const t of this.map.torches) out.push({ kind: PropKind.Torch, x: t.x + 0.5, y: WALL_Y, z: t.z + 0.5, rot: t.rot });
    if (!this.unlocked) {
      for (const d of this.map.doors) {
        // a door frame across the corridor: turn it to face along the gap
        const horizontal = this.tile(d.x + 1, d.z) === DTile.Rock || this.tile(d.x - 1, d.z) === DTile.Rock;
        out.push({ kind: PropKind.Door, x: d.x + 0.5, y: this.surface(d.x, d.z), z: d.z + 0.5, rot: horizontal ? 0 : Math.PI / 2 });
      }
    }
    const [ex, ez] = this.map.entrance;
    out.push({ kind: PropKind.Stairs, x: ex + 0.5, y: this.surface(ex, ez), z: ez + 0.5, rot: 0 });
    if (this.map.descent) {
      const [dx, dz] = this.map.descent;
      out.push({ kind: PropKind.Descent, x: dx + 0.5, y: this.surface(dx, dz), z: dz + 0.5, rot: Math.PI });
    }
    for (const f of this.map.furniture) {
      out.push({ kind: f.kind, x: f.x + 0.5, y: (f.level ?? 0) * WORLD.STEP || this.surface(f.x, f.z), z: f.z + 0.5, rot: f.rot });
    }
    this.map.chests.forEach((c, i) => {
      out.push({
        kind: opened.has(this.chestId(i)) ? PropKind.ChestOpen : PropKind.Chest,
        x: c.x + 0.5, y: this.surface(c.x, c.z), z: c.z + 0.5, rot: 0,
      });
    });
    return out;
  }

  chestId(i: number): string { return `${this.anchorId}:chest:${i}`; }

  /** True when the chest holding the key has already been opened. */
  keyTaken(opened: Set<string>): boolean {
    const i = this.map.chests.findIndex((c) => c.key);
    return i >= 0 && opened.has(this.chestId(i));
  }

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
