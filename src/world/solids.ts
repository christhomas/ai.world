import { WORLD } from '../core/config';
import { FOOTPRINTS } from './footprints';
import { propsOf, type PropAt } from './propstream';
import type { ChunkData } from './terrain';

/**
 * What you bump into, taken from what is drawn.
 *
 * Collision used to be a bit per tile: a prop stood on a tile, and that whole tile was solid. It is
 * wrong in both directions at once and both were reported within a minute of each other. A market
 * stall is drawn about two and a half tiles across and blocked one, so you walked through the
 * counter and out the other side. A cottage's footprint was stamped three tiles wide while its
 * walls are 2.4, so there was a ring of invisible wall round every house — measured on a live
 * world: solid out to 1.35 from the middle, walls drawn to 1.20.
 *
 * A one-tile grid cannot describe either of those, so it stops trying. Every prop now carries the
 * box its own geometry occupies, and a point is inside a thing or it is not.
 *
 * What counts as a box is the band a walker meets — see `footprints.ts`, which explains why, and
 * holds the measurements taken off the meshes themselves.
 */

/** A thing standing in the world, as a walker meets it: a box on the ground, turned. */
export interface Solid {
  x: number;
  z: number;
  /** Half-extents along the prop's own axes, before it was turned. */
  hw: number;
  hd: number;
  /** How far it is turned, in radians. */
  rot: number;
}

/**
 * Every solid thing in a chunk, built from the props standing on it.
 *
 * Takes the props rather than fetching them, because the two worlds that need this get them from
 * different places and must not disagree: the game reads the stream its chunk worker already sent
 * for drawing, and the server generates the same props itself with `propsOf`. Same footprints, same
 * boxes, so a stall stops both of them in the same place — which is the whole of why this exists.
 */
export function solidsFrom(cx: number, cz: number, props: Iterable<Pick<PropAt, 'kind' | 'x' | 'z'> & { rot?: number; scale?: number }>): Solids {
  const out = new Solids(cx, cz);
  for (const p of props) {
    const box = FOOTPRINTS.get(p.kind);
    if (!box) continue;
    const grew = p.scale ?? 1;
    out.add({ x: p.x, z: p.z, hw: box.hw * grew, hd: box.hd * grew, rot: p.rot ?? 0 });
  }
  return out;
}

/** The same, for a world that holds the chunk itself and has no stream to hand. */
export function solidsOf(chunk: ChunkData, seed: number): Solids {
  return solidsFrom(chunk.cx, chunk.cz, propsOf(chunk, seed));
}

/**
 * The solid things in one chunk, bucketed by tile so asking about a point is cheap.
 *
 * A box is registered in every tile it reaches into, which is what lets a stall wider than its own
 * tile stop you on the tiles either side. The lookup is then one bucket — nearly always empty or
 * holding one thing — and an exact test against that.
 */
export class Solids {
  private readonly buckets: Solid[][];

  constructor(private readonly cx: number, private readonly cz: number) {
    const CS = WORLD.CHUNK_SIZE;
    this.buckets = Array.from({ length: CS * CS }, () => []);
  }

  /** Put a prop into every tile of this chunk its box reaches. */
  add(solid: Solid): void {
    const CS = WORLD.CHUNK_SIZE;
    // the box turned: how far it reaches along the world's own axes
    const cos = Math.abs(Math.cos(solid.rot)), sin = Math.abs(Math.sin(solid.rot));
    const reachX = solid.hw * cos + solid.hd * sin;
    const reachZ = solid.hw * sin + solid.hd * cos;
    const x0 = Math.floor(solid.x - reachX) - this.cx * CS;
    const x1 = Math.floor(solid.x + reachX) - this.cx * CS;
    const z0 = Math.floor(solid.z - reachZ) - this.cz * CS;
    const z1 = Math.floor(solid.z + reachZ) - this.cz * CS;
    for (let tz = Math.max(0, z0); tz <= Math.min(CS - 1, z1); tz++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(CS - 1, x1); tx++) {
        this.buckets[tz * CS + tx].push(solid);
      }
    }
  }

  /** Is this point inside anything? */
  at(x: number, z: number): boolean {
    const CS = WORLD.CHUNK_SIZE;
    const tx = Math.floor(x) - this.cx * CS, tz = Math.floor(z) - this.cz * CS;
    if (tx < 0 || tz < 0 || tx >= CS || tz >= CS) return false;
    for (const s of this.buckets[tz * CS + tx]) {
      // into the prop's own frame, where the box is square to the axes
      const dx = x - s.x, dz = z - s.z;
      const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
      if (Math.abs(dx * cos - dz * sin) <= s.hw && Math.abs(dx * sin + dz * cos) <= s.hd) return true;
    }
    return false;
  }
}
