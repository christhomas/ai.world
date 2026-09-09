/**
 * How a world's settlements are founded, when the road tree is not the one saying where.
 *
 * Two words and a hash, kept apart from the machinery that builds a village because they are the
 * whole of the seam between a world with an edge and a world without one. The road tree founds
 * villages at the towns it grew, laid out from one stream of randomness in the order the tree is
 * walked, a fixed number of them, no two sharing a name. Every one of those is an answer about a
 * whole world. An endless one hands over its own list instead, and asks that each village be drawn
 * from its own name.
 */

/**
 * Where a village stands, when it is not the road tree that says so.
 *
 * A place with a name of its own. That name is what makes a village a function of itself rather
 * than of everything founded before it: it names the village, and it seeds the randomness the
 * layout is drawn from, so the same town builds the same village whether it is the first of a
 * hundred or the only one anybody asked about.
 */
export interface Founding {
  id: string;
  name: string;
  x: number;
  z: number;
  level: number;
  /** How much village: a market town, an ordinary one, or a few cottages. */
  size: 'hub' | 'town' | 'village';
}

/**
 * How a world's settlements are founded, when the default will not do.
 *
 * The default is the road tree: villages at the towns it grew, laid out from one stream of
 * randomness in the order the tree is walked, with a fixed number of them in the world and no two
 * sharing a name. Every one of those is an answer about a whole world, and an endless one cannot
 * give any of them — so it hands over its own list instead, and asks that each village be drawn
 * from its own name.
 */
export interface Settling {
  /** The places to build. Given these, nothing is founded from the road tree at all. */
  towns: Founding[];
  /**
   * The crossroads of the patch: where a signpost may stand, and where somebody looking for a cave
   * or a wreck starts walking outward from.
   *
   * The road tree finds these by shuffling its nodes and taking them until it has enough, which is
   * a count about a whole world. A place holds one because of what it is, or it does not.
   */
  posts?: Array<{ id: string; x: number; z: number }>;
  /**
   * Every settlement the patch can see, including the ones outside it.
   *
   * A signpost points at what is around it, and most of what is around the edge of a patch is in
   * the next one. Names rather than villages, because a town has its name before anybody builds it.
   */
  neighbours?: Array<{ name: string; x: number; z: number }>;
}

/** A place's name as a number, so the village standing on it can be drawn from it. */
export function hashOfPlace(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
