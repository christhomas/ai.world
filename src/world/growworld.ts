import { samplerIn } from './endless';
import { inOrder } from './elevation';
import type { RoadGraph } from './graph';
import type { Highland } from './highland';
import { planIslands, roadTreeWorld } from './roadtree';
import type { Anchor, Manifest } from './manifest';
import type { TerrainSampler } from './terrain';
import type { Within } from './window';

/**
 * The one place a world is grown, and the reason there is only one.
 *
 * This game is two halves that both grow the landscape. The page grows it to draw it; the world
 * grows it to walk heroes and creatures across it. Every patch therefore passes through this one
 * call, so the two halves cannot quietly acquire different ways of making the same place.
 *
 * Neither of those was a bug in the generator. Both were bugs in the *calling* of it, which is a
 * kind of bug no amount of care inside a generator can prevent. So the call itself became the
 * thing worth having exactly once.
 *
 * `growworld.test.ts` is what keeps that true: it reads the source of the game and the server and
 * fails if anything but this file names the generators.
 */

/**
 * The country of a seed, when the seed grows one that exists all at once: the roads, the towns and
 * the islands, and nothing that is drawn.
 *
 * `islands` because the seed does not quite settle a road-tree world on its own. Where the islands
 * hang is planned from the seed, so a world made today has them where `islandAnchors` says — but a
 * world saved before that code existed has them written down in its manifest, and moving them would
 * move the ground out from under a house somebody built on one. So the anchors a page is playing
 * with are handed in rather than worked out here, and they travel with the join. Left out, the
 * seed's own answer stands, which is what every fresh world gets.
 */
export function growWorld(seed: number, islands?: readonly Anchor[]): RoadGraph {
  return roadTreeWorld(seed, islands ? [...islands] : undefined);
}

/**
 * A world's islands: the ones it was saved with, or the ones its seed says it should have.
 *
 * Written down the moment they are known, so a world saved today is saved with them and a world
 * saved yesterday keeps the ones it had. Here rather than in `country.ts` for the reason everything
 * else here is: where the islands hang is one of the things a country is a function of, so it is
 * worked out in the one place that grows one.
 */
export function islandsFor(manifest: Manifest, seed: number): readonly Anchor[] {
  const saved = manifest.byKind('island');
  if (saved.length > 0) return saved;
  for (const p of planIslands(roadTreeWorld(seed), seed)) manifest.ensure(p.id, 'island', p.x, p.z);
  return manifest.byKind('island');
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
 * player in a country nobody else could see. Every argument a patch is a function of is therefore
 * an argument to this; there is no
 * second expression anywhere that could say it differently, and `growworld.test.ts` fails the build
 * if one appears.
 *
 * A patch is a function of the seed and of where it is, and of nothing else — not of who is asking,
 * not of what has already been grown, not of the order anybody walked. That is what lets a worker
 * hand a finished patch to a page, and what will let a server hand one to both.
 */
export function growPatch(
  seed: number, within: Within, layers: readonly Highland[] = [],
): TerrainSampler {
  return samplerIn(seed, within, layers);
}

/**
 * A world's elevation layers: the ones it was saved with, and nothing else.
 *
 * `islandsFor` above with a different noun, and for the same reason. Where a mountain is put is one
 * of the things a country is a function of, so it is read in the one place a country is grown — and
 * it is read from the manifest rather than from the seed, because a layer list is the one part of a
 * world that somebody *chose*. Nothing derives it: a world with no layers has none, which is every
 * world saved to this day.
 *
 * Write-once, which the manifest already is: an anchor is written the moment it is known and never
 * moved, *"because a world saved before that code existed has them somewhere else, and moving them
 * would move the ground out from under a house somebody built on one"*. A layer list that could be
 * changed afterwards would move the ground under everything in the world at once, so it is a fact
 * about a world and never a setting. #324 is where an editor gets to add to one.
 */
export function elevationFor(manifest: Manifest): readonly Highland[] {
  const out: Highland[] = [];
  for (const anchor of manifest.byKind('highland')) {
    // a highland anchor with no shape on it is not a layer: it is a place, saved by something else
    if (anchor.layer) out.push({ x: anchor.x, z: anchor.z, ...anchor.layer });
  }
  return out;
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
 * `growPatch` above is what makes them the same. This is what proves it, at the one moment it can
 * be proved cheaply: the world sends its own fingerprint when a player joins and the page compares
 * it with its own. Equal means the two halves are demonstrably in one country rather than
 * presumably in one. Different means something the game could otherwise only find out as a hero
 * standing in an empty field — a page and a server built from different commits, most likely — and
 * it can be said out loud instead.
 *
 * The graph rather than the structures, because the graph is upstream of all of them: two equal
 * graphs put the same villages in the same places with the same names, and there is nothing derived
 * from a country that is not derived from this — *and from the layer list beside it*, which is the
 * other thing the ground is a function of and therefore the other thing this has to hash. A world
 * is a seed and a short list; a fingerprint of half of that would say two worlds agree while every
 * tile under a mountain stood at a different height in each.
 */
/**
 * Why two halves are not in the same country, in words, or null if they are.
 *
 * Here rather than in the page, because the sentence is about what a country *is* and this file is
 * where that is decided. It exists at all because the version the page had said the only thing it
 * could — two hex numbers and the news that they differ — and the commonest cause by far is not a
 * generator that drifted but two halves that grew different *kinds* of country, which the hashes
 * cannot tell you and which the kinds say outright.
 *
 * The kinds are checked first for that reason. A bounded country and an endless one have no reason
 * whatever to hash alike, so comparing their stamps is comparing two answers to different
 * questions; a page told so knows what to do about it, where a page shown `3b564cc4` against
 * `1d825025` knows only that something is wrong.
 *
 * `theirs` may be empty and `theirKind` missing: a world that grows no ground says nothing, and one
 * older than the field says nothing about its kind. Both are silence rather than disagreement.
 */
export function whyCountriesDiffer(mine: string, theirs: string): string | null {
  if (!theirs || theirs === mine) return null;
  return `This world grew differently here (${mine}) and in the world you joined (${theirs}).`;
}

export function countryStamp(graph: RoadGraph, layers: readonly Highland[] = []): string {
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
  /*
   * And the layers, because they are the other half of what the ground is a function of.
   *
   * A stamp that hashed the graph and not the list would report agreement between two worlds whose
   * every tile under a mountain stands at a different height — and it is the only question either
   * half asks before it believes the other, so the silence would last until somebody noticed a
   * hero walking through a hillside. Rounded to a thousandth for the reason the nodes are, and read
   * in `inOrder`'s order so that two halves holding the same list differently sorted still agree.
   */
  eat(layers.length);
  for (const l of inOrder(layers)) {
    eat(Math.round(l.x * 1000)); eat(Math.round(l.z * 1000));
    eat(Math.round(l.reach * 1000)); eat(Math.round(l.lift * 1000));
  }
  return h.toString(16).padStart(8, '0');
}
