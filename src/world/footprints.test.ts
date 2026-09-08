import { describe, expect, it } from 'vitest';
import { PropLibrary, propFootprints } from '../render/props';
import { BLOCKS_WALKING, PropKind } from './biomes';
import { WALKING_BAND } from './footprints';

/**
 * What a prop blocks is measured off the prop, so the two cannot disagree.
 *
 * This file used to guard a table: forty-six hand-written rows of half-extents, rebuilt against
 * every mesh, failing on any that had drifted. That test could only compare the rows it had, and
 * the fault it never caught was the missing row — a prop drawn, placed, and solid to nobody.
 *
 * Now there is nothing to drift, so what is worth testing changed. Not "does the number match the
 * mesh" — it is taken from the mesh — but whether the *rules* around it still hold: that everything
 * meant to block has something to block with, that nothing meant to be walked through has picked up
 * a box, and that the band a walker meets is still the walls of a building rather than its doorstep
 * or its eaves.
 */
describe('the footprints measured off the props', () => {
  const footprints = propFootprints();

  it('covers everything that is supposed to block', () => {
    const library = new PropLibrary();
    const missing: string[] = [];
    for (const [kind] of library.geometries) {
      if (!BLOCKS_WALKING.has(kind)) continue;
      if (!footprints.get(kind)) missing.push(`kind ${kind}`);
    }
    library.dispose();
    expect(missing, 'drawn, meant to block, and nothing in the walking band to block with').toEqual([]);
  });

  it('leaves what you walk through alone', () => {
    // a flower is drawn and has a size, and walking through it is right; that is a decision, and
    // it lives in BLOCKS_WALKING rather than in whether anybody remembered to measure it
    const walkThrough: Array<[string, PropKind]> = [
      ['a flower', PropKind.Flower], ['a tuft of grass', PropKind.Tuft],
      ['a mushroom', PropKind.Mushroom], ['a rug', PropKind.Rug],
    ];
    for (const [what, kind] of walkThrough) {
      expect(footprints.get(kind), `${what} has been given a box`).toBeUndefined();
    }
  });

  it('measures a cottage to its walls, not its step or its eaves', () => {
    // the two failures that named the band. Measured to the doorstep a cottage seals its own door;
    // measured to the eaves it is the ring of invisible wall this whole thing replaced.
    const cottage = footprints.get(PropKind.HousePlains);
    expect(cottage, 'a cottage blocks').toBeTruthy();
    expect(cottage!.hw, 'out as far as the step in front of the door').toBeLessThan(1.4);
    expect(cottage!.hw, 'no wider than the doorframe').toBeGreaterThan(1.1);
  });

  it('measures a tree to its trunk and low branches, not its crown', () => {
    // a wood has to be walkable: an oak's crown is 0.82 out at head height and you walk under it
    const oak = footprints.get(PropKind.Oak);
    expect(oak, 'an oak blocks').toBeTruthy();
    expect(oak!.hw, 'the whole crown, which would close the woods').toBeLessThan(1.0);
  });

  it('is measured over a band a walker could actually meet', () => {
    // mid-shin to chest: under it is what you step onto, over it is what you walk under
    expect(WALKING_BAND.low).toBeGreaterThan(0.1);
    expect(WALKING_BAND.low).toBeLessThan(WALKING_BAND.high);
    expect(WALKING_BAND.high).toBeLessThan(1.6);
  });
});
