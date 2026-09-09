import { describe, expect, it } from 'vitest';
import { PROPS, propFootprints } from '../entities/props';
import { build } from '../render/geometry';
import { measureFootprint } from '../render/footprint';
import { BLOCKS_WALKING, PropKind } from './biomes';
import { WALKING_BAND, blocking } from './footprints';
import { FURNITURE_BLOCKS } from '../interior/generate';

/**
 * What a prop blocks is worked out from the prop, so the two cannot disagree.
 *
 * This file has guarded two different things, and the difference is the point. It began as a
 * guard over a table: forty-six hand-written rows of half-extents, rebuilt against every mesh,
 * failing on any that had drifted. That test could only compare the rows it had, and the fault it
 * never caught was the missing row — a prop drawn, placed, and solid to nobody.
 *
 * Then the table went and the box was measured off the mesh, which cannot be short of a prop that
 * exists. That was right and it had a price the game could not see: measuring needed a renderer,
 * so the world server — which draws nothing — carried a 3D library into its container to find out
 * how wide a cottage is.
 *
 * Now a prop is a part list, the way a creature has always been, and the box falls out of the
 * parts. So the first test below is the one that keeps the bargain honest: for every prop in the
 * game, the box worked out from the data and the box read back off the drawn mesh, side by side.
 * The rest are about the *rules* — that everything meant to block has something to block with,
 * that nothing meant to be walked through has picked up a box, and that the band a walker meets is
 * still the walls of a building rather than its doorstep or its eaves.
 */
describe('the footprints worked out from the props', () => {
  const footprints = propFootprints();

  it('agrees with the mesh, prop by prop', () => {
    // The two halves of the same fact: `entities/shapes.ts` places the corners of each primitive
    // from its own arithmetic, and `THREE` places them by building one. A hexagonal trunk is 0.87
    // of its radius across one way and the full radius the other, a detail-0 icosahedron reaches
    // 0.851 of its radius and a detail-1 one reaches all of it — get any of that wrong and the box
    // stops agreeing with the tree. The tolerance is float32 and nothing else: the mesh keeps its
    // vertices in single precision and the catalogue does not, so the two part company in the
    // eighth decimal. Measured worst case over the whole catalogue, 8.3e-8, on a shipwreck.
    const drifted: string[] = [];
    for (const [kind, def] of PROPS) {
      const geometry = build(def.parts);
      const drawn = measureFootprint(geometry);
      geometry.dispose();
      if (!drawn || !def.box) {
        if (drawn !== def.box) drifted.push(`kind ${kind}: data ${JSON.stringify(def.box)}, mesh ${JSON.stringify(drawn)}`);
        continue;
      }
      const off = Math.max(Math.abs(drawn.hw - def.box.hw), Math.abs(drawn.hd - def.box.hd));
      if (off > 1e-6) drifted.push(`kind ${kind}: data ${def.box.hw}x${def.box.hd}, mesh ${drawn.hw}x${drawn.hd}`);
    }
    expect(drifted, 'a prop whose box is not the shape it is drawn as').toEqual([]);
  });

  it('covers everything that is supposed to block', () => {
    const missing: string[] = [];
    for (const [kind] of PROPS) {
      if (!BLOCKS_WALKING.has(kind) && !FURNITURE_BLOCKS.has(kind)) continue;
      if (!footprints.get(kind)) missing.push(`kind ${kind}`);
    }
    expect(missing, 'drawn, meant to block, and nothing in the walking band to block with').toEqual([]);
  });

  it('measures what you walk through too, and lets the world decide', () => {
    // a flower is drawn and has a size, and walking through it is right. That is a decision, and it
    // belongs to the world the thing is standing in — out of doors `BLOCKS_WALKING`, indoors
    // `FURNITURE_BLOCKS` — rather than to whether anybody remembered to measure it. A bed proves
    // why the two must be separate: nothing blocks with a bed on a hillside, and indoors it is the
    // thing you have been walking through.
    const outdoors = blocking(footprints, BLOCKS_WALKING);
    const walkThrough: Array<[string, PropKind]> = [
      ['a flower', PropKind.Flower], ['a tuft of grass', PropKind.Tuft],
      ['a mushroom', PropKind.Mushroom], ['a rug', PropKind.Rug],
    ];
    // some of these are too low to have anything in the walking band at all, which is its own
    // answer; what matters is that none of them stops anybody
    for (const [what, kind] of walkThrough) {
      expect(outdoors.get(kind), `${what} stops you out of doors`).toBeUndefined();
    }
    expect(outdoors.get(PropKind.Bed), 'a bed on a hillside').toBeUndefined();
    expect(blocking(footprints, FURNITURE_BLOCKS).get(PropKind.Bed), 'a bed in a bedroom').toBeTruthy();
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
