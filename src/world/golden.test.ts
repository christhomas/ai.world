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
 * Last updated deliberately when the roads started to wander (2026-09-07). The web is still grown
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
  1: { graph: 'cee2dffc', hydro: '008cbfe6', structures: '599864bd', chunks: '34c6a374', quests: '07c8c2d8' },
  2: { graph: 'e006116b', hydro: '7fa41781', structures: '1da2777e', chunks: 'a7bdacbb', quests: '2fa87fd6' },
};
