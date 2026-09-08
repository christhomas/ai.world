import type * as THREE from 'three';
import type { PropKind } from '../world/biomes';
import { WALKING_BAND, type Footprint, type Footprints } from '../world/footprints';

/**
 * How much ground a prop takes up, taken off the prop.
 *
 * This used to be a table: forty-six rows of half-extents, hand-written in `world/footprints.ts`,
 * with a test that rebuilt every mesh and failed if a row had drifted from it. The table was
 * accurate. It was still the wrong shape for the problem, in two ways that both cost a day.
 *
 * A table is a second place the truth is written, so it can be short — a prop drawn but never
 * listed had no box at all, blocked nothing, and nothing failed, because a test that compares the
 * rows it has cannot notice the row that is missing. And a table is data about the object kept
 * somewhere else, so nothing about the object carries it: the box did not belong to the prop the
 * way a creature's `body` belongs to the creature.
 *
 * So the box is measured from the parts the prop is built out of, once, at the moment the props
 * are built. There is nothing to keep in step, nothing to forget to add, and a prop redrawn wider
 * is wider to walk into in the same breath.
 */

/**
 * The half-extents of everything in one prop that a walker would meet.
 *
 * Only the faces that span the walking band count — see `WALKING_BAND`, which explains why the
 * band and not the whole mesh — and a face counts if it *spans* the band rather than having a
 * corner in it. A wall is a box whose only vertices are at the floor and the ceiling; measuring
 * corners found no walls at all, which is how the first version of this let you into a house
 * through any side of it.
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

/**
 * The footprint of everything drawn, whether or not anything blocks the way with it.
 *
 * Measuring is a fact and blocking is a decision, and they belong apart: a flower has a size and
 * walking through it is right, a bed has a size and walking through it is not, and those two are
 * decided by the world the thing is standing in — `BLOCKS_WALKING` out of doors and
 * `FURNITURE_BLOCKS` inside. Filtering here would mean the indoor decision could not be made at
 * all, which is exactly what had happened: indoors blocked furniture by the tile it stood on, so
 * you walked through the far half of every bed.
 */
export function footprintsOf(geometries: ReadonlyMap<PropKind, THREE.BufferGeometry>): Footprints {
  const out = new Map<PropKind, Footprint>();
  for (const [kind, geometry] of geometries) {
    const box = measureFootprint(geometry);
    if (box) out.set(kind, box);
  }
  return out;
}
