import type * as THREE from 'three';
import { WALKING_BAND, type Footprint } from '../world/footprints';

/**
 * How much ground a prop takes up, read back off the mesh it is drawn as.
 *
 * This is not how the game answers that question any more. `entities/shapes.ts` works it out from
 * the parts a prop is written down as, with no renderer in the room, which is what let the world
 * server put its 3D library down. What is left here is the check on that: build every prop, read
 * the triangles back, and hold the two answers side by side. `world/footprints.test.ts` does it
 * for every prop in the game, so a shape added to the catalogue that the two halves disagree about
 * is a failing test rather than a wall in a place nobody thought to walk.
 *
 * The history is worth keeping, because it is two mistakes deep. Before the mesh was measured at
 * all there was a table: forty-six rows of half-extents, hand-written, with a test that rebuilt
 * every mesh and failed if a row had drifted. The table was accurate. It was still the wrong shape
 * for the problem — a prop drawn but never listed had no box, blocked nothing, and broke no test,
 * because a test that compares the rows it has cannot notice the row that is missing. Measuring
 * the mesh cured that, and cost the server a renderer. Measuring the parts cures both.
 *
 * Only the faces that span the walking band count — see `WALKING_BAND` — and a face counts if it
 * *spans* the band rather than having a corner in it. A wall is a box whose only vertices are at
 * the floor and the ceiling; measuring corners found no walls at all, which is how the first
 * version of this let you into a house through any side of it.
 */
export function measureFootprint(geometry: THREE.BufferGeometry): Footprint | null {
  const p = geometry.getAttribute('position');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const low = Math.min(p.getY(t), p.getY(t + 1), p.getY(t + 2));
    const high = Math.max(p.getY(t), p.getY(t + 1), p.getY(t + 2));
    if (high < WALKING_BAND.low || low > WALKING_BAND.high) continue;
    for (const i of [t, t + 1, t + 2]) {
      const x = p.getX(i), z = p.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (minX === Infinity) return null;
  // half-extents about the prop's own middle, which is where it is planted
  return { hw: Math.max(-minX, maxX), hd: Math.max(-minZ, maxZ) };
}
