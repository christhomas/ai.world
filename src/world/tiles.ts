import { WORLD } from '../core/config';
import type { ChunkData } from './terrain';


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
  /**
   * True when a tree / boulder / cactus occupies the tile.
   *
   * `room` is how wide whoever is asking is: the half-width of their own body. Without it a walker
   * is a point, its middle stops at the wall, and the body it is drawn as stands in the plaster —
   * measured on the bench, three thousand of five thousand walks ended with the model inside the
   * thing it had stopped against, a bear over a tile deep into an oak. With it, the thing you can
   * see is the thing that is stopped.
   *
   * The ground itself is not grown by it. A tile is not an object with a size, it is the shape of
   * the world, and a gap one tile wide is meant to be a gap you can walk down.
   */
  blocked(x: number, z: number, room?: number): boolean;
  /**
   * True when the way from one point to another crosses something solid.
   *
   * `blocked` asks about a point, which is the wrong question for a mover and only looks like the
   * right one while steps are short: a hero on a courser covers nearly five tiles in one server
   * step, and a step tested at its far end alone walks through everything between the two ends. So
   * a mover asks this, and gets an answer that does not depend on how long its step was.
   *
   * Optional because not every world has boxes to test a line against — a dungeon is a grid of
   * rooms, and the tiles either side of a step describe it completely. Where it is missing the
   * mover falls back to sampling along the step, which a tile grid can be measured with because
   * nothing in one is thinner than a tile.
   */
  crosses?(x0: number, z0: number, x1: number, z1: number, room?: number): boolean;
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
 * Is there something solid between these two points?
 *
 * The question a blow and a shot both have and neither used to ask. A swing was a distance and an
 * angle, which is the whole of what a swing is in the open and not the whole of what it is anywhere
 * else: a wolf on the far side of a cottage is two tiles away and dead ahead, so a sword reached it
 * through the wall and an arrow found it through two. Nothing in the geometry of an arc says the
 * ground between has to be empty, so it has to be said out loud.
 *
 * Waived for anybody standing inside something. A hero set down on a market stall, or walking out of
 * one, is inside a box for a moment — and a rule that says he cannot hit anything while he is in
 * there turns a bad landing into a helpless one.
 *
 * Only the boxes. The tile grid is not consulted, so this is about buildings, stalls, trees and
 * carts rather than about hills: a hill between two people is a different question and one nobody
 * has asked yet.
 */
export function inTheWay(world: TileWorld, x0: number, z0: number, x1: number, z1: number): boolean {
  if (!world.crosses) return false;
  // a step of no length at all, which the slab test answers as "is this point inside a box"
  if (world.crosses(x0, z0, x0, z0)) return false;
  return world.crosses(x0, z0, x1, z1);
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
       * A prop used to make its whole tile solid from here. A tile is the wrong shape for
       * everything in this world: a market stall drawn two and a half tiles across blocked one, so
       * you walked through the counter; a cottage's three-tile footprint against 2.4 of wall put a
       * ring of invisible wall round every house. Props are boxes now — `solids.ts` — and every
       * world that walks anything builds them the same way.
       *
       * A building's floor used to be marked solid here as well, which was the last thing keeping
       * the ring: the footprint is stamped three tiles wide against 2.4 of wall. The building's own
       * box covers its walls and everything inside them, so the stamp is no longer needed and its
       * quarter-tile of nothing is gone with it.
       */
    }
  }
  return { cx: chunk.cx, cz: chunk.cz, types, heights, waters, blocked, biomes };
}
