import type { Body } from './solids';
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
   * Is anything solid here — and, for somebody who has a shape, is it in the way of that shape?
   *
   * `body` is the asker's own box, turned the way it faces. Without it the asker is a point, and a
   * point is not what anybody is: measured on the bench, three thousand of five thousand walks
   * ended with the model standing inside the thing it had stopped against, a bear over a tile deep
   * into an oak. With it, what stops is the thing you can see.
   */
  blocked(x: number, z: number, body?: Body): boolean;
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
  crosses?(x0: number, z0: number, x1: number, z1: number, body?: Body): boolean;
  /**
   * True where a mountain stands over this tile, so the ground here is the inside of a cliff.
   *
   * Optional, because it is only true of the outdoor world of a polygon country. Nothing should
   * live on a mountain flank or under one: the flank is too steep to stand on and the ground under
   * it cannot be seen, so a herd spawned there is a herd nobody will ever meet.
   */
  buried?(x: number, z: number): boolean;
  /**
   * Is this ground people live on?
   *
   * Optional, and asked by whatever is deciding where a wild thing should be put. Nothing about a
   * village square says "village" to a tile: the streets and gardens between the houses are
   * ordinary ground, so ground inside a settlement went into the same pool of open country a wolf
   * pack picks its den out of — and packs were being laid down in the middle of towns, night after
   * night, because the ground there is as open as any field.
   *
   * A world that does not know where its villages are answers nothing and spawns as it always did.
   */
  peopled?(x: number, z: number): boolean;
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
  const biomes = new Uint8Array(CS * CS);

  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const from = (lz + 1) * size + (lx + 1);
      const to = lz * CS + lx;
      heights[to] = chunk.height[from];
      types[to] = chunk.type[from];
      waters[to] = chunk.water[from];
      biomes[to] = chunk.biome[from];
    }
  }
  return { cx: chunk.cx, cz: chunk.cz, types, heights, waters, biomes };
}
