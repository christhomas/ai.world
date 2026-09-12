import type { WorldKind } from '../save/store';
import { samplerIn } from './endless';
import { roadTreeWorld, type RoadGraph } from './graph';
import type { Anchor } from './manifest';
import type { TerrainSampler } from './terrain';
import type { Within } from './window';

/**
 * The one place a world is grown, and the reason there is only one.
 *
 * This game is two halves that both grow the landscape. The page grows it to draw it; the world
 * grows it to walk heroes and creatures across it. For most of this project's life each of them
 * reached for the generator itself and wrote down its own idea of how to call it — and every time
 * those two expressions drifted apart, the result was a player standing in a country nobody else
 * could see. Twice now, in two different ways: once by growing the wrong *kind* of world, and once
 * by growing the right kind without its islands. The second one put a hero in a named village
 * standing in an empty field, because the people came from one country and the houses from another.
 *
 * Neither of those was a bug in the generator. Both were bugs in the *calling* of it, which is a
 * kind of bug no amount of care inside `roadweb.ts` or `graph.ts` can prevent. So the call itself
 * became the thing worth having exactly once. Everything a country is a function of is an argument
 * here, every argument travels with the join, and there is no second expression anywhere in the
 * game that could say it differently.
 *
 * `growworld.test.ts` is what keeps that true: it reads the source of the game and the server and
 * fails if anything but this file names the generators. A world grown in one place can then only be
 * grown the same way in another, and `twohalves.test.ts` stops being the thing that stands between
 * a player and a country he cannot see.
 */

/**
 * The country of a seed: the roads, the towns and the islands, and nothing that is drawn.
 *
 * `kind` because a seed is not a world. The same number grows a polygon country of mountains and
 * hexagonal road cells, or the older road tree with its branching sprawl of land, and they share
 * nothing whatever — a village in one is open sea in the other. It comes from the save, travels
 * with the join, and is never decided by whichever half is asking.
 *
 * `islands` because the seed does not quite settle a road-tree world on its own. Where the islands
 * hang is planned from the seed, so a world made today has them where `islandAnchors` says — but a
 * world saved before that code existed has them written down in its manifest, and moving them would
 * move the ground out from under a house somebody built on one. So the anchors a page is playing
 * with are handed in rather than worked out here, and they travel with the join for exactly the
 * same reason `kind` does. Left out, the seed's own answer stands, which is what every fresh world
 * gets.
 *
 * A polygon world has no islands to hang, so the argument is quietly ignored for one. That is not
 * an oversight worth guarding against: handing anchors to a world that has no use for them is the
 * page saying what it has, and the answer being the same either way is the point.
 */
export function growWorld(seed: number, kind: WorldKind, islands?: readonly Anchor[]): RoadGraph {
  void kind;                                 // one country now: see `WorldKind`
  return roadTreeWorld(seed, islands ? [...islands] : undefined);
}

/**
 * The endless country, one patch of it, and the same rule about there being one caller.
 *
 * The bounded world has a country that exists all at once, so growing it is one call with the whole
 * of it inside. The endless one has no such moment: what exists is whatever somebody has walked
 * into, grown a 512-tile square at a time, and a square is grown by the page to draw it and by the
 * worker that grows it ahead of the page — and, when the world's half catches up, by the server to
 * walk heroes across it.
 *
 * That is three callers of the same generator, which is exactly the shape that has twice put a
 * player in a country nobody else could see. So it goes through here for the same reason
 * `growWorld` does: every argument a patch is a function of is an argument to this, there is no
 * second expression anywhere that could say it differently, and `growworld.test.ts` fails the build
 * if one appears.
 *
 * A patch is a function of the seed and of where it is, and of nothing else — not of who is asking,
 * not of what has already been grown, not of the order anybody walked. That is what lets a worker
 * hand a finished patch to a page, and what will let a server hand one to both.
 */
export function growPatch(seed: number, within: Within): TerrainSampler {
  return samplerIn(seed, within);
}

/**
 * A fingerprint of a whole country, small enough to send with a hello.
 *
 * Chunks of ground travel down the wire now, so the two halves cannot disagree about the height of
 * a tile. Everything *derived* from the country still does not travel: the villages and who lives
 * in them, the doors, the eyries on the crags, where a ferry ties up. Those are worked out on each
 * side from its own graph, and they are right only for as long as the two graphs are the same
 * graph.
 *
 * `growWorld` above is what makes them the same. This is what proves it, at the one moment it can
 * be proved cheaply: the world sends its own fingerprint when a player joins and the page compares
 * it with its own. Equal means the two halves are demonstrably in one country rather than
 * presumably in one. Different means something the game could otherwise only find out as a hero
 * standing in an empty field — a page and a server built from different commits, most likely — and
 * it can be said out loud instead.
 *
 * The graph rather than the structures, because the graph is upstream of all of them: two equal
 * graphs put the same villages in the same places with the same names, and there is nothing derived
 * from a country that is not derived from this.
 */
export function countryStamp(graph: RoadGraph): string {
  let h = 0x811c9dc5;
  const eat = (n: number): void => { h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0; };
  eat(graph.seed);
  eat(graph.nodes.length);
  eat(graph.edges.length);
  // rounded to a thousandth: a node's place is a float, and a fingerprint that changes with the
  // last bit of one would be a fingerprint that fails on a machine that adds in a different order
  for (const n of graph.nodes) { eat(Math.round(n.x * 1000)); eat(Math.round(n.z * 1000)); eat(n.level); }
  for (const e of graph.edges) { eat(e.a); eat(e.b); }
  for (const t of graph.towns) eat(t);
  for (const isle of graph.islands) { eat(isle.seed); eat(Math.round(isle.x)); eat(Math.round(isle.z)); eat(isle.hub); }
  return h.toString(16).padStart(8, '0');
}
