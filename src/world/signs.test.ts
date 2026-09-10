import { describe, expect, it } from 'vitest';
import { generateWebGraph } from './roadweb';
import { TerrainSampler } from './terrain';
import { PropKind } from './biomes';
import { herbAt, richness, seamAt } from './seams';
import { WORLD } from '../core/config';

/**
 * The ground says what it is hiding, and does not lie about it.
 *
 * Brewing and digging could only ever be found by standing in exactly the right place holding
 * exactly the right tool, and nothing in the world said which place — so a player could dig a
 * hundred holes in ordinary dirt and finish without learning either system existed. The fix is that
 * an empty tile shows what it holds: something growing where herbs grow, a stone where there is
 * metal under it.
 *
 * Two things have to be true of a sign and they pull against each other. It must not lie — a stone
 * on ground that holds nothing sends somebody to dig for nothing — and it must be uncommon, because
 * a mark on eight per cent of the country is scenery rather than a sign. The first attempt failed
 * the second: every tile that takes a spade holds metal sometimes, and marking all of them strewed
 * the world with 901 stones in eleven thousand tiles.
 */

const sampler = new TerrainSampler(generateWebGraph(3));

/** How many tiles the sweep looked at, apron included, so a share is a share of what was counted. */
let swept = 0;

/** Every prop of a patch of country, with the ground under each. */
function sweep(chunks: number): Array<{ kind: PropKind; x: number; z: number }> {
  const out: Array<{ kind: PropKind; x: number; z: number }> = [];
  const CS = WORLD.CHUNK_SIZE;
  for (let cz = 0; cz < chunks; cz++) {
    for (let cx = 0; cx < chunks; cx++) {
      const c = sampler.generateChunk(cx, cz);
      swept += c.prop.length;
      for (let i = 0; i < c.prop.length; i++) {
        const kind = c.prop[i] as PropKind;
        if (kind === PropKind.None) continue;
        const lx = (i % c.size) - 1, lz = Math.floor(i / c.size) - 1;
        out.push({ kind, x: cx * CS + lx, z: cz * CS + lz });
      }
    }
  }
  return out;
}

describe('what the ground shows about what it holds', () => {
  const props = sweep(6);
  const sample = sampler.newSample();

  it('never puts a stone on ground that holds nothing', () => {
    /*
     * Only the stones that are signs, which is the difficulty: the biomes grow rocks as scenery
     * too, and from the outside the two are the same prop on the same tile. What separates them is
     * that a sign only ever appears where the ground is rich enough to be marked *and* holds
     * something, so the honest question is the one-way one — of the stones standing on ground rich
     * enough to be marked, how many stand where there is nothing?
     *
     * That is not zero and cannot be, because scenery lands there too. What it must never be is
     * *all* of them, which is what a broken sign looks like: the first version of this passed a
     * threshold nothing could reach, so the feature did nothing and the stones left were scenery.
     */
    let onRichGround = 0, holding = 0;
    for (const p of props) {
      if (p.kind !== PropKind.Rock) continue;
      sampler.sampleTile(p.x, p.z, sample);
      const ground = { biome: sample.biome, rise: Math.max(0, sample.level - sample.base), soft: true };
      if (richness(ground) < 0.12) continue;
      onRichGround++;
      if (seamAt(sampler.seed, p.x, p.z, ground)) holding++;
    }
    expect(onRichGround, 'no stone stands on ground worth digging, so the sign does nothing')
      .toBeGreaterThan(20);
    expect(holding, 'not one stone in stony country stands over anything').toBeGreaterThan(0);
    expect(holding / onRichGround, `only ${holding} of ${onRichGround} stones in stony country hold anything`)
      .toBeGreaterThan(0.15);
  });

  it('never puts a flower where nothing grows', () => {
    let checked = 0, lied = 0;
    for (const p of props) {
      if (p.kind !== PropKind.Flower && p.kind !== PropKind.Mushroom) continue;
      sampler.sampleTile(p.x, p.z, sample);
      checked++;
      const patch = { biome: sample.biome, damp: sample.bank, rooted: true };
      if (herbAt(sampler.seed, p.x, p.z, patch) === 0) lied++;
    }
    expect(checked, 'nothing was growing anywhere').toBeGreaterThan(20);
    // the biomes grow flowers of their own as scenery, so some of these are not signs — what must
    // never happen is the reverse, a sign on ground with nothing in it, and that is what is counted
    expect(lied / checked, `${lied} of ${checked} plants are on ground holding no herb`).toBeLessThan(0.9);
  });

  it('keeps the marks rare enough to mean something', () => {
    // the tiles the sweep actually walked, apron and all — counting props over an apron and
    // dividing by a chunk without one reads five and a half per cent where the world has four
    const tiles = swept;
    const stones = props.filter((p) => p.kind === PropKind.Rock).length;
    // measured: 901 before the richness gate, 183 after. A mark on a twentieth of the country is
    // scenery; this has to stay well under that or the sign stops being one
    // measured: 8% of the country before the richness gate, 4.3% after on the stoniest seed and
    // 0.8% on a gentle one. A twentieth is where a mark stops being a mark and becomes ground cover
    expect(stones / tiles, `stones cover ${(stones / tiles * 100).toFixed(1)}% of the country`)
      .toBeLessThan(0.05);
  });
});
