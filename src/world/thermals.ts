import { mulberry32 } from '../core/rng';

/**
 * Columns of warm air standing over the country, and where they are.
 *
 * A glider sinks, always, so on its own it is a way of spending height you have already climbed.
 * These are what turn that into flying: a column of air going up faster than the wing goes down,
 * standing in one place all day, so a pilot who knows where they are can cross a county by falling
 * from one to the next. They are the reason to look at the sky rather than at the ground.
 *
 * A pure function of position, like everything else this world is made of — no list, no spawner,
 * nothing stored. One column to a cell of `SPACING` tiles, thrown somewhere inside its own cell by
 * the cell's own number, so the network is irregular the way real ones are and is the same
 * irregular for everybody in the world.
 *
 * Deliberately not weather. A thermal here does not come and go with the hour: it is a fact about a
 * place — a bare hillside, a stretch of rock — and a place you can learn. Making it a fact about
 * the clock as well would mean flying somewhere and finding nothing, which is honest meteorology
 * and a bad afternoon.
 */

export const THERMAL = {
  /** How far apart the columns stand, in tiles. One to a cell of this side. */
  SPACING: 90,
  /**
   * How wide a column is, in tiles.
   *
   * Wide enough to *stay* in, which is the number that matters and is not the one that sounds
   * right. A wing turns at `GLIDE.TURN` and flies at `GLIDE.SPEED`, so the tightest circle it can
   * hold is about four tiles across; a column any narrower than twice that cannot be circled inside
   * at all, and lift you can only fly through in a straight line is lift you cannot use. Seven is
   * that circle with room to be sloppy, and still small enough on a map to be a place rather than a
   * region.
   */
  RADIUS: 7,
  /**
   * How hard the air goes up in the middle, in world units a second.
   *
   * Comfortably more than a glider sinks — see `GLIDE.SINK` — because a column that merely slowed
   * the descent would be a thing you could not tell you were in. It falls off toward the edge, so
   * the middle is worth finding rather than merely being inside.
   */
  RISE: 4.2,
  /**
   * How high a column carries you before it gives out, in world units above the ground under it.
   *
   * The ceiling is what stops the sky being a place you live: forty units is high enough to see the
   * shape of the country and cross most of what is between you and the horizon, and low enough that
   * the ground is still what the game is about.
   */
  CEILING: 40,
} as const;

/** A column of rising air: where it stands, and how high the ground is under it. */
export interface Thermal {
  x: number;
  z: number;
}

/** The one column belonging to a cell of the lattice, wherever inside the cell it landed. */
export function thermalIn(cx: number, cz: number, seed: number): Thermal {
  // the same shape of hash the rest of the world's lattices use: two integers and a seed in, one
  // repeatable stream out
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ (seed * 83492791));
  // kept off its own edges, so two columns in neighbouring cells cannot end up on top of each other
  const inset = THERMAL.RADIUS * 1.5;
  const span = THERMAL.SPACING - inset * 2;
  return {
    x: cx * THERMAL.SPACING + inset + rng() * span,
    z: cz * THERMAL.SPACING + inset + rng() * span,
  };
}

/**
 * How hard the air is going up at a point: nought outside every column, `THERMAL.RISE` in the
 * middle of one.
 *
 * The nine cells around the point rather than the one it is in, because a column near a cell's edge
 * reaches into its neighbour — the same bounded neighbourhood every other field in this world is
 * settled by, and the same reason.
 */
export function liftAt(x: number, z: number, seed: number): number {
  const cx = Math.floor(x / THERMAL.SPACING), cz = Math.floor(z / THERMAL.SPACING);
  let most = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const one = thermalIn(cx + dx, cz + dz, seed);
      const away = Math.hypot(one.x - x, one.z - z);
      if (away >= THERMAL.RADIUS) continue;
      // strongest in the middle and nothing at the rim, eased so there is no wall of air to hit
      const share = 1 - away / THERMAL.RADIUS;
      most = Math.max(most, THERMAL.RISE * share * share * (3 - 2 * share) / 1);
    }
  }
  return most;
}

/** Every column near a point, for whatever has to draw them. */
export function thermalsAround(x: number, z: number, within: number, seed: number): Thermal[] {
  const cx = Math.floor(x / THERMAL.SPACING), cz = Math.floor(z / THERMAL.SPACING);
  const reach = Math.ceil(within / THERMAL.SPACING);
  const out: Thermal[] = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const one = thermalIn(cx + dx, cz + dz, seed);
      if (Math.hypot(one.x - x, one.z - z) <= within) out.push(one);
    }
  }
  return out;
}
