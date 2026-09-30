import { describe, expect, it } from 'vitest';
import { PROPS } from '../entities/props';
import { build } from './geometry';
import { measureFootprint } from './footprint';

/**
 * The box a prop blocks with, worked out from its parts, against the mesh it is drawn as.
 *
 * `entities/shapes.ts` works a prop's footprint out with no renderer in the room, which is what let
 * the world server put its 3D library down. This is the check on that arithmetic, and it has to
 * build every prop's mesh to make it. It used to sit in `world/footprints.test.ts`, which then held
 * a three.js geometry outside the render layer without ever naming one (#249). Building meshes is
 * this layer's business, so the check is here and the world's tests keep to the rules.
 */
describe('the footprints worked out from the props', () => {
  it('agrees with the mesh, prop by prop', () => {
    // The two halves of the same fact: `entities/shapes.ts` places the corners of each primitive
    // from its own arithmetic, and three.js places them by building one. A hexagonal trunk is 0.87
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

});
