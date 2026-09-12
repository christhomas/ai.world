import type { Simplex2D } from './noise';

/**
 * The strip of country a road runs through: how wide it is, and how far across it you are.
 *
 * Two numbers, and everything about how the ground looks between one road and the next is decided
 * by them. The width says how much countryside a road has either side of it. The share says where
 * in that countryside a tile stands, nought at the verge and one at the far side — and the ground
 * rises across it, so it is the share and not the distance that decides how many terraces a tile
 * stands above the road it belongs to.
 *
 * ## Why they are here rather than in `terrain.ts`
 *
 * Because they were asked two ways and gave two answers, and one of the two was silently nought.
 *
 * A world with an edge has land in a band round its roads: the width of that band is written on
 * the road itself, and the far side of it is the sea. A country with no edge has land that is a
 * *shape* — a coastline out of noise, with roads laid on whatever is dry — so an edge there has no
 * honest band to report and `localgraph.ts` writes `Infinity`, which is the truthful answer to a
 * question that should not have been asked. One of the two call sites in `terrain.ts` knew that
 * and used the fixed width below; the other took the edge at its word, divided by infinity, and
 * got nought. Nought across the countryside means no rise anywhere, so every tile in the endless
 * world stood at exactly the level of its nearest road: no terraces stepping away from a road, no
 * high ground above them, a whole country drawn as one rounded swell where the rest of this game
 * is drawn in steps.
 *
 * That is not a bug you can see by reading either call site. It is a bug you can only see by
 * reading both at once — which is the argument for a rule having one home rather than two.
 */

/**
 * How wide the countryside is where the land is a shape rather than a band, in tiles.
 *
 * The band no longer decides where land ends — a coastline does — but the width still has readers:
 * the rivers size themselves by it, landmarks are set at a fraction of it, and the ground steps up
 * across it. So it stays the width of the country a road runs through rather than becoming the
 * radius of the world, which drowned the map in rivers and bridges.
 *
 * Kept near the old world's widest, so everything tuned against it stays in the range it was tuned
 * for. That is what makes an endless country come out looking like the bounded one rather than
 * like a second game: the same relief, the same number of terraces between a road and the country
 * behind it, laid over ground that happens to have no edge.
 */
export const COUNTRY_WIDTH = 22;

/**
 * How wide the countryside is beside one road, in tiles.
 *
 * `shaped` is whether the land is a shape — a mesh or a patch — rather than a band round the road.
 * Where it is, the answer is the fixed width above and the edge is not consulted at all, which is
 * the whole point: an edge in a country with no coastline written on it has nothing to say here.
 *
 * Where it is not, the road's own width wanders a little with the ground, because a country that
 * was exactly the same width for the length of a road would read as a corridor. The floor keeps a
 * verge either side of the cobbles however narrow the wander makes it.
 */
export function widthBeside(
  shaped: boolean,
  edge: { roadWidth: number; width: number },
  noise: Simplex2D,
  px: number,
  pz: number,
): number {
  if (shaped) return COUNTRY_WIDTH;
  const wander = noise.fbm(px * 0.06, pz * 0.06, 2);
  return Math.max(edge.roadWidth + 2.5, edge.width * (1 + 0.42 * wander));
}

/**
 * How far across the countryside a point is: nought at the verge of the road, one at the far side.
 *
 * Held to one, which costs a world with an edge nothing whatever — out there the land *is* the
 * band, so anything past the far side is sea and was answered long before this. A country whose
 * land is a shape has no such promise: a road may be sixty tiles from the next one over open
 * ground, and unclamped the same rule that gives a bounded world four terraces of relief would
 * give an endless one seventeen. That is not stepped country, it is a flight of stairs to the sky.
 */
export function acrossCountry(away: number, roadWidth: number, width: number): number {
  return Math.min(1, (away - roadWidth) / (width - roadWidth));
}
