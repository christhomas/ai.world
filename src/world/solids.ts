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

/**
 * The box a mover carries about with it: its own rectangle, turned the way it faces.
 *
 * A walker used to be asked about as a point, and then as a circle of its narrow half. Neither is
 * the shape of an animal: a horse is nearly two tiles nose to tail and a third of one across, so a
 * point puts its whole body inside a wall and a circle that fits its width cannot fit its length.
 * What collides is the model, so what is asked about is the model's own box.
 */
export interface Body {
  hw: number;
  hd: number;
  /** Which way it is facing, in radians. */
  rot: number;
}

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

  /**
   * Is this point inside anything — or, for somebody with a width, within that of it?
   *
   * `room` is how much of the asker sticks out around the point it is asked about: a bear is over a
   * tile across, so a bear whose middle is a hand's breadth from a wall is a bear standing in the
   * wall. Growing the box by the asker's own width is the whole of collision between two bodies,
   * stated once, and it costs nothing: the same box test, with a bigger box.
   */
  at(x: number, z: number, body?: Body): boolean {
    if (!body) {
      for (const s of this.near(x, z)) if (pointInBox(s, x, z)) return true;
      return false;
    }
    for (const s of this.near(x, z, body)) if (boxesOverlap(s, x, z, body)) return true;
    return false;
  }

  /**
   * How far inside something a body is, in tiles, and nought when it is standing clear.
   *
   * The measure a way *out* is worked out from. Being inside a solid has to be survivable — see
   * `slide` in `entities/entity.ts` for why — but "inside, so nothing blocks you" is a hole big
   * enough to walk a castle through: stand against a curtain wall facing along it, turn forty-five
   * degrees so your own turned box catches the wall, and every rule about walls is waived for as
   * long as you keep going. Which is exactly the fault this was reported as: *I can walk inside the
   * building and I should not be there*.
   *
   * With a depth the mercy can be aimed. A step that comes out shallower than it went in is going
   * the right way and is allowed; one that goes deeper, or slides along inside the same wall, is
   * not. Somebody set down inside a stall still walks out of it, and nobody walks in.
   *
   * The deepest of whatever it overlaps, because that is the one that has to be got out of. Depth
   * per solid is the separating axis theorem read the other way round: where the shadows overlap on
   * every axis, the least of those overlaps is how far in it is.
   */
  depth(x: number, z: number, body: Body): number {
    let worst = 0;
    for (const s of this.near(x, z, body)) worst = Math.max(worst, overlapDepth(s, x, z, body));
    return worst;
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
  crosses(x0: number, z0: number, x1: number, z1: number, body?: Body): boolean {
    const spanX = body ? reachOf(body, 1, 0) : 0;
    const spanZ = body ? reachOf(body, 0, 1) : 0;
    const lowX = Math.floor(Math.min(x0, x1) - spanX), highX = Math.floor(Math.max(x0, x1) + spanX);
    const lowZ = Math.floor(Math.min(z0, z1) - spanZ), highZ = Math.floor(Math.max(z0, z1) + spanZ);
    for (let tz = lowZ; tz <= highZ; tz++) {
      for (let tx = lowX; tx <= highX; tx++) {
        const bucket = this.buckets.get(tileKey(tx, tz));
        if (!bucket) continue;
        for (const s of bucket) {
          const hit = body
            ? sweptBoxHitsBox(s, x0, z0, x1, z1, body)
            : segmentHitsBox(s, x0, z0, x1, z1);
          if (hit) return true;
        }
      }
    }
    return false;
  }

  /**
   * The solids that could reach a point — or a body of `room` around it.
   *
   * One bucket for a point, which is nearly always empty or holding one thing. A body reaches into
   * the tiles around it, so it asks for those too: nine at the very worst, and only for something
   * as wide as a bear.
   */
  private near(x: number, z: number, body?: Body): readonly Solid[] {
    if (!body) return this.buckets.get(tileKey(Math.floor(x), Math.floor(z))) ?? EMPTY;
    /*
     * A malformed body must not quietly mean "nothing is solid".
     *
     * `reachOf` takes the cosine of `body.rot`, so a body without one produces NaN, every bound
     * below comes out NaN, the `for` never runs, and this returns an empty list — which every
     * caller reads as open ground. Nothing throws and nothing looks wrong; the world simply stops
     * having walls in it. It cost an hour of chasing a castle somebody could apparently walk into,
     * which turned out to be a test harness passing `bodyOf` — the size of a creature — where a
     * `Body` was wanted, the size and *which way it is facing*.
     *
     * TypeScript stops that in the game's own source. It does not stop a value arriving from a
     * save, a wire, or a test, and a collision system whose failure mode is silence is the wrong
     * failure mode. Loudly wrong beats quietly permissive.
     */
    if (!Number.isFinite(body.rot)) throw new Error(`a body with no facing cannot be collided: rot=${body.rot}`);
    // the tiles this body touches, which is the gate: two things in tiles that do not touch cannot
    // be touching either, and everything past this point is the models themselves
    const spanX = reachOf(body, 1, 0), spanZ = reachOf(body, 0, 1);
    const found: Solid[] = [];
    for (let tz = Math.floor(z - spanZ); tz <= Math.floor(z + spanZ); tz++) {
      for (let tx = Math.floor(x - spanX); tx <= Math.floor(x + spanX); tx++) {
        const bucket = this.buckets.get(tileKey(tx, tz));
        if (bucket) found.push(...bucket);
      }
    }
    return found;
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
export function pointInBox(s: Solid, x: number, z: number, room = 0): boolean {
  // into the prop's own frame, where the box is square to the axes, and grown by whatever width
  // the asker carries about with it
  const dx = x - s.x, dz = z - s.z;
  const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
  return Math.abs(dx * cos - dz * sin) <= s.hw + room && Math.abs(dx * sin + dz * cos) <= s.hd + room;
}

/** How far a turned box reaches from its own middle along a direction. */
function reachOf(box: { hw: number; hd: number; rot: number }, ux: number, uz: number): number {
  const cos = Math.cos(box.rot), sin = Math.sin(box.rot);
  return Math.abs(box.hw * (cos * ux + sin * uz)) + Math.abs(box.hd * (cos * uz - sin * ux));
}

/**
 * Do two turned boxes overlap: the model against the thing it is walking into.
 *
 * The separating axis theorem, which for two rectangles is four axes — each one's own two — and is
 * exact. If the two are apart along any of them they are apart, and the first one found ends it.
 *
 * This is the whole of collision between two things in this world. Everything else is either
 * finding which boxes are worth asking about, or deciding what a box is.
 */
export function boxesOverlap(s: Solid, x: number, z: number, body: Body): boolean {
  const dx = x - s.x, dz = z - s.z;
  for (const angle of [s.rot, s.rot + Math.PI / 2, body.rot, body.rot + Math.PI / 2]) {
    const ux = Math.cos(angle), uz = Math.sin(angle);
    if (Math.abs(dx * ux + dz * uz) > reachOf(s, ux, uz) + reachOf(body, ux, uz)) return false;
  }
  return true;
}

/**
 * How deep the overlap between two turned boxes is, and nought when they do not overlap.
 *
 * The same four axes as `boxesOverlap`, but keeping the least overlap rather than stopping at the
 * first gap: for two rectangles the shallowest axis is the shortest way out, which is what a walker
 * pushing to get free of a wall is looking for.
 */
export function overlapDepth(s: Solid, x: number, z: number, body: Body): number {
  const dx = x - s.x, dz = z - s.z;
  let least = Infinity;
  for (const angle of [s.rot, s.rot + Math.PI / 2, body.rot, body.rot + Math.PI / 2]) {
    const ux = Math.cos(angle), uz = Math.sin(angle);
    const over = reachOf(s, ux, uz) + reachOf(body, ux, uz) - Math.abs(dx * ux + dz * uz);
    if (over <= 0) return 0;
    if (over < least) least = over;
  }
  return least;
}

/**
 * Does a body, carried from one point to another, meet a box on the way?
 *
 * The same theorem again, with the sweep taken as what it is: a box whose middle is a line rather
 * than a point. On any axis its shadow is the shadow of the line, spread by how far the body
 * reaches along that axis — so the test is the box against that, on the two axes of each rectangle
 * and on the one the sweep itself adds. Exact, no circle anywhere in it, and it is what says a
 * step cannot jump a wall however long the step was.
 */
export function sweptBoxHitsBox(s: Solid, x0: number, z0: number, x1: number, z1: number, body: Body): boolean {
  const wayX = x1 - x0, wayZ = z1 - z0;
  const along = Math.hypot(wayX, wayZ);
  const axes: Array<[number, number]> = [
    [Math.cos(s.rot), Math.sin(s.rot)],
    [-Math.sin(s.rot), Math.cos(s.rot)],
    [Math.cos(body.rot), Math.sin(body.rot)],
    [-Math.sin(body.rot), Math.cos(body.rot)],
  ];
  // and across the way it is going, which is the only direction the sweep itself adds
  if (along > 1e-9) axes.push([-wayZ / along, wayX / along]);
  for (const [ux, uz] of axes) {
    const solidMiddle = s.x * ux + s.z * uz;
    const from = x0 * ux + z0 * uz, to = x1 * ux + z1 * uz;
    const spread = reachOf(body, ux, uz);
    const low = Math.min(from, to) - spread, high = Math.max(from, to) + spread;
    const reach = reachOf(s, ux, uz);
    if (high < solidMiddle - reach || low > solidMiddle + reach) return false;
  }
  return true;
}

/**
 * Does a segment touch a turned box?
 *
 * Both ends go into the box's own frame, where it is square to the axes and the whole thing is the
 * standard slab test: the stretch of the segment that is within the box's width, against the
 * stretch that is within its depth. If those two stretches overlap, the segment is inside the box
 * somewhere along its length.
 */
export function segmentHitsBox(s: Solid, x0: number, z0: number, x1: number, z1: number, room = 0): boolean {
  const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
  const ax = (x0 - s.x) * cos - (z0 - s.z) * sin, az = (x0 - s.x) * sin + (z0 - s.z) * cos;
  const bx = (x1 - s.x) * cos - (z1 - s.z) * sin, bz = (x1 - s.x) * sin + (z1 - s.z) * cos;
  let lo = 0, hi = 1;
  for (const [from, to, half] of [[ax, bx, s.hw + room], [az, bz, s.hd + room]] as const) {
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
