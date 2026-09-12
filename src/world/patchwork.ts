import { WORLD } from '../core/config';
import { samplerIn } from './endless';
import type { TerrainSampler } from './terrain';
import type { Within } from './window';

/**
 * The endless country as something the game can hold: one patch at a time, and the ones next to it.
 *
 * `endless.ts` answers for *a patch*. That is the whole point of it — a place's content is settled
 * by a bounded neighbourhood, never by a traversal — and it is also the reason the game cannot use
 * it as it stands. Everything in this game hangs off one `TerrainSampler` grown once: the chunk
 * workers are handed the world's roads, water and buildings at start-up, the mountains go into the
 * scene as a single mesh, and every question anybody asks about the ground goes to that one object.
 * A world with no edge has no "the world's roads" to hand anybody.
 *
 * So this is the join, and it is deliberately the smallest one that could work: a *patchwork*. The
 * country is cut into squares, each square is a sampler grown for exactly that square, and a
 * question about a point is answered by the square it falls in. Nothing here paints anything, knows
 * what a chunk mesh is, or talks to a worker. It is the bookkeeping — which square, grow it if it is
 * new, let the far ones go — and everything above it can then be written as though there were one
 * sampler, because from any one spot there effectively is.
 *
 * ## Why a square is what it is
 *
 * `PATCH` is the same 512 tiles a province is, and that is not a coincidence worth undoing. The two
 * are different ideas — a province is where the *state* lives, what was changed and who died, and a
 * patch is only how much country is grown at once — but a world in which they line up is a world
 * where "load the province I am walking into" and "grow the ground I am walking into" are one
 * boundary crossing rather than two out of step with each other. Sixteen chunks to a side at the
 * game's chunk size, so no chunk ever straddles two patches and no tile is ever painted by two
 * different samplers.
 *
 * ## What it costs
 *
 * A patch is about a second of work to grow and a few megabytes to hold. `KEEPS` of them are held
 * at once, which is the one you are in and its neighbours, so walking a straight line grows a patch
 * every few minutes and drops one behind you. The alternative — growing per chunk — would redo a
 * patch's roads and rivers sixteen times over for each of the sixteen chunk rows in it, and the
 * alternative to *that* is keeping everything, which is the bounded world with extra steps.
 */

/** How wide a patch of grown country is, in tiles. The province's own number, for the reason above. */
export const PATCH = 512;

/**
 * How many patches are held at once.
 *
 * Nine: the one the hero is standing in and the eight around it, so walking to any edge finds the
 * next patch already grown. It is also the smallest number that does not thrash — with four, a hero
 * walking a circle round a corner where four patches meet would grow and drop the same square over
 * and over.
 */
export const KEEPS = 9;

/** Which patch a point is in. Negative country included, which `Math.floor` gets right and `|0` does not. */
export function patchOf(x: number, z: number): string {
  return `${Math.floor(x / PATCH)},${Math.floor(z / PATCH)}`;
}

/** The square of country a patch is, in tiles. */
export function boundsOf(patch: string): Within {
  const [px, pz] = patch.split(',').map(Number);
  return { x0: px * PATCH, z0: pz * PATCH, x1: (px + 1) * PATCH, z1: (pz + 1) * PATCH };
}

/** Which patch a chunk belongs to. A chunk never straddles two, which is what `PATCH` is chosen for. */
export function patchOfChunk(cx: number, cz: number): string {
  return patchOf(cx * WORLD.CHUNK_SIZE, cz * WORLD.CHUNK_SIZE);
}

/** One grown patch, and when it was last wanted. */
interface Held {
  patch: string;
  sampler: TerrainSampler;
  /** A counter rather than a clock: what is being asked is "which of these is least used". */
  touched: number;
}

/**
 * The country around wherever anybody is standing.
 *
 * Grown on demand and dropped when it is far enough behind. `grow` is handed in so a test can count
 * how often a patch is really built, and so that a world server — which has no browser, no worker
 * and no scene — can hand in its own.
 */
export class Patchwork {
  private readonly held = new Map<string, Held>();
  private clock = 0;
  /** How many patches have been grown in this session, for anybody checking the work is bounded. */
  grown = 0;

  constructor(
    private readonly seed: number,
    private readonly grow: (seed: number, within: Within) => TerrainSampler = samplerIn,
    private readonly keeps = KEEPS,
  ) {}

  /** The sampler that answers for this point, growing its patch if this is the first time. */
  at(x: number, z: number): TerrainSampler {
    return this.patch(patchOf(x, z));
  }

  /** The sampler that paints this chunk. */
  forChunk(cx: number, cz: number): TerrainSampler {
    return this.patch(patchOfChunk(cx, cz));
  }

  /** The sampler for a named patch. */
  patch(patch: string): TerrainSampler {
    const already = this.held.get(patch);
    if (already) {
      already.touched = ++this.clock;
      return already.sampler;
    }
    const sampler = this.grow(this.seed, boundsOf(patch));
    this.grown++;
    this.held.set(patch, { patch, sampler, touched: ++this.clock });
    this.forget();
    return sampler;
  }

  /**
   * Grow the patch somebody is in and the eight around it, before they are asked for.
   *
   * What stops the game stopping dead at a patch boundary. Called as the hero walks, it does the
   * work while there is still country under his feet; called on nothing it does nothing, because
   * everything it wants is already held.
   */
  around(x: number, z: number): void {
    const px = Math.floor(x / PATCH);
    const pz = Math.floor(z / PATCH);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.patch(`${px + dx},${pz + dz}`);
  }

  /** Whether this square is already grown and to hand. */
  has(patch: string): boolean {
    return this.held.has(patch);
  }

  /**
   * Take a patch somebody else grew.
   *
   * The country worker's whole purpose: it does the five seconds on another thread and hands the
   * result in here. Ignored if the patch is already held, because the one in hand is as good as the
   * one arriving and swapping it would change the sampler under whoever is standing on it.
   */
  put(patch: string, sampler: TerrainSampler): void {
    if (this.held.has(patch)) return;
    this.held.set(patch, { patch, sampler, touched: ++this.clock });
    this.forget();
  }

  /** Which patches are held at this moment, for a test and for a debug readout. */
  holding(): string[] {
    return [...this.held.keys()].sort();
  }

  /** Drop the least recently wanted until the cache is inside its bound. */
  private forget(): void {
    while (this.held.size > this.keeps) {
      let oldest: Held | null = null;
      for (const held of this.held.values()) if (!oldest || held.touched < oldest.touched) oldest = held;
      if (!oldest) return;
      this.held.delete(oldest.patch);
    }
  }
}

/**
 * Which patches each painter has already been told about.
 *
 * A worker paints from patches it has been handed, keeps a bounded few, and drops the oldest. This
 * is the other end of that rule, kept on the side that does the telling, and the two have to agree
 * exactly: a main thread that thinks a worker still holds a patch the worker has quietly dropped is
 * a chunk request that paints nothing at all and never answers.
 *
 * So it is written once, here, and both ends are the same object with the same bound — the worker's
 * `Map` drops its oldest key, and this drops the front of its list. `needs` is the whole interface:
 * ask it before sending a chunk, and send the patch first if it says yes.
 *
 * Generic in the painter because the thing being told is a `Worker` in the game and a number in a
 * test, and the rule has nothing to do with which.
 */
export class Tellings<Painter> {
  private readonly told = new Map<Painter, string[]>();

  constructor(private readonly keeps: number) {}

  /**
   * Whether this painter has to be told about this patch before it can paint from it — and, either
   * way, records that it is now the most recently used of the ones it holds.
   */
  needs(who: Painter, patch: string): boolean {
    let known = this.told.get(who);
    if (!known) { known = []; this.told.set(who, known); }
    const at = known.indexOf(patch);
    if (at >= 0) {
      known.splice(at, 1);                       // most recently used goes to the back
      known.push(patch);
      return false;
    }
    known.push(patch);
    while (known.length > this.keeps) known.shift();
    return true;
  }

  /** What this painter is holding, oldest first. For a test, and for a debug readout. */
  holding(who: Painter): string[] {
    return [...(this.told.get(who) ?? [])];
  }
}
