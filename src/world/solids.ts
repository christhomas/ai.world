import { WORLD } from '../core/config';
import { FOOTPRINTS, MIN_BLOCK } from './footprints';
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
    // nobody can jump, and a stride is longer than some of these are thick — see `MIN_BLOCK`
    out.add({
      x: p.x, z: p.z, rot: p.rot ?? 0,
      hw: Math.max(box.hw * grew, MIN_BLOCK),
      hd: Math.max(box.hd * grew, MIN_BLOCK),
    });
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
    for (const s of this.near(x, z)) {
      // into the prop's own frame, where the box is square to the axes
      const dx = x - s.x, dz = z - s.z;
      const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
      if (Math.abs(dx * cos - dz * sin) <= s.hw && Math.abs(dx * sin + dz * cos) <= s.hd) return true;
    }
    return false;
  }

  /**
   * Does the way from one point to another cross anything?
   *
   * The question a mover actually has. Asking whether the far end is inside something is a
   * different question that happens to agree most of the time: it agrees whenever the step is
   * shorter than what it is walking at, and stops agreeing the moment it is not — a hero on a
   * courser covers nearly five tiles in one server step, which is a cottage and out the other
   * side, and a step that only asked about its own far end walked him through it with nothing to
   * say about the wall it crossed.
   *
   * This is the segment against the box, so the answer does not depend on how long the step was.
   */
  crosses(x0: number, z0: number, x1: number, z1: number): boolean {
    for (const s of this.along(x0, z0, x1, z1)) {
      if (segmentHitsBox(s, x0, z0, x1, z1)) return true;
    }
    return false;
  }

  /** The solids registered on one point's tile. */
  private near(x: number, z: number): readonly Solid[] {
    const CS = WORLD.CHUNK_SIZE;
    const tx = Math.floor(x) - this.cx * CS, tz = Math.floor(z) - this.cz * CS;
    if (tx < 0 || tz < 0 || tx >= CS || tz >= CS) return EMPTY;
    return this.buckets[tz * CS + tx];
  }

  /**
   * Every solid registered on any tile the segment passes over, each once.
   *
   * A box reaches into every tile it overlaps, so walking the tiles under the segment finds
   * everything it could possibly cross — and a wide prop is registered on several of them, hence
   * the set. The walk is over the box of tiles the segment spans rather than the tiles it strictly
   * crosses: a step is at most a tile or two long, so that is a handful of buckets either way and
   * not worth a line-walk to narrow.
   */
  private along(x0: number, z0: number, x1: number, z1: number): Set<Solid> {
    const CS = WORLD.CHUNK_SIZE;
    const found = new Set<Solid>();
    const lowX = Math.floor(Math.min(x0, x1)) - this.cx * CS;
    const highX = Math.floor(Math.max(x0, x1)) - this.cx * CS;
    const lowZ = Math.floor(Math.min(z0, z1)) - this.cz * CS;
    const highZ = Math.floor(Math.max(z0, z1)) - this.cz * CS;
    for (let tz = Math.max(0, lowZ); tz <= Math.min(CS - 1, highZ); tz++) {
      for (let tx = Math.max(0, lowX); tx <= Math.min(CS - 1, highX); tx++) {
        for (const s of this.buckets[tz * CS + tx]) found.add(s);
      }
    }
    return found;
  }
}

/** Nothing here, shared rather than made afresh for every question about empty ground. */
const EMPTY: readonly Solid[] = [];

/**
 * Does a segment touch a turned box?
 *
 * Both ends go into the box's own frame, where it is square to the axes and the whole thing is the
 * standard slab test: the stretch of the segment that is within the box's width, against the
 * stretch that is within its depth. If those two stretches overlap, the segment is inside the box
 * somewhere along its length.
 */
function segmentHitsBox(s: Solid, x0: number, z0: number, x1: number, z1: number): boolean {
  const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
  const ax = (x0 - s.x) * cos - (z0 - s.z) * sin, az = (x0 - s.x) * sin + (z0 - s.z) * cos;
  const bx = (x1 - s.x) * cos - (z1 - s.z) * sin, bz = (x1 - s.x) * sin + (z1 - s.z) * cos;
  let lo = 0, hi = 1;
  for (const [from, to, half] of [[ax, bx, s.hw], [az, bz, s.hd]] as const) {
    const d = to - from;
    if (Math.abs(d) < 1e-9) {
      // no movement across this pair of faces: either it starts between them or it never is
      if (Math.abs(from) > half) return false;
      continue;
    }
    const near = (-half - from) / d, far = (half - from) / d;
    lo = Math.max(lo, Math.min(near, far));
    hi = Math.min(hi, Math.max(near, far));
    if (lo > hi) return false;
  }
  return true;
}
