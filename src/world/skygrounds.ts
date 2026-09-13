import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import type { SkyGround } from './skyisland';
import type { Within } from './window';

/**
 * Where a country with no edge could hang a village in the clouds.
 *
 * Item 85. A sky island is planned over an *island* — a sub-tree of roads with a harbour town on it,
 * which is a road-tree idea and belongs to a country planned all at once. An endless patch's graph
 * has an empty island list and always will, so the endless world had mountains, and eagles on them
 * once **83** gave the peaks a size, and nothing at all above them.
 *
 * What an island was actually *for* here is a centre with some reach: somewhere with land under it,
 * far enough from a mountain that the range does not come up through the village square, and offset
 * enough that you can see coast on one side and open water on the other. None of that needs a road
 * tree. So a patch draws its own, on a stream of its own, and the planner that was already written
 * does the rest.
 *
 * Two rules it inherits from everything else in this world and must not break. It is a function of
 * the seed and of *where*, and of nothing else — not of what has been grown, not of who is asking,
 * not of the order anybody walked — so a patch grown twice hangs its island in the same place, and
 * two machines agree without a word crossing the wire. And it never grows country to answer: the
 * land test is the patch's own sampler, which is the square this is being asked about.
 */

/** How many places a patch offers the planner. It keeps at most `SKY.MOST` of them. */
const OFFERED = 6;

/**
 * How far a patch's ground is said to reach, in tiles.
 *
 * Stated rather than measured, and that is the honest way round. In a road world an island is a
 * real landmass and its radius is a fact about it; in an endless one the land is continuous and
 * there is no edge to measure to, so there is no fact to read. What the number is actually used for
 * is the size of the island and how far off its centre it sits, and this is the band that gives the
 * planner its whole range — `SKY.SHRINK` takes it to between the smallest and largest it will draw.
 */
const REACH = { LEAST: 62, MOST: 108 };

/** How far apart two of them have to stand, so a patch does not offer the same spot twice. */
const APART = 140;

export function skyGroundsIn(
  seed: number,
  within: Within,
  /** Whether there is dry land at a point. The patch's own sampler, never a grown one. */
  land: (x: number, z: number) => boolean,
): SkyGround[] {
  // salted by the square as well as the seed, so the country either side of a boundary is drawn on
  // streams that have nothing to do with each other and a patch is the same patch grown alone
  const rng = mulberry32(derive(seed, SALT.SKY) ^ (Math.imul(within.x0, 0x9e3779b1) ^ within.z0));
  const out: SkyGround[] = [];
  // inset, so a village in the clouds belongs to one square rather than straddling two: an island
  // hanging over a boundary would be planned by both patches and drawn twice
  const margin = REACH.MOST;
  const x0 = within.x0 + margin, z0 = within.z0 + margin;
  const wide = Math.max(1, (within.x1 - within.x0) - margin * 2);
  const deep = Math.max(1, (within.z1 - within.z0) - margin * 2);

  for (let tries = 0; tries < 40 && out.length < OFFERED; tries++) {
    const x = Math.round(x0 + rng() * wide);
    const z = Math.round(z0 + rng() * deep);
    if (!land(x, z)) continue;
    if (out.some((one) => Math.hypot(one.x - x, one.z - z) < APART)) continue;
    out.push({ id: `ground:${x},${z}`, x, z, radius: Math.round(REACH.LEAST + rng() * (REACH.MOST - REACH.LEAST)) });
  }
  return out;
}
