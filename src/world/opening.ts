import type { Village } from './structures';

/**
 * Where a world opens: the village a hero stands in on the first frame of a world nobody has
 * stood in before.
 *
 * ## What this is, and what #299 turned out not to be
 *
 * #299 said of the endless country that it *"is darker and more crowded — roofs went from red to
 * olive, trees multiplied, contrast dropped"*. #395 measured it and the charge is false as a
 * property of the generator: one `BIOMES` table feeds both countries and, sampled over a full turn
 * on rings from 60 to 400 tiles, they are the same country — mean ground luminance 0.393–0.400
 * against 0.399–0.403, mean `propDensity` 0.1624–0.1661 against 0.1597–0.1652, six wedges of six
 * biomes in each. `twocountries.test.ts` holds that.
 *
 * What was actually lost with the road tree is the **opening**. `roadtree.ts` plants its hub at
 * the literal origin and flattens the ground under it, `graph.ts: sectorMix` keeps plains for 39
 * tiles around the same point, and `structures.ts` builds Crossroads Town on top — so a road world
 * opens inside a town, on a meadow, with red roofs on it: Crossroads Town stands at exactly 0,0 in
 * Plains on all ten seeds scanned below, as it did on the five #395 measured.
 *
 * An endless country has no hub, and `main.ts` had one answer for where a fresh hero stands: the
 * origin. So a fresh endless world opened **in an empty field**. Measured by scanning seeds 3, 4,
 * 5, 7, 11, 13, 17, 19, 23 and 29 through `growPatch(seed, boundsOf(HOME_PATCH))`:
 *
 *     nearest village to the origin   36  67  91  149  165  198  202  269  361  514 tiles
 *
 * — and on seven of those ten the ground the hero opened on was not the meadow `sectorMix` holds
 * there either, because nothing in the endless country flattens the origin the way `roadtree.ts`
 * flattens its hub: `TerrainSampler.biomeOf` calls high ground Mountain and higher ground Snow
 * whatever the pie says, and the origin came out Mountain on 3, 23 and 29 and Snow on 4, 5, 11 and
 * 19. A bare hilltop with the nearest roof between 36 and 514 tiles off.
 *
 * ## The rule, and why it is three lines
 *
 * The nearest village to the origin, and nothing else. Not the first in the list: an endless patch
 * lists its towns in junction-id order (`localroads.ts: junctionsIn` sorts by `id`), and on seed 5
 * the first is Blackreach at 37,406 — 408 tiles out — where Hartcross stands at 119,90. #395 found
 * the same thing in `tools/shots.cjs`.
 *
 * ## One rule, both countries, and nothing moved under anybody
 *
 * `main.ts` asks this whichever kind of world it is growing, with no branch on the kind, and that
 * is safe for the bounded country because the road tree already answers it by construction: its
 * hub stands at distance nought, so it wins this ordering outright and a road world opens exactly
 * where it has always opened. Checked on all ten seeds. A rule that held only for one kind would
 * be a second answer to "where does a world open", and `growworld.ts` is a whole file arguing that
 * the way to keep two answers agreeing is not to have two.
 *
 * And it is only asked of a world **nobody has ever stood in** — `main.ts` consults it when the
 * save has no `player` on it. That is not a guess: `player` has been on `SessionSave` since the
 * first commit of this engine (`git log -S` returns exactly one), and `keeping.ts` writes it on
 * every `persist()`, so a save without one is a world that was never opened rather than a world
 * saved before the field existed. Every world anybody has ever played reopens on the tile it was
 * left on, and no ground moves anywhere: this changes where a camera is put down on one frame and
 * nothing about what is grown under it, so the same seed means the same country in both kinds.
 *
 * ## The rule that is not here, and the measurement that kept it out
 *
 * #394 asks for the opening to be picked by *what it stands in* rather than by distance — a town
 * on ground a red roof can be seen against. It was run over the same scan before it was dropped,
 * and it moves the opening on **none** of the ten seeds above.
 *
 * The reason is geometry rather than luck. The biome pie is centred on the origin, six wedges of
 * sixty degrees, and the patch a world opens in is `patchOf(0, 0)` — the square from 0,0 to
 * 512,512, which is one **quadrant**. Ninety degrees of a six-wedge pie reaches at most two of
 * them, so the home patch holds one or two biomes and there is usually nothing else to choose. On
 * the four seeds where a village on kind ground existed at all (5, 13, 19, 29) it was already the
 * nearest; on the other six there was none. Ranked by ground:roof contrast, the bar would sit at 2
 * — the table falls 2.12, 2.12, 1.56, 1.37, 1.10, 1.02 and the only gap worth calling a cliff is
 * the first — and with it in place the answers are letter for letter what they are without it.
 *
 * `goodseed.ts` says what to do with a bar like that, about a different one: *"A bar at, say, forty
 * per cent land would look like protection and would never once fire, which is worse than no bar
 * at all — it is a guard nobody would think to check."* So it is written down here and not run.
 * The biome of an opening is decided by which quadrant the patch grid lands in, and that is a
 * question about `HOME_PATCH` rather than about which village to walk to.
 *
 * ## So what it buys, on those ten seeds
 *
 * The walk from where a world opens to the first roof in it goes from 36–514 tiles, mean 205, to
 * nought. The biome stops being whatever stands at the origin — Snow four, Mountain three, Plains
 * three, because the origin is high ground and nothing levels it — and becomes a fair draw from
 * the country: Plains 3, Desert 2, Forest 2, Swamp 1, Snow 1, Mountain 1, which is exactly what a
 * pie of six equal wedges does, at 0.159 props a tile against the country's own 0.16. An endless
 * world opens in an endless world's country, which is the honest answer to #394's own question.
 * What it no longer does is open in a field with nothing in it.
 */
export function whereAWorldOpens(villages: readonly Village[]): Village | null {
  let opening: Village | null = null;
  for (const village of villages) if (!opening || opensBefore(village, opening)) opening = village;
  return opening;
}

/**
 * Which of two villages a world would rather open in: a total order, so that two machines growing
 * the same seed put the hero on the same tile.
 *
 * Squared distance rather than `Math.hypot`, and this is the whole reason it is spelled out. A sum
 * of two products is exact under IEEE 754 and gives the same bits everywhere; `Math.hypot` is
 * allowed to be approximated and two engines may round it differently in the last place. That
 * difference can only ever show up on a tie — but a tie is exactly when the rest of this ordering
 * is consulted, and a world that opened in a different village on a different browser would be the
 * one thing #394 asks this never to be.
 *
 * Name, then x, then z behind it, because distance alone is not a total order and neither is
 * distance and name: seed 4's home patch plants two villages called Kirkcombe and two called
 * Hartstead. Nothing in the list is left to the order the list happened to arrive in.
 */
function opensBefore(one: Village, two: Village): boolean {
  const here = one.x * one.x + one.z * one.z, there = two.x * two.x + two.z * two.z;
  if (here !== there) return here < there;
  if (one.name !== two.name) return one.name < two.name;
  if (one.x !== two.x) return one.x < two.x;
  return one.z < two.z;
}
