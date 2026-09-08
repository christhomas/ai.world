import { describe, expect, it } from 'vitest';
import { PropLibrary } from '../render/props';
import { BLOCKS_WALKING } from './biomes';
import { FOOTPRINTS, WALKING_BAND } from './footprints';

/**
 * The table says what a prop blocks; the geometry says what it looks like. This is what stops the
 * two from ever disagreeing.
 *
 * They have to be separate — the server walks heroes through a world that has never built a mesh,
 * so it needs numbers rather than triangles — and separate things drift. A prop redrawn a little
 * wider would go on blocking at its old size, silently, which is exactly the class of fault this
 * whole change was made to end: a stall you walk through, a wall you cannot see.
 */
describe('what a prop blocks against what it is drawn as', () => {
  /** The half-extents of every face that spans the band a walker meets. */
  function measure(geometry: import('three').BufferGeometry): { hw: number; hd: number } | null {
    const p = geometry.getAttribute('position');
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let t = 0; t + 2 < p.count; t += 3) {
      const ys = [p.getY(t), p.getY(t + 1), p.getY(t + 2)];
      // a face counts if it spans the band, not if it has a corner in it: a wall is a box whose
      // only vertices are at the floor and the ceiling
      if (Math.max(...ys) < WALKING_BAND.low || Math.min(...ys) > WALKING_BAND.high) continue;
      for (const i of [t, t + 1, t + 2]) {
        const x = p.getX(i), z = p.getZ(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (minX === Infinity) return null;
    return { hw: Math.max(-minX, maxX), hd: Math.max(-minZ, maxZ) };
  }

  const library = new PropLibrary();

  it('matches, for every prop that blocks', () => {
    const wrong: string[] = [];
    for (const [kind, geometry] of library.geometries) {
      if (!BLOCKS_WALKING.has(kind)) continue;
      const drawn = measure(geometry);
      const said = FOOTPRINTS.get(kind);
      if (!drawn) { if (said) wrong.push(`${kind}: nothing in the band, but the table says ${said.hw}x${said.hd}`); continue; }
      if (!said) { wrong.push(`${kind}: drawn ${drawn.hw.toFixed(2)}x${drawn.hd.toFixed(2)}, missing from the table`); continue; }
      // the table is rounded to a hundredth of a tile, which is a centimetre and a half of world
      if (Math.abs(said.hw - drawn.hw) > 0.011 || Math.abs(said.hd - drawn.hd) > 0.011) {
        wrong.push(`${kind}: drawn ${drawn.hw.toFixed(2)}x${drawn.hd.toFixed(2)}, table says ${said.hw}x${said.hd}`);
      }
    }
    expect(wrong, 'a prop was redrawn without its footprint being remeasured').toEqual([]);
  });

  it('leaves a doorstep and a tree crown out of it', () => {
    // the two failures that named the band. A cottage measured to its doorstep would seal its own
    // door; measured to its eaves it would be the invisible wall this replaced.
    const cottage = FOOTPRINTS.get(20 as never);
    expect(cottage, 'a cottage blocks').toBeTruthy();
    expect(cottage!.hw, 'its walls and door leaf, not the step in front of them').toBeLessThan(1.4);
    expect(cottage!.hw, 'and not just its doorframe either').toBeGreaterThan(1.1);
  });
});
