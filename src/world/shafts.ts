import { mulberry32 } from '../core/rng';

/**
 * Holes in the ground with something under them.
 *
 * Every other way underground in this game is a door somebody built or a mouth in a cliff you can
 * walk into. These are neither: a shaft straight down through the rock, too narrow to climb and too
 * deep to jump, standing open in the middle of the country with nothing round it but grass. You
 * cannot get into one by being brave. You get into one by having a parachute in your pack, and
 * until you do it is scenery you walk round.
 *
 * That is the whole design and it is the reason they are worth having: a place in plain sight that
 * a player cannot reach until they have gone and bought the thing that reaches it. Everything else
 * in the world opens to persistence — walk far enough, fight hard enough — and this opens to
 * equipment, which makes buying the equipment a decision about where you can go rather than a
 * number on a sheet.
 *
 * A field, like the thermals and the whirlpools: one to a cell, thrown inside it by the cell's own
 * number, the same in every session and different in every world. Whether the spot is any good —
 * land rather than sea, open rather than under a house — is a question about the country, so it is
 * asked by whoever has the country to hand and not here.
 */

export const SHAFT = {
  /**
   * How far apart they stand, in tiles.
   *
   * Rarer than a thermal and commoner than a whirlpool. A hundred and sixty tiles is a walk of a
   * couple of minutes, so a player crossing a county passes one or two — enough that they are a
   * feature of the country rather than a curiosity, and few enough that finding one is still worth
   * saying out loud.
   */
  SPACING: 160,
  /**
   * How wide the mouth is, in tiles.
   *
   * Two and a half: wider than a hero, narrow enough to walk past without noticing if you are not
   * looking, and — this is the part that matters — small enough that stepping into it has to be
   * something you did on purpose.
   */
  MOUTH: 2.5,
} as const;

export interface Shaft {
  x: number;
  z: number;
  /** What the hollow under it hangs off, for ever. */
  id: string;
  name: string;
}

const NAMES = [
  'The Deep Hollow', 'Nobody\'s Well', 'The Long Drop', 'The Swallet',
  'The Old Shaft', 'The Blind Pit', 'The Sink', 'The Chimney',
];

/** The one shaft belonging to a cell of the lattice. */
export function shaftIn(cx: number, cz: number, seed: number): Shaft {
  const rng = mulberry32((cx * 2654435761) ^ (cz * 2246822519) ^ (seed * 3266489917));
  const inset = SHAFT.MOUTH * 3;
  const span = SHAFT.SPACING - inset * 2;
  const x = Math.round(cx * SHAFT.SPACING + inset + rng() * span);
  const z = Math.round(cz * SHAFT.SPACING + inset + rng() * span);
  return { x, z, id: `shaft:${x},${z}`, name: NAMES[Math.floor(rng() * NAMES.length)] };
}

/** Every shaft near a point: what the ground has to draw, and what a walker might step into. */
export function shaftsAround(x: number, z: number, within: number, seed: number): Shaft[] {
  const cx = Math.floor(x / SHAFT.SPACING), cz = Math.floor(z / SHAFT.SPACING);
  const reach = Math.ceil(within / SHAFT.SPACING);
  const out: Shaft[] = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const one = shaftIn(cx + dx, cz + dz, seed);
      if (Math.hypot(one.x - x, one.z - z) <= within) out.push(one);
    }
  }
  return out;
}

/** The shaft somebody is standing over, or null for ordinary ground. */
export function overAShaft(x: number, z: number, seed: number): Shaft | null {
  for (const one of shaftsAround(x, z, SHAFT.SPACING, seed)) {
    if (Math.hypot(one.x - x, one.z - z) <= SHAFT.MOUTH) return one;
  }
  return null;
}
