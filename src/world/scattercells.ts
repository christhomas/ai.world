import { rand2 } from '../core/rng';
import { derive } from '../core/salts';

/**
 * Scattering points across a world with no edge to it.
 *
 * `scatterPoints` in `polygons.ts` throws darts the way Bridson does: start in the middle, keep a
 * frontier, and grow outwards until the disc is full. It makes a beautiful point set and it cannot
 * be made infinite, because every point depends on the order the frontier was walked in — which is
 * to say on the whole world having been generated already, from the middle, in one go. Ask it for
 * the country a hundred miles east and it must first make everything in between.
 *
 * This is the same idea with the sequence taken out. Space is cut into cells; each cell hashes to a
 * handful of candidate points and each candidate to a priority; a candidate stands if no candidate
 * of higher priority lies within the room it claims. Nothing consults a frontier, nothing consults
 * an order, and the answer for any patch of country is the same whether it is asked for on its own,
 * as part of a larger patch, or after walking there from somewhere else.
 *
 * What makes that true is the one rule the whole idea rests on: **a point's fate is settled by its
 * own neighbourhood**. A cell is at least as wide as the largest room anybody may claim, so
 * everything that could refuse a candidate is in one of the eight cells around it. Bounded, and
 * therefore infinite.
 *
 * It is deliberately not wired into the world yet. First it has to be shown to produce a point set
 * of the same character as the one the world is built on today, and to give the same answer from
 * every direction — see `scattercells.test.ts`. Nothing about the country changes until it does.
 */

/** What a scatter needs to know: how far apart points may be, and how hard to try. */
export interface CellDials {
  /** The closest two points may ever be. */
  near: number;
  /** And the furthest apart the emptiest country puts them. */
  far: number;
  /** Candidates thrown per cell. More is a denser fill and more arithmetic; six is plenty. */
  tries: number;
}

/** A point that stood, and the room it claimed. */
export interface Site {
  x: number;
  z: number;
  /** How much room it wanted, which the mesher needs to know what kind of country this is. */
  claim: number;
  /**
   * What this one is called, for ever.
   *
   * The cell it was thrown in and which throw it was — which is to say, the two facts it was made
   * from. An endless world cannot keep a register of names, so everything downstream that needs to
   * refer to a place refers to it by this: the face here, the town on it, the road between it and
   * its neighbour, the province that owns it. Nothing has to be stored for a name to be stable.
   */
  id: string;
}

/** Salts, so the three things asked of one cell cannot be the same number. */
const OF_THE_CELL = 0x51fe;
const OF_THE_POINT = 0x2d7b;
const OF_THE_RANK = 0x8b19;

/**
 * Every candidate one cell throws, standing or not.
 *
 * A cell's candidates depend on the cell and the seed and nothing else — that is the whole of why
 * this works — so they can be asked for in any order, from any direction, for ever.
 */
function candidates(seed: number, cell: number, ci: number, cj: number, dials: CellDials, spacing: (x: number, z: number) => number): Array<Site & { rank: number }> {
  const out: Array<Site & { rank: number }> = [];
  for (let k = 0; k < dials.tries; k++) {
    const of = derive(seed, OF_THE_CELL ^ (k * 0x9e37));
    const x = (ci + rand2(of, ci, cj, OF_THE_POINT)) * cell;
    const z = (cj + rand2(of, ci, cj, OF_THE_POINT ^ 0x1f)) * cell;
    // how much room this one wants, from the field the world is shaped by
    const want = dials.near + (dials.far - dials.near) * Math.min(1, Math.max(0, spacing(x, z)));
    out.push({ x, z, claim: want, id: `${ci}:${cj}:${k}`, rank: rand2(of, ci, cj, OF_THE_RANK) });
  }
  return out;
}

/**
 * A world's points, with the cells it has already worked out kept.
 *
 * A cell's candidates are a pure function of the seed and the cell, so the second time anybody asks
 * about a cell the answer is the first answer. That is not an optimisation bolted on afterwards: an
 * endless world asks about the same handful of cells over and over — every face asks for the ground
 * around it, every junction asks again about the ground around itself — and without a memory the
 * work is quadratic in how carefully anything is checked. With one, it is the arithmetic of a few
 * dozen cells.
 *
 * Bounded, because a player who walks a long way would otherwise carry every cell they have ever
 * seen. What is remembered is emptied and worked out again if wanted, which costs a hash apiece.
 */
const CELLS_KEPT = 4096;

/**
 * How many gathered squares of cells are remembered. See `gather`.
 *
 * A patch of country is nine cells across and every question about it gathers the seven-by-seven
 * block around the point asked about, so a whole patch is answered out of about a hundred distinct
 * blocks. A few hundred is room for the patch being grown, the ring of country around it, and the
 * questions that stray past both.
 */
const BLOCKS_KEPT = 512;

/** A square of ground a question is asked about, in tiles. The same shape `Within` has. */
interface Square {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** One gathered block of cells: which cells it covers, and every site standing in them. */
interface Block {
  highI: number;
  highJ: number;
  sites: Site[];
  /** What the last full search of this block found. See `nearestIn`. */
  near?: Nearest;
}

/**
 * The last point a block was fully searched from, and what it found.
 *
 * Both distances are real distances rather than squared ones, because what they are kept for is a
 * subtraction: the gap between the winner and the runner-up is how far the asker may move before
 * the answer could possibly change.
 */
interface Nearest {
  x: number;
  z: number;
  owner: Site;
  /** How far away the winner was. */
  best: number;
  /** And the runner-up, or `Infinity` where the block holds only one site. */
  second: number;
}

/**
 * A store of one thing per cell, held as a map of rows rather than under a `"ci:cj"` key.
 *
 * Two integer lookups rather than a string, and this is a measured decision rather than a
 * stylistic one. Growing one patch asks about a cell some twelve million times — every tile of
 * every chunk asks which face it is on, and each of those questions looks at the forty-nine cells
 * around it — and building a key string for each of those asks cost more than everything the cells
 * themselves do put together. A packed number would be cheaper still and is not worth the risk: a
 * world with no edge to it has no bound on how large a cell number may grow, and two cells that
 * packed to the same number would be two places in the country quietly becoming one.
 */
type Rows<Kept> = Map<number, Map<number, Kept>>;

/** The row a cell is in, made if this is the first thing that row has been asked for. */
function rowOf<Kept>(rows: Rows<Kept>, ci: number): Map<number, Kept> {
  let row = rows.get(ci);
  if (!row) { row = new Map(); rows.set(ci, row); }
  return row;
}

export class Scatter {
  private readonly known: Rows<Array<Site & { rank: number }>> = new Map();
  private readonly stood: Rows<Site[]> = new Map();
  private readonly gathered: Rows<Block> = new Map();
  /** How many cells and blocks are remembered, so each store can be held inside its bound. */
  private cells = 0;
  private blocks = 0;

  constructor(
    private readonly seed: number,
    private readonly spacing: (x: number, z: number) => number,
    readonly dials: CellDials,
  ) {}

  /** One cell's candidates, worked out once. */
  private cell(ci: number, cj: number): Array<Site & { rank: number }> {
    const known = this.known.get(ci)?.get(cj);
    if (known) return known;
    const made = candidates(this.seed, this.dials.far, ci, cj, this.dials, this.spacing);
    // Everything here is a pure function of the seed and the cell, so forgetting one costs the
    // arithmetic to make it again and nothing else. That is why the whole store is emptied rather
    // than the oldest entry hunted down: keeping an order across rows is bookkeeping on every
    // single lookup, to save re-deriving a handful of points that cost microseconds each.
    if (this.cells >= CELLS_KEPT) { this.known.clear(); this.stood.clear(); this.gathered.clear(); this.cells = 0; this.blocks = 0; }
    rowOf(this.known, ci).set(cj, made);
    this.cells++;
    return made;
  }

  /**
   * The points a cell ends up with, worked out once.
   *
   * Which candidates stand is settled by the cell and its eight neighbours and by nothing else, so
   * it is as much a property of the cell as the candidates are. Remembering only the candidates and
   * settling them afresh for every window was most of the cost of an endless world: a face asks
   * about the ground around it, a junction asks again, a road asks a third time, and each of those
   * windows overlaps the same cells and did the same refusing over again.
   */
  private standing(ci: number, cj: number): Site[] {
    const known = this.stood.get(ci)?.get(cj);
    if (known) return known;
    const neighbours: Array<Site & { rank: number }> = [];
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) neighbours.push(...this.cell(i, j));
    }
    const kept = this.cell(ci, cj)
      .filter((one) => !refusedBy(one, neighbours))
      .map((one) => ({ x: one.x, z: one.z, claim: one.claim, id: one.id }));
    // the row is fetched after the cells above, because working one of them out may have emptied
    // the stores to stay inside their bound, and a row held from before that would be an orphan
    rowOf(this.stood, ci).set(cj, kept);
    return kept;
  }

  /**
   * Every site standing in the block of cells a square covers, gathered once and kept.
   *
   * This is the piece that decides what an endless country costs to grow, so it is worth being
   * plain about. A face is found by looking at the ground within three claims of a point, which is
   * a seven-by-seven block of cells and about a hundred and fifty sites. The sampler asks that
   * question for every tile of every chunk of a patch — a quarter of a million times — and the
   * point next door is in the same block as the point before it, because a cell is sixty-two tiles
   * wide and a tile is one. So the same block was gathered over and over: twelve million cell
   * lookups and a quarter of a million arrays built and thrown away, to answer about a hundred
   * distinct questions.
   *
   * Keyed by the near corner of the block and checked against the far one, so two blocks that
   * start at the same cell and end at different ones can never be taken for each other.
   *
   * The list handed back is the kept one and must not be written to. Both callers below read it
   * and copy what they want out of it, which is what keeps that safe without a defensive copy —
   * and a defensive copy here would give back exactly the cost this exists to remove.
   */
  private gather(square: Square): Block {
    const cell = this.dials.far;
    const lowI = Math.floor(square.x0 / cell), highI = Math.floor(square.x1 / cell);
    const lowJ = Math.floor(square.z0 / cell), highJ = Math.floor(square.z1 / cell);
    const already = this.gathered.get(lowI)?.get(lowJ);
    if (already && already.highI === highI && already.highJ === highJ) return already;
    const sites: Site[] = [];
    for (let cj = lowJ; cj <= highJ; cj++) {
      for (let ci = lowI; ci <= highI; ci++) for (const one of this.standing(ci, cj)) sites.push(one);
    }
    // same reasoning as the cells: a block is a pure function of the cells it covers, so emptying
    // the store costs only the gathering, and gathering is what this is bounded to do rarely
    if (this.blocks >= BLOCKS_KEPT) { this.gathered.clear(); this.blocks = 0; }
    const block: Block = { highI, highJ, sites };
    rowOf(this.gathered, lowI).set(lowJ, block);
    this.blocks++;
    return block;
  }

  /** The points of a patch of country: the same answer as `sitesIn`, without the repeated work. */
  sitesIn(window: Square): Site[] {
    const kept: Site[] = [];
    for (const one of this.gather(window).sites) {
      if (one.x < window.x0 || one.x > window.x1 || one.z < window.z0 || one.z > window.z1) continue;
      kept.push(one);
    }
    return kept;
  }

  /**
   * The site nearest a point, of those a window holds.
   *
   * Exactly the set `sitesIn` would hand back and exactly the same tie: a point equally far from
   * two sites belongs to whichever the gathering reached first. That is not a detail to be tidied
   * up later — it is what decides which face a tile stands on, and a tile that changed hands would
   * be a different country on two machines that agree by construction.
   *
   * It lives here, on the point set, rather than in the mesher that wants it, because the mesher
   * could only ask by having the list built for it — a hundred and fifty sites gathered into a
   * fresh array and thrown away, once for every tile of every chunk.
   *
   * ## Asking once per region rather than once per tile
   *
   * The question is asked for every tile of every chunk and the answer is constant across a whole
   * face — which is to say most of the asking is re-deriving what the tile next door already
   * settled. What stops that is the block remembering where it was last searched from and what it
   * found, and a test that says whether the asker has moved far enough for that to matter.
   *
   * The test is the triangle inequality and it is exact, not a heuristic. Suppose the last full
   * search stood at `p`, found the winner at distance `best` and the runner-up at `second`. Move
   * `step` away from `p`. Every other site can have come closer by at most `step`, so none of them
   * is nearer than `second - step`; the winner can have receded by at most `step`, so it is no
   * further than `best + step`. If `best + step` is still less than `second - step` — that is, if
   * `2·step < second - best` — the winner is *strictly* nearest at the new point as well. Strictly,
   * so there is no tie to break and the first-past-the-post rule cannot come into it.
   *
   * That falls out as the region behaviour the tile-by-tile version had to pay for: deep inside a
   * face the gap between the nearest site and the next is wide and thousands of tiles are answered
   * by one subtraction, while along a border — exactly where two sites are near equidistant — the
   * gap closes, the test fails, and the ground is searched properly. Nobody had to decide where the
   * borders are; the gap knows.
   *
   * The one thing to be careful of is that the window, not just the block, decides the answer: a
   * site outside the window is not a candidate however near it is. So the certified answer is only
   * used when the winner is close enough to be inside the window wherever the window is — and when
   * it is not, the plain filtered search below runs and settles it the old way.
   */
  nearestIn(window: Square, x: number, z: number): Site | null {
    const block = this.gather(window);
    const sites = block.sites;
    // How far a site may be from this point and still be certainly within the window. Worked out
    // from the window rather than assumed to be half its width, because a caller is entitled to
    // ask about a point that is not in the middle of the square it is asking about.
    const reaches = Math.min(x - window.x0, window.x1 - x, z - window.z0, window.z1 - z);

    const near = block.near;
    if (near !== undefined) {
      const dx = x - near.x, dz = z - near.z;
      const stepped = dx * dx + dz * dz;
      const gap = near.second - near.best;
      // the winner is still strictly the nearest of the block: see the triangle inequality above
      if (gap > 0 && 4 * stepped < gap * gap) {
        // and it is still certainly inside the window, which is the other half of the question
        const room = reaches - near.best;
        if (room > 0 && stepped <= room * room) return near.owner;
      }
    }

    // the whole block, winner and runner-up together, so the next question can be answered from it
    let owner: Site | null = null;
    let best = Infinity, second = Infinity;
    for (let n = 0; n < sites.length; n++) {
      const one = sites[n];
      const away = (one.x - x) ** 2 + (one.z - z) ** 2;
      if (away < best) { second = best; best = away; owner = one; }
      else if (away < second) second = away;
    }

    /*
     * The block's nearest is the window's nearest, whenever it is near enough to be in the window.
     *
     * A site the window excludes is further than `reaches` in x or in z, and so further than
     * `reaches` outright. So if the nearest site of the whole block is within `reaches`, no
     * excluded site can beat it, and it is also the *first* of the block's minima — which is the
     * same one the filtered walk below would have kept, since that walk sees the same sites in the
     * same order with some of them missing.
     */
    if (owner !== null && reaches > 0 && best <= reaches * reaches) {
      block.near = { x, z, owner, best: Math.sqrt(best), second: Math.sqrt(second) };
      return owner;
    }

    // Otherwise the window really is what decides, and it is settled exactly as it always was.
    // Nothing is remembered from this: what was found is an answer about a window rather than about
    // the block, and the certificate above is only sound about the block.
    let held: Site | null = null;
    let nearest = Infinity;
    for (let n = 0; n < sites.length; n++) {
      const one = sites[n];
      if (one.x < window.x0 || one.x > window.x1 || one.z < window.z0 || one.z > window.z1) continue;
      const away = (one.x - x) ** 2 + (one.z - z) ** 2;
      if (away < nearest) { nearest = away; held = one; }
    }
    return held;
  }
}

/**
 * Does somebody better want the same ground?
 *
 * "Better" is the hashed rank, so two candidates never both stand and never both fall, and neither
 * has to know which cell asked first. The room in question is the larger of the two claims, so open
 * country pushes points apart even where it meets fine-grained country.
 *
 * Deliberately one pass rather than a settling: a candidate refused by a better one is refused,
 * whether or not that better one is itself refused by a third. A settling would pack a few more
 * points in and would need to know how the neighbours settled, which is the order-dependence this
 * exists to be rid of.
 */
function refusedBy(one: Site & { rank: number }, neighbours: Array<Site & { rank: number }>): boolean {
  for (const other of neighbours) {
    if (other.rank <= one.rank) continue;
    if (other.x === one.x && other.z === one.z) continue;
    const room = Math.max(one.claim, other.claim);
    const dx = other.x - one.x, dz = other.z - one.z;
    if (dx * dx + dz * dz < room * room) return true;
  }
  return false;
}

/**
 * The points of a patch of country, in no particular order and the same every time.
 *
 * Asks the cells the window covers, and the ring around it — because a point just outside can refuse
 * one just inside, and a patch that did not look would disagree with the same patch asked for as
 * part of something bigger, which is the one thing this exists to prevent.
 */
export function sitesIn(
  seed: number,
  spacing: (x: number, z: number) => number,
  dials: CellDials,
  window: { x0: number; z0: number; x1: number; z1: number },
): Site[] {
  return new Scatter(seed, spacing, dials).sitesIn(window);
}
