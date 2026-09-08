import * as THREE from 'three';
import { BLOCKS_WALKING, PropKind } from './biomes';
import { WORLD } from '../core/config';

/**
 * What you bump into, taken from what is drawn.
 *
 * Collision used to be a bit per tile: a prop stood on a tile, and that whole tile was solid. It is
 * wrong in both directions at once and both were reported within a minute of each other. A market
 * stall is drawn about two and a half tiles across and blocked one, so you walked through the
 * counter and out the other side. A cottage's footprint was stamped three tiles wide while its
 * walls are 2.4, so there was a ring of invisible wall round every house — measured on a live
 * world: solid out to 1.35 from the middle, walls drawn to 1.20.
 *
 * A one-tile grid cannot describe either of those, so it stops trying. Every prop now carries the
 * box its own geometry occupies, and a point is inside a thing or it is not.
 *
 * **Only what is below head height counts.** This is the rule that makes boxes usable rather than
 * merely accurate: a tree's canopy is drawn two tiles wide and you walk under it, a stall's roof
 * overhangs its counter, a cottage's eaves stand proud of its walls. Taking the whole bounding box
 * would make a wood impassable and put a metre of invisible wall round every building — which is
 * the bug it is meant to fix, arrived at from the other side. What stops you is what is at your
 * knees and your chest.
 */

/** How high a walker is, in world units. Anything drawn above this is something to walk under. */
const HEAD = 1.6;

/** A thing standing in the world, as a walker meets it: a box on the ground, turned. */
export interface Solid {
  x: number;
  z: number;
  /** Half-extents along the prop's own axes, before it was turned. */
  hw: number;
  hd: number;
  /** How far it is turned, in radians. */
  rot: number;
}

/**
 * The footprint of each kind of prop, measured off its geometry once.
 *
 * Built from the same meshes the game draws, so a prop that is redrawn is re-measured and nothing
 * has to be kept in step by hand. Kinds that do not block at all are absent.
 */
export function measureFootprints(geometries: ReadonlyMap<PropKind, THREE.BufferGeometry>): Map<PropKind, { hw: number; hd: number }> {
  const out = new Map<PropKind, { hw: number; hd: number }>();
  for (const [kind, geometry] of geometries) {
    if (!BLOCKS_WALKING.has(kind)) continue;
    const pos = geometry.getAttribute('position');
    if (!pos) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      // the part of a thing that stops you is the part at your knees and your chest
      if (pos.getY(i) > HEAD) continue;
      const x = pos.getX(i), z = pos.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // a thing drawn entirely overhead — an arch, a canopy on a bare stem — stops nobody
    if (minX === Infinity) continue;
    out.set(kind, { hw: Math.max(Math.abs(minX), Math.abs(maxX)), hd: Math.max(Math.abs(minZ), Math.abs(maxZ)) });
  }
  return out;
}

/**
 * The solid things in one chunk, bucketed by tile so asking about a point is cheap.
 *
 * A box is registered in every tile it reaches into, which is what lets a stall wider than its own
 * tile stop you on the tiles either side. The lookup is then one bucket — nearly always empty or
 * holding one thing — and an exact test against that.
 */
export class Solids {
  private readonly buckets: Solid[][];

  constructor(private readonly cx: number, private readonly cz: number) {
    const CS = WORLD.CHUNK_SIZE;
    this.buckets = Array.from({ length: CS * CS }, () => []);
  }

  /** Put a prop into every tile of this chunk its box reaches. */
  add(solid: Solid): void {
    const CS = WORLD.CHUNK_SIZE;
    // the box turned: how far it reaches along the world's own axes
    const cos = Math.abs(Math.cos(solid.rot)), sin = Math.abs(Math.sin(solid.rot));
    const reachX = solid.hw * cos + solid.hd * sin;
    const reachZ = solid.hw * sin + solid.hd * cos;
    const x0 = Math.floor(solid.x - reachX) - this.cx * CS;
    const x1 = Math.floor(solid.x + reachX) - this.cx * CS;
    const z0 = Math.floor(solid.z - reachZ) - this.cz * CS;
    const z1 = Math.floor(solid.z + reachZ) - this.cz * CS;
    for (let tz = Math.max(0, z0); tz <= Math.min(CS - 1, z1); tz++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(CS - 1, x1); tx++) {
        this.buckets[tz * CS + tx].push(solid);
      }
    }
  }

  /** Is this point inside anything? */
  at(x: number, z: number): boolean {
    const CS = WORLD.CHUNK_SIZE;
    const tx = Math.floor(x) - this.cx * CS, tz = Math.floor(z) - this.cz * CS;
    if (tx < 0 || tz < 0 || tx >= CS || tz >= CS) return false;
    for (const s of this.buckets[tz * CS + tx]) {
      // into the prop's own frame, where the box is square to the axes
      const dx = x - s.x, dz = z - s.z;
      const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
      if (Math.abs(dx * cos - dz * sin) <= s.hw && Math.abs(dx * sin + dz * cos) <= s.hd) return true;
    }
    return false;
  }
}
