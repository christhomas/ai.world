import { describe, expect, it } from 'vitest';
import { BIOMES, BLOCKS_WALKING, Biome, PropKind, TREES, biomeAnswersTo } from './biomes';

/**
 * The prop catalogue is a table, and tables go wrong quietly: a tree added to a biome but not to
 * the blocking set is a tree you can walk through, which nobody notices until they do.
 */
describe('the prop catalogue', () => {
  it('lets nobody walk through a tree', () => {
    for (const tree of TREES) expect(BLOCKS_WALKING.has(tree)).toBe(true);
  });

  it('leaves the small stuff walkable, so a meadow is not a maze', () => {
    for (const small of [PropKind.Flower, PropKind.Tuft, PropKind.Mushroom, PropKind.Reed, PropKind.Lily, PropKind.Bush, PropKind.Rock]) {
      expect(BLOCKS_WALKING.has(small)).toBe(false);
    }
  });

  it('gives every biome something to grow, with weights that mean something', () => {
    for (const biome of BIOMES) {
      expect(biome.props.length).toBeGreaterThan(0);
      for (const { kind, weight } of biome.props) {
        expect(kind).not.toBe(PropKind.None);
        expect(weight).toBeGreaterThan(0);
      }
    }
  });

  it('grows the new trees somewhere: a shape nothing plants is a shape nobody sees', () => {
    const planted = new Set(BIOMES.flatMap((b) => [...b.props, ...b.bank, ...b.water].map((p) => p.kind)));
    for (const tree of [PropKind.Birch, PropKind.Fir, PropKind.Blossom]) expect(planted.has(tree)).toBe(true);
  });
});

describe('the words a country answers to', () => {
  it('finds the highlands by what a player types and by what the world calls them', () => {
    for (const word of ['mountain', 'mountains', 'highland', 'stonecrown', 'hills']) {
      expect(biomeAnswersTo(Biome.Mountain, word), word).toBe(true);
    }
    expect(biomeAnswersTo(Biome.Desert, 'mountains')).toBe(false);
  });

  it('answers to the plain word for every country there is', () => {
    for (const [biome, word] of [
      [Biome.Plains, 'plains'], [Biome.Forest, 'forest'], [Biome.Desert, 'desert'],
      [Biome.Swamp, 'swamp'], [Biome.Mountain, 'mountains'], [Biome.Snow, 'snow'],
    ] as const) {
      expect(biomeAnswersTo(biome, word), word).toBe(true);
    }
  });

  it('takes half a word, because somebody typing into a console is in a hurry', () => {
    expect(biomeAnswersTo(Biome.Desert, 'des')).toBe(true);
    expect(biomeAnswersTo(Biome.Snow, 'fro')).toBe(true);
  });

  it('matches everything when asked for nothing, so a filter can be optional', () => {
    expect(biomeAnswersTo(Biome.Swamp, '')).toBe(true);
    expect(biomeAnswersTo(Biome.Swamp, '   ')).toBe(true);
  });

  it('gives every country at least one plain word of its own', () => {
    for (const def of BIOMES) expect(def.words.length, def.name).toBeGreaterThan(0);
  });
});
