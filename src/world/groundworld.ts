import { WORLD } from '../core/config';
import type { ChunkSource, ChunkTiles, TileWorld } from './tiles';

import { chunkKey } from './spatial';
import { mountainAt } from './ranges';
import type { Pier } from './structures';
import { TileType, type TerrainSampler } from './terrain';
import { tilesOf } from './tiles';
import { Solids, solidsOf } from './solids';

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
  /**
   * What is standing on each chunk, as boxes.
   *
   * The tile grid says what the ground is; this says what is on it. A prop is not tile-shaped, and
   * pretending otherwise is what let heroes walk through market stalls and stopped them at walls
   * that were not there. The game builds these from the stream its worker sends; this builds them
   * from the same props, generated the same way, so the two worlds agree about where a wall is.
   */
  private readonly solids = new Map<string, Solids>();

  constructor(private readonly sampler: TerrainSampler) {}

  /** How many chunks are being held. What the memory of a busy world is made of. */
  get held(): number { return this.loaded.size; }

  /** The piers of this world: where anything that floats ties up. */
  get piers(): ReadonlyArray<Pier> { return this.sampler.structures.piers; }

  /**
   * Is this a place a boat could have put somebody down?
   *
   * A pier is the only thing in the world that reaches out over the water, so it is where a ferry
   * lands, where a boat is moored and where anybody who arrives by water arrives. Both ends of it
   * count: the deck end a gangplank comes down on, and the tile a hull ties up beside.
   */
  atAPier(x: number, z: number, within: number): boolean {
    for (const pier of this.piers) {
      if (Math.hypot(pier.dockX + 0.5 - x, pier.dockZ + 0.5 - z) <= within) return true;
      const [ex, ez] = pier.tiles[pier.tiles.length - 1];
      if (Math.hypot(ex + 0.5 - x, ez + 0.5 - z) <= within) return true;
    }
    return false;
  }

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
      // and what was standing on it: the boxes are per chunk, so a chunk nobody is near that kept
      // its solids would be a world that only ever grows
      this.solids.delete(key);
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
    if (!hit) return true;                            // ground that has not been made is not ground
    if (hit.tiles.blocked[hit.i] === 1) return true;  // the ground itself: a floor, a wall of rock
    // and then whatever stands on it, against the box it is actually drawn at
    const CS = WORLD.CHUNK_SIZE;
    return this.solids.get(chunkKey(Math.floor(x / CS), Math.floor(z / CS)))?.at(x, z) ?? false;
  }

  /**
   * Does the way from one point to another cross a solid? The same question the game asks, so that
   * a wall stops a hero in the same place whichever half of the game is walking him.
   *
   * Every chunk the step spans, because a step can cross a chunk edge — at most four, and one
   * nearly always. Only the boxes: the tile grid is tile-shaped and a mover samples it closely
   * enough that nothing in it can hide between two samples.
   */
  crosses(x0: number, z0: number, x1: number, z1: number): boolean {
    const CS = WORLD.CHUNK_SIZE;
    const lowX = Math.floor(Math.min(x0, x1) / CS), highX = Math.floor(Math.max(x0, x1) / CS);
    const lowZ = Math.floor(Math.min(z0, z1) / CS), highZ = Math.floor(Math.max(z0, z1) / CS);
    for (let cz = lowZ; cz <= highZ; cz++) {
      for (let cx = lowX; cx <= highX; cx++) {
        if (this.solids.get(chunkKey(cx, cz))?.crosses(x0, z0, x1, z1)) return true;
      }
    }
    return false;
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
    const chunk = this.sampler.generateChunk(cx, cz);
    const tiles = tilesOf(chunk);
    this.loaded.set(chunkKey(cx, cz), tiles);
    this.solids.set(chunkKey(cx, cz), solidsOf(chunk, this.sampler.seed));
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
