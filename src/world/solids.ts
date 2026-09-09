import { MIN_BLOCK, type Footprints } from './footprints';
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
 * The boxes of a set of props.
 *
 * Whatever `footprints` answers about is what stops you: measuring is a fact, blocking is a
 * decision, and the decision belongs to the world the thing is standing in — see `blocking` in
 * `footprints.ts`. A pew stops you in a church and there are no pews on a hillside.
 *
 * Takes the props rather than fetching them, because the two worlds that need this get them from
 * different places and must not disagree: the game reads the stream its chunk worker already sent
 * for drawing, and the server generates the same props itself with `propsOf`. Same footprints, same
 * boxes, so a stall stops both of them in the same place — which is the whole of why this exists.
 */
export function boxesFrom(props: Iterable<Pick<PropAt, 'kind' | 'x' | 'z'> & { rot?: number; scale?: number }>, footprints: Footprints): Solid[] {
  const out: Solid[] = [];
  for (const p of props) {
    const box = footprints.get(p.kind);
    if (!box) continue;
    const grew = p.scale ?? 1;
    // nobody can jump, and a stride is longer than some of these are thick — see `MIN_BLOCK`
    out.push({
      x: p.x, z: p.z, rot: p.rot ?? 0,
      hw: Math.max(box.hw * grew, MIN_BLOCK),
      hd: Math.max(box.hd * grew, MIN_BLOCK),
    });
  }
  return out;
}

/** The same, for a world that holds the chunk itself and has no stream to hand. */
export function boxesOf(chunk: ChunkData, seed: number, footprints: Footprints): Solid[] {
  return boxesFrom(propsOf(chunk, seed), footprints);
}

/**
 * Everything solid in the world, bucketed by tile so asking about a point is cheap.
 *
 * A box is registered in every tile it reaches into, which is what lets a stall wider than its own
 * tile stop you on the tiles either side. The lookup is then one bucket — nearly always empty or
 * holding one thing — and an exact test against that.
 *
 * The world, rather than one chunk each. It was a grid per chunk, clamped to that chunk's own
 * sixteen tiles, and a cottage is two and a half tiles across: a house near a chunk edge had the
 * part of its box that lay over the line registered nowhere at all, because the chunk it belonged
 * to would not take a tile outside itself and the chunk next door had never heard of it. So you
 * walked at that house from the far side and went straight through the wall as far as the boundary.
 * Trees kept working, which is what made it look like nonsense: a tree is under a tile wide and
 * mostly stays inside its own chunk.
 *
 * One index for the world has no edges in it. Chunks come and go by name — `put` when a chunk's
 * props arrive, `drop` when it is unloaded — and a box put down near a boundary reaches into its
 * neighbour the way it is drawn.
 */
export class Solids {
  /** Boxes by world tile. Sparse: most of the world has nothing standing on it. */
  private readonly buckets = new Map<number, Solid[]>();
  /** Which chunk put each box down, so a chunk can take its own away again. */
  private readonly byChunk = new Map<string, Solid[]>();

  /** Everything one chunk puts in the world, replacing whatever it had before. */
  put(chunk: string, solids: readonly Solid[]): void {
    this.drop(chunk);
    if (solids.length === 0) return;
    this.byChunk.set(chunk, [...solids]);
    for (const solid of solids) {
      for (const key of tilesUnder(solid)) {
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(solid);
        else this.buckets.set(key, [solid]);
      }
    }
  }

  /** A chunk is gone: take its boxes with it, wherever they reached. */
  drop(chunk: string): void {
    const had = this.byChunk.get(chunk);
    if (!had) return;
    this.byChunk.delete(chunk);
    for (const solid of had) {
      for (const key of tilesUnder(solid)) {
        const bucket = this.buckets.get(key);
        if (!bucket) continue;
        const at = bucket.indexOf(solid);
        if (at >= 0) bucket.splice(at, 1);
        if (bucket.length === 0) this.buckets.delete(key);
      }
    }
  }

  /** How many boxes are standing, for a test that wants to know they were taken away again. */
  get count(): number {
    let n = 0;
    for (const held of this.byChunk.values()) n += held.length;
    return n;
  }

  /** Is this point inside anything? */
  at(x: number, z: number): boolean {
    for (const s of this.near(x, z)) if (pointInBox(s, x, z)) return true;
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
   *
   * The tiles the step spans are walked rather than the tiles it strictly crosses: a step is a tile
   * or two long, so that is a handful of buckets either way. A box wider than a tile is registered
   * on several of them and so can be tested twice, which is a few arithmetic operations — cheaper
   * than the set that used to be allocated on every candidate of every slice of every move, of
   * which there are twenty-odd per walking frame per creature.
   */
  crosses(x0: number, z0: number, x1: number, z1: number): boolean {
    const lowX = Math.floor(Math.min(x0, x1)), highX = Math.floor(Math.max(x0, x1));
    const lowZ = Math.floor(Math.min(z0, z1)), highZ = Math.floor(Math.max(z0, z1));
    for (let tz = lowZ; tz <= highZ; tz++) {
      for (let tx = lowX; tx <= highX; tx++) {
        const bucket = this.buckets.get(tileKey(tx, tz));
        if (!bucket) continue;
        for (const s of bucket) if (segmentHitsBox(s, x0, z0, x1, z1)) return true;
      }
    }
    return false;
  }

  /** The solids registered on one point's tile. */
  private near(x: number, z: number): readonly Solid[] {
    return this.buckets.get(tileKey(Math.floor(x), Math.floor(z))) ?? EMPTY;
  }

}

/**
 * One tile as one number, so the buckets are keyed by a primitive.
 *
 * The offset keeps both halves positive and the stride is wider than any coordinate the world uses,
 * so no two tiles can share a key — the same trick, and the same reason, as `Standing`.
 */
function tileKey(tx: number, tz: number): number {
  return (tz + OFFSET) * STRIDE + (tx + OFFSET);
}

const OFFSET = 0x80000;
const STRIDE = 0x100000;

/** Every tile a box reaches into, as bucket keys. */
function* tilesUnder(solid: Solid): Generator<number> {
  // the box turned: how far it reaches along the world's own axes
  const cos = Math.abs(Math.cos(solid.rot)), sin = Math.abs(Math.sin(solid.rot));
  const reachX = solid.hw * cos + solid.hd * sin;
  const reachZ = solid.hw * sin + solid.hd * cos;
  const x0 = Math.floor(solid.x - reachX), x1 = Math.floor(solid.x + reachX);
  const z0 = Math.floor(solid.z - reachZ), z1 = Math.floor(solid.z + reachZ);
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) yield tileKey(tx, tz);
  }
}

/** Nothing here, shared rather than made afresh for every question about empty ground. */
const EMPTY: readonly Solid[] = [];

/**
 * Is a point inside a turned box?
 *
 * Exported, with the segment test below it, because the index that finds candidate boxes has to be
 * provably nothing but an index: a test can brute-force these two over every box in the world and
 * demand the same answers. That is what makes the buckets an optimisation rather than a second
 * opinion — the class of fault that let a house be solid on one side of a chunk boundary and not
 * the other.
 */
export function pointInBox(s: Solid, x: number, z: number): boolean {
  // into the prop's own frame, where the box is square to the axes
  const dx = x - s.x, dz = z - s.z;
  const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
  return Math.abs(dx * cos - dz * sin) <= s.hw && Math.abs(dx * sin + dz * cos) <= s.hd;
}

/**
 * Does a segment touch a turned box?
 *
 * Both ends go into the box's own frame, where it is square to the axes and the whole thing is the
 * standard slab test: the stretch of the segment that is within the box's width, against the
 * stretch that is within its depth. If those two stretches overlap, the segment is inside the box
 * somewhere along its length.
 */
export function segmentHitsBox(s: Solid, x0: number, z0: number, x1: number, z1: number): boolean {
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
