import { rand2 } from '../core/rng';
import { SALT, TILE_SALT, derive } from '../core/salts';
import { Simplex2D } from './noise';

/**
 * Which of a biome's two greens a tile of open ground is, and why it is not a coin flip.
 *
 * Every flat tile used to decide this for itself:
 *
 * ```ts
 * rand2(seed, tx, tz, TILE_SALT.GROUND_VARIANT) < GROUND_ALT_CHANCE
 * ```
 *
 * which is white noise at exactly one tile of wavelength. White noise at the scale of the grid
 * **is** a checkerboard: the eye has nothing else at that frequency to attribute it to, so it
 * attributes it to the grid, and the ground stops reading as ground and starts reading as tiles.
 * Standing in a field you could count the squares.
 *
 * A meadow is not chequered. It is blotched, at four or five paces, and the blotches have soft
 * edges — one patch of ground is a little darker than the next because it is wetter or has been
 * grazed, and that is a fact about a piece of country rather than about each square foot of it
 * separately. So the choice is read off a noise field with a wavelength of about eight tiles,
 * which is the size of a blotch somebody would notice as a blotch.
 *
 * The edge between two blotches is then dithered with the old per-tile hash, over about a fifth of
 * the range. Without it the boundary is a smooth contour, and a smooth contour drawn in tiles is a
 * staircase — which is the grid showing through again by another route. With it the two greens
 * interleave for a tile or two at the join, the way they do where real grass changes.
 *
 * ## Still a pure function of the seed and the place
 *
 * No draw is added to any stream and nothing is remembered: a patch re-grown on another machine,
 * or re-grown here after being dropped, comes out the same. The noise is built once per seed and
 * kept, because a `Simplex2D` is a 512-byte table and a chunk asks this question four thousand
 * times.
 */

/**
 * How many tiles across one blotch of the darker green is, roughly.
 *
 * Twelve, which is twelve metres. Eight was tried first and is too small: the second octave of the
 * field then has a four-tile wavelength, and four tiles is close enough to one that the grid starts
 * to show again — measured, it disagrees with its eastern neighbour a fifth of the time against an
 * eighth at twelve.
 */
const BLOTCH = 12;

/** How much of the decision the per-tile hash is allowed to move, so the join is dithered. */
const FRAY = 0.08;

const fields = new Map<number, Simplex2D>();

function fieldFor(seed: number): Simplex2D {
  let noise = fields.get(seed);
  if (!noise) {
    noise = new Simplex2D(derive(seed, SALT.MEADOW));
    fields.set(seed, noise);
  }
  return noise;
}

/**
 * Whether the tile at these world coordinates takes the biome's alternate green.
 *
 * The share of ground that comes back true is `GROUND_ALT_CHANCE`, near enough — which matters
 * because `props.ts` branches on the answer and `landmarks.ts` accepts both, so this is not only a
 * colour and its proportions should not drift when its shape changes.
 */
export function alternateGround(seed: number, x: number, z: number): boolean {
  const field = fieldFor(seed);
  // two octaves: the blotch, and a coarser drift across it so a field is not a repeating pattern
  const blotch = field.fbm(x / BLOTCH, z / BLOTCH, 2);
  const frayed = blotch + (rand2(seed, x, z, TILE_SALT.GROUND_VARIANT) - 0.5) * FRAY * 2;
  return frayed < ALT_BELOW;
}

/**
 * Where the cut sits, so that the share of alternate ground stays the share it was.
 *
 * Two octaves of simplex plus a dither is not a uniform distribution — it bunches around zero — so
 * the cut is not `2 * GROUND_ALT_CHANCE - 1` and cannot be derived from it. It is measured, and
 * `meadow.test.ts` is what holds it to `GROUND_ALT_CHANCE` over a large enough piece of country to
 * mean something.
 */
const ALT_BELOW = -0.15;

/** How many tiles across one swell of light and shade is. Smaller than a blotch, so the two read as different things. */
const SWELL = 5;

/**
 * How much lighter or darker one tile of ground is than its biome's flat colour, as a multiplier.
 *
 * The second half of the same fault. `mesher.ts` multiplied every tile by an independent hash in
 * `[0.94, 1.06]`, which is the checkerboard again one layer up and in a subtler colour: not two
 * greens alternating but every tile a slightly different green from all four of its neighbours, so
 * even ground that was all one type read as static.
 *
 * It is worth keeping rather than deleting, because ground of a single flat colour reads as a
 * painted floor. What it wants is a wavelength: a shallow swell of light and shade across a field,
 * a few paces between crest and trough, the way ground looks when it is very slightly uneven.
 * Shorter than a blotch, so the two are not the same shape twice — a swell that lined up with a
 * blotch would make each patch a solid tile of its own shade, which is a bigger checkerboard.
 *
 * The range is the range it was, so nothing about how light or dark the world is has changed.
 */
export function groundShade(seed: number, x: number, z: number, lowest: number, range: number): number {
  const swell = fieldFor(seed).noise(x / SWELL + 0.5, z / SWELL + 0.5);
  // simplex is roughly [-1, 1] and bunched around nought; half a range either side of the middle
  return lowest + range * Math.min(1, Math.max(0, 0.5 + swell * 0.5));
}
