import { mulberry32 } from '../core/rng';

/**
 * The places where the sea goes down, and what is under them.
 *
 * A world with a boat in it needs somewhere to sail *to*, and until now the sea was scenery with
 * fish in it. These are the other thing it can be: a slow turning patch of water, wide enough to
 * see and wide enough to steer round, which takes a boat that sails into it and puts whoever was in
 * it in a cavern below — badly hurt, always, and sometimes very nearly dead.
 *
 * The bargain is the whole point and it is deliberately a bad one to take carelessly. Going down
 * costs at least half of everything you have and may cost all of it; what is down there is worth
 * twice the treasure of anywhere else. Nobody should ever be *sure* they will survive it, and
 * anybody who wants the gamble should be able to find one on purpose.
 *
 * A field like the thermals and the road lattice: one to a cell, thrown inside its own cell by the
 * cell's own number, so they are in the same places for everybody in a world and in different
 * places in the next one. Nothing stored, nothing spawned, nothing to keep in step.
 */

export const MAELSTROM = {
  /**
   * How far apart they stand, in tiles.
   *
   * Rare. Four hundred is a long day's sail, so most crossings meet none at all and finding one is
   * an event rather than a hazard of being on the water — which is what keeps the sea worth sailing
   * for its own sake.
   */
  SPACING: 400,
  /**
   * How wide the turning water is, in tiles.
   *
   * Twelve across: big enough to read as a place from the deck of a boat and to be steered around
   * once seen, and small enough that a course held straight through open water usually misses it.
   */
  RADIUS: 6,
  /** How near the middle a hull must come before it is taken, in tiles. */
  MOUTH: 2.6,
  /** The least and most of your hearts it costs to be taken down. See `tollOf`. */
  TOLL: { least: 0.5, most: 1 },
} as const;

export interface Maelstrom {
  x: number;
  z: number;
  /** What the cavern under it is called, and what its floors hang off for ever. */
  id: string;
  name: string;
}

const NAMES = [
  'The Drowned Hall', 'Blackwater Deep', 'The Sunken Vault', 'The Weeping Cavern',
  'The Cold Mouth', 'The Kelp Halls', 'Fathom Deep', 'The Swallow',
];

/** The one whirlpool belonging to a cell of the lattice. */
export function maelstromIn(cx: number, cz: number, seed: number): Maelstrom {
  const rng = mulberry32((cx * 40503) ^ (cz * 28657) ^ (seed * 104729));
  const inset = MAELSTROM.RADIUS * 2;
  const span = MAELSTROM.SPACING - inset * 2;
  const x = Math.round(cx * MAELSTROM.SPACING + inset + rng() * span);
  const z = Math.round(cz * MAELSTROM.SPACING + inset + rng() * span);
  return {
    x, z,
    // by where it is rather than by its name: two cells could pick the same name out of the list,
    // and a cavern's anchor has to be its own for ever
    id: `sunken:${x},${z}`,
    name: NAMES[Math.floor(rng() * NAMES.length)],
  };
}

/** Every whirlpool near a point: what the water has to draw, and what a hull has to watch for. */
export function maelstromsAround(x: number, z: number, within: number, seed: number): Maelstrom[] {
  const cx = Math.floor(x / MAELSTROM.SPACING), cz = Math.floor(z / MAELSTROM.SPACING);
  const reach = Math.ceil(within / MAELSTROM.SPACING);
  const out: Maelstrom[] = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const one = maelstromIn(cx + dx, cz + dz, seed);
      if (Math.hypot(one.x - x, one.z - z) <= within) out.push(one);
    }
  }
  return out;
}

/** The one a hull at this point has sailed into, or null for the ordinary sea. */
export function swallowing(x: number, z: number, seed: number): Maelstrom | null {
  for (const one of maelstromsAround(x, z, MAELSTROM.SPACING, seed)) {
    if (Math.hypot(one.x - x, one.z - z) <= MAELSTROM.MOUTH) return one;
  }
  return null;
}

/**
 * How much of everything you have it costs to be taken down, as a share.
 *
 * Between a half and all of it, and which is not knowable beforehand — that uncertainty *is* the
 * feature. Rolled off the whirlpool's own position and the day rather than off a random number, so
 * that the same descent on the same day costs the same whoever is watching: two people in a world
 * must not disagree about whether somebody survived.
 */
export function tollOf(one: Maelstrom, seed: number, day: number): number {
  const rng = mulberry32((one.x * 15485863) ^ (one.z * 32452843) ^ (seed * 49979687) ^ (day * 15487469));
  return MAELSTROM.TOLL.least + rng() * (MAELSTROM.TOLL.most - MAELSTROM.TOLL.least);
}
