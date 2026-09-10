import { describe, expect, it } from 'vitest';
import { generateRoadGraph } from './graph';
import { TerrainSampler } from './terrain';
import { buildChunkMesh } from './mesher';
import { generateQuests } from '../game/quests';

/** FNV-1a over a float/int stream; cheap, stable, good enough to pin generation output. */
function fnv(values: Iterable<number>): string {
  let h = 0x811c9dc5;
  for (const v of values) {
    const q = Math.round(v * 1000) | 0;
    h ^= q & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function worldFingerprint(seed: number): Record<string, string> {
  const graph = generateRoadGraph(seed);
  const sampler = new TerrainSampler(graph);
  const graphHash = fnv(graph.nodes.flatMap((n) => [n.x, n.z, n.level, n.size]).concat(graph.edges.flatMap((e) => [e.a, e.b, e.width, e.roadWidth])));
  const hydroHash = fnv(sampler.hydro.rivers.flatMap((r) => r.flatMap((n) => [n.x, n.z, n.level, n.width])).concat(sampler.hydro.lakes.flatMap((l) => [l.x, l.z, l.r, l.level])));
  const structHash = fnv(sampler.structures.all.flatMap((s) => [s.kind, s.tx, s.tz, s.level, s.rot, s.biome, s.path.length]));
  const chunkVals: number[] = [];
  for (const [cx, cz] of [[0, 0], [1, -1], [3, 2], [-2, 4]]) {
    const c = sampler.generateChunk(cx, cz);
    chunkVals.push(...c.type, ...c.height, ...c.prop, ...c.water, ...c.biome);
    const m = buildChunkMesh(c, seed);
    if (m.land) chunkVals.push(m.land.positions.length, ...m.land.positions.subarray(0, 300), ...m.land.colors.subarray(0, 90));
    if (m.water) chunkVals.push(m.water.positions.length);
  }
  const questHash = fnv(generateQuests(sampler.structures, seed).flatMap((q) => [q.reward, q.count, q.kind === 'visit' ? 1 : 2, q.target.length]));
  return { graph: graphHash, hydro: hydroHash, structures: structHash, chunks: fnv(chunkVals), quests: questHash };
}

/**
 * Last updated deliberately when the country stopped being flat (2026-09-10), and this is the one
 * change so far that moves all five. It is worth saying exactly what moved and what did not.
 *
 * Two things were done and both were done to the road web's own levels, which is the field every
 * height in this world is measured from — a tile's base, a village square, the floor of a house,
 * the terrace a river rises at. The hills: `GROWTH.LEVEL_RANGE` from three terraces to ten, so the
 * ground rises and falls by five world units over a hundred and sixty tiles instead of a barely
 * visible one and a half. The snow lands: `BIOME_BASE[Snow]` from two to eighteen, read through
 * `Uplands` so that the border on the map becomes a two-hundred-tile climb rather than a
 * nine-unit wall, which is what makes the cold something you walk up to.
 *
 * `graph` moves, and only by the levels: the crossroads of both seeds stand at exactly the same
 * two thousand four hundred and thirty-six places, with the same subtree sizes, the same towns and
 * the same biome pie. Hashing the web without `n.level` reproduces the old figure to the digit,
 * which is how that was checked rather than argued. What does change in the web is eleven of its
 * loop roads, which are no longer built — `addLoops` has always refused to join two crossroads
 * more than a terrace apart, and in a country with real relief it now sometimes has cause to.
 * `hydro` moves because a river runs down the ground and the ground is different: the springs are
 * the same crossroads, the courses are not. `structures` moves because a house is only built where
 * three tiles of ground share a terrace, and where that is true has moved with the hills; the
 * villages are still seventeen and still on their crossroads, and seed 1 keeps 98 houses of its
 * old 105 while seed 2 gains, at 112 of 103. `quests` moves because it is drawn from the
 * structures, and `chunks` because the ground under all four of them is higher and unevener.
 *
 * `structures` moves a second time for the castles, which the hills nearly took away: a plot needs
 * a rim of nineteen tiles within a terrace of itself, that stopped being common the moment the
 * ground had relief in it, and castles fell from fifteen across twelve seeds to ten with four of
 * those worlds holding none at all. `CASTLE.SLACK` is two now, paid for by a graded doorstep — the
 * outer ring of the apron sits one terrace towards the country instead of flush with the ward, so
 * two terraces of difference are met as two strides rather than one wall. Every one of the twelve
 * seeds has a castle again, and seed 1 has one where a moment ago it had none.
 *
 * Before that, the same day: the country gained castles. One or two in a world,
 * out on their own a long way from any settlement: a thirteen-tile ward of levelled ground with a
 * curtain wall round it, seven drum towers, a gatehouse you go in by and a keep in the yard —
 * about fifty structures apiece. Only `structures` moves. `graph`, `hydro` and `quests` are
 * untouched, and so is `chunks`, and both of those are load-bearing rather than luck. A castle is
 * seated after everything else in the layout, so it takes numbers off the end of the random stream
 * that nothing else was going to take and every village, chapel, cave and wreck in every existing
 * world is exactly where it was — setting the count to nought reproduces the previous hashes to
 * the digit, which is how that was checked rather than argued. `chunks` reads four fixed chunks
 * near the middle of the world and a castle stands nowhere near a settlement, so in these two
 * seeds none of it falls in them; a seed where one did would move `chunks` as well, honestly.
 * Before that: the towns gained a town hall and a watch house (2026-09-09). A
 * village of eight houses or more raises a hall on its square, and one that also keeps a cell
 * raises a watch house beside it — about a fifth of the settlements in a world, which is every
 * place big enough to have written anything down. `graph`, `hydro` and `quests` do not move, and
 * that is the load-bearing part: the two buildings walk a fixed ring of directions round the
 * square rather than rolling for one, so they draw nothing from the layout's random stream and
 * every village name, every house and every chapel in every existing world is exactly where it
 * was. Setting the threshold impossibly high reproduces the old hashes to the digit, which is how
 * that was checked rather than argued. `structures` moves by the two buildings and their paths,
 * and `chunks` moves because a civic footprint is stamped as floor with a path onto the cobbles,
 * and the hub's square falls inside the four chunks the fingerprint reads in both seeds.
 * Before that: villages gained stables you can see (2026-09-07). Two to five
 * villages in a world now keep one: a house with a fenced paddock beside it and the country's own
 * animals standing in it. `graph`, `hydro` and `quests` do not move — whether a village keeps a
 * stable is rolled on the stable house's own tile under a label of its own, so it takes nothing
 * from the layout's stream and shifts nothing that was laid out before it. `structures` moves by
 * the paddock and its rails, and `chunks` moves in seed 2 only, where a paddock happens to fall in
 * one of the four chunks the fingerprint reads: the yard is levelled and cleared of what was
 * growing on it, which is the difference between a paddock and a fence with three trees in it.
 * Before that, the same day: the roads started to wander. The web is still grown
 * as straight runs between its nodes and everything laid out against a road — the rivers that avoid
 * one, the villages that sit on one — still measures to that surveyed line, which is why `graph` and
 * `hydro` do not move. What moved is the drawing: a road now leans off its line by a tile or two,
 * except near water, where a bent road drowns, and near anywhere a village could stand, where it
 * would run through a parlour. The landmarks are placed against the drawn road and so moved with it,
 * and village names moved because naming draws from the same stream that placing houses does.
 * Before that: when the roads stopped being one flat colour: a road wide enough to
 * have a middle is drawn as made surface and one that is all edge as worn earth, with per-tile
 * wear over both and a scuffed verge where the fields meet them (2026-09-06). Only `chunks` moved,
 * and only its colours — the ground itself is where it was, and nothing was drawn from the random
 * stream that was not drawn before.
 * Before that: villages of six houses or more gained a police station, which
 * takes a house off the same street and hangs a sign beside its door (2026-09-04). Only the
 * structure list moved, for the same reason the pub moved it: the station is a house that was
 * already standing, and it draws nothing from the random stream.
 * Before that, the same day: villages of four houses or more gained a pub, which hangs a sign
 * beside its door and so adds one structure per village.
 * Before that: birch, fir and blossom trees in the biome tables, and signposts before them.
 * Pins the generated world for two seeds. Refactors of the generators must keep these identical;
 * an intentional tuning change updates the constants (and changes every saved world's layout).
 */
describe('generation fingerprint', () => {
  it('seed 1 and 2 are unchanged', () => {
    expect(worldFingerprint(1)).toEqual(GOLDEN[1]);
    expect(worldFingerprint(2)).toEqual(GOLDEN[2]);
  });
});

const GOLDEN: Record<number, Record<string, string>> = {
  1: { graph: '5256f550', hydro: '57d1f709', structures: 'a4085842', chunks: '65b262e0', quests: '829c481b' },
  2: { graph: '91f6d142', hydro: 'e1df1004', structures: 'd9dbd1be', chunks: '7f420170', quests: '10f6f7ad' },
};
