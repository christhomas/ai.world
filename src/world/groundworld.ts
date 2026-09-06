import { WORLD } from '../core/config';
import type { ChunkSource, ChunkTiles, TileWorld } from './tiles';

import { chunkKey } from './spatial';
import { mountainAt } from './ranges';
import { TileType, type TerrainSampler } from './terrain';
import { tilesOf } from './tiles';

/**
 * The ground, for something that walks on it but never draws it.
 *
 * The game's own `ChunkManager` is both at once: it streams chunks to the graphics card and answers
 * what is underfoot. The simulation needs only the second half — it owns creatures, and a creature
 * needs to know how high the ground is, where the water is, and what it cannot walk through.
 *
 * So this is that half, built straight off the terrain generator with no worker, no meshes and no
 * three.js anywhere near it. It is what lets the world server run the wildlife: on a machine with
 * no screen, and in a Web Worker beside a game somebody is playing alone.
 *
 * Chunks are generated on demand and kept. A chunk costs about a millisecond and thirty kilobytes,
 * and the ones that get generated are the ones somebody is standing near, which is the whole of the
 * interest management this needs at this stage.
 */
export class GroundWorld implements TileWorld, ChunkSource {
  private readonly loaded = new Map<string, ChunkTiles>();

  constructor(private readonly sampler: TerrainSampler) {}

  /** How many chunks are being held. What the memory of a busy world is made of. */
  get held(): number { return this.loaded.size; }

  /**
   * Make sure the ground round a point exists, and say how many chunks had to be made for it.
   *
   * Called with wherever players are, which is what decides how much of a world is real at any
   * moment: nobody near it means nobody to tell about it, and a chunk nobody is near is a chunk the
   * simulation has no reason to hold.
   */
  reach(x: number, z: number, chunks: number): number {
    const CS = WORLD.CHUNK_SIZE;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    let made = 0;
    for (let dz = -chunks; dz <= chunks; dz++) {
      for (let dx = -chunks; dx <= chunks; dx++) {
        if (this.loaded.has(chunkKey(cx + dx, cz + dz))) continue;
        this.load(cx + dx, cz + dz);
        made++;
      }
    }
    return made;
  }

  /** Forget the chunks nobody named, so a world that has been walked across does not grow forever. */
  keepOnly(near: Array<{ x: number; z: number }>, chunks: number): number {
    const CS = WORLD.CHUNK_SIZE;
    const wanted = new Set<string>();
    for (const spot of near) {
      const cx = Math.floor(spot.x / CS), cz = Math.floor(spot.z / CS);
      for (let dz = -chunks; dz <= chunks; dz++) {
        for (let dx = -chunks; dx <= chunks; dx++) wanted.add(chunkKey(cx + dx, cz + dz));
      }
    }
    let dropped = 0;
    for (const key of [...this.loaded.keys()]) {
      if (wanted.has(key)) continue;
      this.loaded.delete(key);
      dropped++;
    }
    return dropped;
  }

  /**
   * A chunk, if this world is holding it.
   *
   * Null rather than generating one on demand, which is the whole of the interest management: the
   * simulation decides how much world exists by calling `reach`, and everything else — the herds
   * looking for somewhere to spawn, a creature asking what is underfoot — works within what it
   * decided. Generating on demand here would let the wildlife quietly grow the world past the point
   * anybody is watching it, and then drop it again on the next sweep, for ever.
   */
  getTiles(cx: number, cz: number): ChunkTiles | null {
    return this.loaded.get(chunkKey(cx, cz)) ?? null;
  }

  heightAt(x: number, z: number): number | null {
    const hit = this.tileAt(x, z);
    if (!hit) return null;
    const type = hit.tiles.types[hit.i];
    if (type === TileType.Skip || type === TileType.Seabed || type === TileType.Water) return null;
    const ground = hit.tiles.heights[hit.i];
    // a mountain is a solid standing on the ground, so what is underfoot is the higher of the two
    const rock = this.sampler.ranges ? mountainAt(this.sampler.ranges, x, z) : null;
    return rock !== null && rock > ground ? rock : ground;
  }

  waterAt(x: number, z: number): number | null {
    const hit = this.tileAt(x, z);
    if (!hit) return null;
    const type = hit.tiles.types[hit.i];
    if (type === TileType.Water) return hit.tiles.waters[hit.i];
    return type === TileType.Seabed ? WORLD.WATER_Y : null;
  }

  blocked(x: number, z: number): boolean {
    const hit = this.tileAt(x, z);
    return hit ? hit.tiles.blocked[hit.i] === 1 : true;
  }

  buried(x: number, z: number): boolean {
    if (!this.sampler.ranges) return false;
    const hit = this.tileAt(x, z);
    if (!hit) return false;
    const rock = mountainAt(this.sampler.ranges, x, z);
    return rock !== null && rock > hit.tiles.heights[hit.i] + BURIED_BY;
  }

  isRoad(x: number, z: number): boolean {
    const hit = this.tileAt(x, z);
    return hit ? hit.tiles.types[hit.i] === TileType.Road : false;
  }

  private load(cx: number, cz: number): ChunkTiles {
    const tiles = tilesOf(this.sampler.generateChunk(cx, cz));
    this.loaded.set(chunkKey(cx, cz), tiles);
    return tiles;
  }

  private tileAt(x: number, z: number): { tiles: ChunkTiles; i: number } | null {
    const CS = WORLD.CHUNK_SIZE;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const tiles = this.loaded.get(chunkKey(cx, cz));
    if (!tiles) return null;
    const lx = Math.floor(x - cx * CS), lz = Math.floor(z - cz * CS);
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS) return null;
    return { tiles, i: lz * CS + lx };
  }
}

/** How far a mountain has to stand above a tile before nothing belongs there, in world units. */
const BURIED_BY = 1.5;
