import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { faceAt, faceOf, facesIn, type Country } from './localmesh';
import { sitesIn } from './scattercells';

/**
 * The seam test, which is the whole of B2.
 *
 * A face is where a road runs, where a town stands and what a walker walks over. If the face under
 * your feet depends on how much country was generated around it, then two players standing in the
 * same field are in different fields, a road built from the east does not meet the one built from
 * the west, and every later piece of an endless world is built on sand.
 *
 * So: the same face asked for from the middle of a wide country and from the corner of a narrow one,
 * corner for corner. And neighbours asked about the border between them, from each side, expected to
 * describe the same border — which they must, because both computed the same halfway line.
 */

const country = (seed: number): Country => {
  const shape = new Simplex2D(seed);
  return {
    seed,
    spacing: (x, z) => (shape.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5,
    dials: { near: 6, far: 14, tries: 6 },
  };
};

/** A face as something two runs can be compared by. */
const shapeOf = (face: { corners: Array<{ x: number; z: number }>; neighbours: string[] }): string =>
  `${face.corners.map((c) => `${c.x.toFixed(6)},${c.z.toFixed(6)}`).join(' ')} | ${face.neighbours.join(',')}`;

describe('a face that does not care how much country was made around it', () => {
  const world = country(20260909);

  it('is the same face asked for from anywhere', () => {
    // a site somewhere in open country, found the way anything finds one
    const site = sitesIn(world.seed, world.spacing, world.dials, { x0: 300, z0: 300, x1: 360, z1: 360 })[0];
    expect(site, 'no country here to test').toBeTruthy();

    const asItself = faceOf(world, site);
    // the same site, reached by asking what face covers the ground it stands on
    const byGround = faceAt(world, site.x + 0.01, site.z + 0.01);
    expect(byGround, 'the ground under a site belongs to no face').toBeTruthy();
    expect(byGround!.id).toBe(site.id);
    expect(shapeOf(byGround!)).toBe(shapeOf(asItself));

    // and the same site, found as one of hundreds in a country twenty times wider
    const wide = facesIn(world, { x0: 0, z0: 0, x1: 700, z1: 700 }).find((f) => f.id === site.id);
    expect(wide, 'the face is missing from the wider country').toBeTruthy();
    expect(shapeOf(wide!)).toBe(shapeOf(asItself));
  });

  it('has corners, and is the size a face should be', () => {
    const faces = facesIn(world, { x0: 200, z0: 200, x1: 320, z1: 320 });
    expect(faces.length, 'no faces at all').toBeGreaterThan(20);
    for (const face of faces) {
      expect(face.corners.length, `${face.id} is not a polygon`).toBeGreaterThanOrEqual(3);
      // a cell of a well-spaced point set is a handful of sides, not a fan of forty
      expect(face.corners.length, `${face.id} has ${face.corners.length} sides`).toBeLessThanOrEqual(12);
      // and it contains the site it belongs to, which is what a Voronoi cell means
      expect(inside(face.corners, face.x, face.z), `${face.id} does not contain its own site`).toBe(true);
    }
  });

  it('agrees with its neighbours about the border between them', () => {
    const faces = facesIn(world, { x0: 400, z0: -200, x1: 480, z1: -120 });
    const byId = new Map(faces.map((f) => [f.id, f]));
    let checked = 0;
    for (const face of faces) {
      for (const id of face.neighbours) {
        const other = byId.get(id);
        if (!other) continue;                     // outside the patch, tested from the other side
        expect(other.neighbours, `${id} does not think ${face.id} is next door`).toContain(face.id);
        // the border they share: the corners each of them has on the halfway line between them
        const mine = onTheLine(face, other), theirs = onTheLine(other, face);
        expect(mine.length, `${face.id} and ${id} are neighbours with no border`).toBeGreaterThanOrEqual(2);
        expect(theirs.join(' ')).toBe(mine.join(' '));
        checked++;
      }
    }
    expect(checked, 'no borders were compared').toBeGreaterThan(20);
  });

  it('covers the ground: every point belongs to the face that claims it', () => {
    // walk a line across the country and check the face under each step contains that step
    let steps = 0;
    for (let x = 250; x < 330; x += 3.7) {
      const z = -60 + x * 0.31;
      const face = faceAt(world, x, z);
      expect(face, `nothing covers ${x.toFixed(1)},${z.toFixed(1)}`).toBeTruthy();
      expect(inside(face!.corners, x, z), `${face!.id} claims ${x.toFixed(1)},${z.toFixed(1)} without containing it`).toBe(true);
      steps++;
    }
    expect(steps).toBeGreaterThan(15);
  });

  it('is a different country under a different seed', () => {
    const mine = facesIn(world, { x0: 0, z0: 0, x1: 80, z1: 80 }).map(shapeOf).sort();
    const theirs = facesIn(country(world.seed + 1), { x0: 0, z0: 0, x1: 80, z1: 80 }).map(shapeOf).sort();
    expect(theirs).not.toEqual(mine);
  });

  it('costs little enough to walk about in', () => {
    const began = performance.now();
    let made = 0;
    for (let n = 0; n < 10; n++) {
      made += facesIn(world, { x0: n * 400, z0: 0, x1: n * 400 + 80, z1: 80 }).length;
    }
    const each = (performance.now() - began) / 10;
    expect(made, 'no country was made').toBeGreaterThan(20);
    expect(each, `${each.toFixed(1)}ms for a chunk's worth of faces`).toBeLessThan(120);
  });
});

/** Is a point inside a convex polygon, going round either way? */
function inside(corners: Array<{ x: number; z: number }>, x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const side = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(side) < 1e-9) continue;
    const now = side > 0 ? 1 : -1;
    if (sign === 0) sign = now;
    else if (sign !== now) return false;
  }
  return true;
}

/**
 * The border between two faces, as the test measures it — with its own arithmetic rather than the
 * mesher's, so that the two agreeing means something.
 */
function onTheLine(face: { x: number; z: number; corners: Array<{ x: number; z: number }> }, other: { x: number; z: number }): string[] {
  const dx = other.x - face.x, dz = other.z - face.z;
  const apart = Math.hypot(dx, dz) || 1;
  const midX = (face.x + other.x) / 2, midZ = (face.z + other.z) / 2;
  return face.corners
    .filter((p) => Math.abs(((p.x - midX) * dx + (p.z - midZ) * dz) / apart) < 1e-3)
    .map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`)
    .sort();
}
