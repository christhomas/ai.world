import { WORLD } from '../core/config';
import { TileType, type ChunkData } from './terrain';


/**
 * One chunk's ground, as everything that walks on it needs it: how high, what kind, how deep the
 * water, what is standing there, and which country it is in.
 */
export interface ChunkTiles {
  cx: number;
  cz: number;
  types: Uint8Array;
  heights: Float32Array;
  waters: Float32Array;
  blocked: Uint8Array;
  biomes: Uint8Array;
}

/** Where chunks come from, for anything that needs the ground without drawing it. */
export interface ChunkSource {
  getTiles(cx: number, cz: number): ChunkTiles | null;
}

/**
 * The ground, to anything standing on it.
 *
 * Implemented by the chunked outdoors, by a dungeon floor, by the inside of a building and by a
 * village in the clouds — and, now, by the simulation's own copy of the outdoors, which answers the
 * same questions with no graphics anywhere near it.
 *
 * It describes the world rather than the things living in it, which is why it lives here: a
 * creature imports the ground, the ground does not import creatures.
 */
export interface TileWorld {
  /** Walkable ground height at (x,z); null when unloaded, sea, or river/lake. */
  heightAt(x: number, z: number): number | null;
  /** Water surface height if (x,z) is a river/lake tile, else null. */
  waterAt(x: number, z: number): number | null;
  /** True when a tree / boulder / cactus occupies the tile. */
  blocked(x: number, z: number): boolean;
  /**
   * True where a mountain stands over this tile, so the ground here is the inside of a cliff.
   *
   * Optional, because it is only true of the outdoor world of a polygon country. Nothing should
   * live on a mountain flank or under one: the flank is too steep to stand on and the ground under
   * it cannot be seen, so a herd spawned there is a herd nobody will ever meet.
   */
  buried?(x: number, z: number): boolean;
  isRoad(x: number, z: number): boolean;
}

/**
 * A chunk of ground, as everything that walks on it needs it.
 *
 * The generator answers with an apron round every chunk — a tile of margin on each side, so the
 * mesher can build a seam — and with more about each tile than a walker cares about. This is the
 * part that matters to anything living: how high, what kind, how deep the water, and whether
 * something is standing there already.
 *
 * It lived inside the chunk worker, which meant only a browser drawing the ground could produce it.
 * The simulation needs the same tiles to own the creatures walking about on them, and it draws
 * nothing at all — so the packing moved here, where both can reach it, and neither can quietly
 * disagree with the other about which tiles are walkable.
 */
export function tilesOf(chunk: ChunkData): ChunkTiles {
  const CS = WORLD.CHUNK_SIZE;
  const size = chunk.size;
  const heights = new Float32Array(CS * CS);
  const types = new Uint8Array(CS * CS);
  const waters = new Float32Array(CS * CS);
  const blocked = new Uint8Array(CS * CS);
  const biomes = new Uint8Array(CS * CS);

  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const from = (lz + 1) * size + (lx + 1);
      const to = lz * CS + lx;
      heights[to] = chunk.height[from];
      types[to] = chunk.type[from];
      waters[to] = chunk.water[from];
      biomes[to] = chunk.biome[from];
      /*
       * The ground itself, and only that.
       *
       * A prop used to make its whole tile solid from here. That is a bit per tile describing a
       * thing that is not tile-shaped, and it was wrong in both directions: a market stall is drawn
       * two and a half tiles across and blocked one, so you walked through the counter; a cottage's
       * three-tile footprint is wider than its 2.4 of wall, so there was a ring of invisible wall
       * round every house. Props are collided against the box they are actually drawn at now — see
       * `solids.ts` — and this is left with what is true of the ground: a floor is indoors, and you
       * do not walk in from the street.
       *
       * Even that has gone now. A building's footprint is stamped three tiles wide while its walls
       * are 2.4 and its plinth 2.6, so `Floor` was the last thing putting a ring of invisible wall
       * round every cottage — measured at 0.15 of a tile all the way round. The building's own box
       * covers its walls and everything inside them, which is what a wall is for.
       */
    }
  }
  return { cx: chunk.cx, cz: chunk.cz, types, heights, waters, blocked, biomes };
}
