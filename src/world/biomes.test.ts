import { describe, expect, it } from 'vitest';
import { BIOMES, BLOCKS_WALKING, PropKind, TREES } from './biomes';

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
