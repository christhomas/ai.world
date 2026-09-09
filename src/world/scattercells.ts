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
  // a cell no smaller than the largest claim, so a candidate can only be refused from next door
  const cell = dials.far;
  const lowI = Math.floor(window.x0 / cell) - 1, highI = Math.floor(window.x1 / cell) + 1;
  const lowJ = Math.floor(window.z0 / cell) - 1, highJ = Math.floor(window.z1 / cell) + 1;

  const near = (ci: number, cj: number): Array<Site & { rank: number }> => {
    const all: Array<Site & { rank: number }> = [];
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) all.push(...candidates(seed, cell, i, j, dials, spacing));
    }
    return all;
  };

  const kept: Site[] = [];
  for (let cj = lowJ; cj <= highJ; cj++) {
    for (let ci = lowI; ci <= highI; ci++) {
      const neighbours = near(ci, cj);
      for (const one of candidates(seed, cell, ci, cj, dials, spacing)) {
        /*
         * It stands unless somebody better wants the same ground.
         *
         * "Better" is the hashed rank, so two candidates never both stand and never both fall, and
         * neither has to know which cell asked first. The room in question is the larger of the two
         * claims, so open country pushes points apart even where it meets fine-grained country.
         *
         * Deliberately one pass rather than a settling: a candidate refused by a better one is
         * refused, whether or not that better one is itself refused by a third. A settling would
         * pack a few more points in and would need to know how the neighbours settled, which is the
         * order-dependence this exists to be rid of.
         */
        const refused = neighbours.some((other) => {
          if (other === one || other.rank <= one.rank) return false;
          if (other.x === one.x && other.z === one.z) return false;
          const room = Math.max(one.claim, other.claim);
          const dx = other.x - one.x, dz = other.z - one.z;
          return dx * dx + dz * dz < room * room;
        });
        if (refused) continue;
        if (one.x < window.x0 || one.x > window.x1 || one.z < window.z0 || one.z > window.z1) continue;
        kept.push({ x: one.x, z: one.z, claim: one.claim, id: one.id });
      }
    }
  }
  return kept;
}
