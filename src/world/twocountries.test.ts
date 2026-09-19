import { describe, expect, it } from 'vitest';
import { BIOMES, Biome } from './biomes';
import { GRAPH } from '../core/config';
import { biomeAt, type Pie } from './graph';
import { growPatch, growWorld } from './growworld';
import { Simplex2D } from './noise';
import { boundsOf } from './patchwork';
import { SALT, derive } from '../core/salts';
import { TerrainSampler } from './terrain';

/**
 * Whether the endless country is darker and more crowded than the road tree, which is #299's
 * fourth complaint: *"Roofs went from red to olive, trees multiplied, contrast dropped."*
 *
 * It is not, and the two pictures that say it is are both true. What they show is one fact, not
 * three: **the camera is standing in a different biome**, and everything the sentence lists is the
 * Swamp column of `BIOMES` read against the Plains column.
 *
 *     roof            Plains 0xa5502f (red)   Swamp 0x8a7a45 (olive)
 *     ground          L 0.351                 L 0.175
 *     propDensity     0.10                    0.22
 *     ground:roof     2.12 : 1                1.10 : 1
 *
 * There is one table and both generators read it, so "olive roofs" is a swamp and "a darker green"
 * is the same swamp said twice. Measured around the village each generator's shot is taken in, on
 * seed 3: props per tile 0.111 in the road world against 0.194 in the endless one, mean ground
 * luminance 0.364 against 0.431. Seed 11 is the extreme — a forest at 0.300 props per tile and
 * luminance 0.202 against the road tree's 0.121 and 0.392.
 *
 * And the country as a whole is the same country. Both worlds cut the same six biomes into six
 * wedges of the same size; the only difference is that `sectorsFor` draws the shuffle from a fresh
 * generator and `generateRoadGraph` draws it after growing the roads, so the wedges land in a
 * different order for the same seed. Sampled over a full turn on seeds 3, 4, 5, 7 and 11:
 *
 *     road     mean ground luminance 0.393–0.400   mean propDensity 0.1624–0.1661
 *     endless  mean ground luminance 0.399–0.403   mean propDensity 0.1597–0.1652
 *
 * So what was lost with the road tree is not light. It is the **opening**: `sectorMix` keeps a
 * plains clearing of 39 tiles around the origin, and the road tree puts its hub town in it — on
 * every one of those five seeds Crossroads Town stands at 0,0 in Plains. The endless country has no
 * hub, so the first village a fresh world offers is wherever the town list put it: measured at 36,
 * 91, 149, 202 and 361 tiles out, in Forest, Swamp, Plains, Desert and Forest. One seed in six
 * opens on a meadow, which is what a pie of six wedges does.
 *
 * Asserted on one seed rather than five because each endless patch is a few seconds to grow and a
 * guard that costs half a minute is a guard somebody turns off. The numbers above were taken by
 * scanning; this holds the shape of them.
 */

/** Relative luminance, as WCAG defines it: the number "darker" is an argument about. */
function luminance(hex: number): number {
  const channels = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast between two colours, the way a designer would be asked for it. */
function contrast(one: number, two: number): number {
  const [a, b] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/**
 * What a whole country is made of, over a full turn rather than out of one window.
 *
 * Rings rather than a square, because a square anywhere but the origin covers one or two wedges of
 * a pie and reads as a world made entirely of snow. The question is what the country is, so the
 * sample has to be the country.
 */
function madeOf(pie: Pie & { seed: number }): { share: number[]; light: number; props: number } {
  const noise = new Simplex2D(derive(pie.seed, SALT.BIOME));
  const count = [0, 0, 0, 0, 0, 0];
  let tiles = 0;
  for (let r = 60; r <= 400; r += 8) {
    const steps = Math.max(64, Math.round(r));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      count[biomeAt(pie as Parameters<typeof biomeAt>[0], noise, Math.cos(angle) * r, Math.sin(angle) * r)]++;
      tiles++;
    }
  }
  const share = count.map((n) => n / tiles);
  return {
    share,
    light: share.reduce((sum, s, b) => sum + s * (luminance(BIOMES[b as Biome].ground) + luminance(BIOMES[b as Biome].groundAlt)) / 2, 0),
    props: share.reduce((sum, s, b) => sum + s * BIOMES[b as Biome].propDensity, 0),
  };
}

describe('the two countries, as ground rather than as pictures', () => {
  const road = growWorld(3);
  const endless = growPatch(3, boundsOf('0,0')).graph;

  it('cut the same six biomes into six wedges, in a different order', () => {
    const six = [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow];
    expect([...road.sectors].sort()).toEqual([...six].sort());
    expect([...endless.sectors].sort()).toEqual([...six].sort());
    // and the order is what differs, which is why the same seed shows a different country at the
    // same place: seed 3 is Plains,Forest,Swamp,Snow,Mountain,Desert against
    // Plains,Snow,Swamp,Desert,Forest,Mountain
    expect(endless.sectors).not.toEqual(road.sectors);
  });

  it('are made of the same things in the same proportion', () => {
    const here = madeOf(road), there = madeOf(endless);
    for (const biome of [0, 1, 2, 3, 4, 5]) {
      expect(here.share[biome], `road ${BIOMES[biome as Biome].name}`).toBeGreaterThan(0.13);
      expect(here.share[biome], `road ${BIOMES[biome as Biome].name}`).toBeLessThan(0.21);
      expect(there.share[biome], `endless ${BIOMES[biome as Biome].name}`).toBeGreaterThan(0.13);
      expect(there.share[biome], `endless ${BIOMES[biome as Biome].name}`).toBeLessThan(0.21);
    }
  });

  it('are the same brightness, which is the whole of the fourth complaint', () => {
    const here = madeOf(road), there = madeOf(endless);
    // 0.393 against 0.399 on this seed. A fiftieth is far tighter than the gap between any two
    // biomes and far looser than the noise in a sampled turn.
    expect(Math.abs(here.light - there.light), `road ${here.light} endless ${there.light}`).toBeLessThan(0.02);
  });

  it('grow the same amount on a tile, which is the other half of it', () => {
    const here = madeOf(road), there = madeOf(endless);
    // 0.1661 against 0.1652. "Trees multiplied" is a swamp and a forest, not a denser world.
    expect(Math.abs(here.props - there.props), `road ${here.props} endless ${there.props}`).toBeLessThan(0.01);
  });

});

/*
 * And the table itself, against numbers rather than against the other country.
 *
 * The comparison above is what #299 asked — is the one they see darker than the one it replaced —
 * and on its own it is a guard with a hole in it: one table feeds both countries, so a hand that
 * darkens the table darkens them equally and the comparison stays happy. It was tried on the way
 * in. Forest's ground taken from 0x3f8c3a to 0x1f4c1a — a third of the light out of a sixth of the
 * world — passed every assertion above, which is this complaint arriving again with nobody to
 * notice it.
 *
 * So the two ends are written down. They are today's values and not a target: the darkest ground in
 * the world is swamp's alternate at 0.135 and the thickest planting is forest at 0.36 props a tile.
 * A change that wants to go past either is a change somebody should have to argue for on an issue,
 * which is the whole of what a ratchet is for.
 */
describe('how dark and how thick the world is allowed to get', () => {
  it('has a floor under every ground colour in it', () => {
    for (const def of BIOMES) {
      expect(luminance(def.ground), `${def.name} ground`).toBeGreaterThanOrEqual(0.13);
      expect(luminance(def.groundAlt), `${def.name} groundAlt`).toBeGreaterThanOrEqual(0.13);
    }
  });

  it('and a ceiling over how much stands on it', () => {
    for (const def of BIOMES) {
      expect(def.propDensity, `${def.name} propDensity`).toBeLessThanOrEqual(0.36);
    }
  });
});

describe('what the road tree has that the endless country does not', () => {
  it('opens on a meadow, every time, because the hub stands in the clearing', () => {
    const sampler = new TerrainSampler(growWorld(3));
    const hub = sampler.structures.villages[0];
    expect(hub.name).toBe('Crossroads Town');
    // `sectorMix` holds plains for 39 tiles around the origin and the hub is grown from the middle
    expect(Math.hypot(hub.x, hub.z)).toBeLessThan(GRAPH.HUB_RADIUS * 1.15);
    expect(hub.biome).toBe(Biome.Plains);
  });

  it('and a meadow is where a red roof can be seen at all', () => {
    // the number behind "contrast dropped": a red roof on plains grass, against an olive one on
    // swamp. Nothing in either is a choice this generator made — it is one table, read twice.
    expect(contrast(BIOMES[Biome.Plains].ground, 0xa5502f)).toBeGreaterThan(2);
    expect(contrast(BIOMES[Biome.Swamp].ground, 0x8a7a45)).toBeLessThan(1.2);
  });
});
