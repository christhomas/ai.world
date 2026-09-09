import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';
import { countryOf, faceAt } from './localmesh';
import {
  KEEP_READY, PROVINCE, provinceAt, provinceCorner, provinceOf, provincePath, provincesNear,
} from './provinces';

/**
 * Provinces are for what a world cannot work out again, and for nothing else.
 *
 * The distinction they have to keep is the one that decides whether an endless world holds together:
 * the country is *generated* by a bounded neighbourhood and knows nothing about these lines, while
 * the state people leave behind is *kept* inside them. If the two ever run together — a face that
 * stops at a border, a road that changes when a province is loaded — the world has a seam, and a
 * seam is two halves of a village facing each other across a line neither can cross.
 *
 * So the tests are of both halves of that: the arithmetic of the grid, and the country's blank
 * indifference to it.
 */
describe('the province a place is in', () => {
  it('is the same place asked for twice, and its own corner is inside it', () => {
    for (const [x, z] of [[0, 0], [511, 511], [512, 512], [-1, -1], [-513, 900], [12345.6, -7890.1]]) {
      const id = provinceOf(x, z);
      expect(provinceOf(x, z), 'a place moved province between two questions').toBe(id);
      const corner = provinceCorner(id);
      expect(provinceOf(corner.x, corner.z), `${id} does not contain its own corner`).toBe(id);
      expect(x - corner.x, `${x} is outside ${id}`).toBeGreaterThanOrEqual(0);
      expect(x - corner.x).toBeLessThan(PROVINCE);
      expect(z - corner.z).toBeGreaterThanOrEqual(0);
      expect(z - corner.z).toBeLessThan(PROVINCE);
    }
  });

  it('goes on into country nobody has been to', () => {
    // an endless world has no middle and no edge, so neither has the grid over it
    expect(provinceOf(1e6, -1e6)).toBe('1953:-1954');
    expect(provinceAt(provinceOf(1e6, -1e6))).toEqual({ px: 1953, pz: -1954 });
    expect(provinceOf(-0.001, -0.001), 'the wrong side of nought').toBe('-1:-1');
  });

  it('reaches the neighbours a walker is about to need', () => {
    // standing on a border: the ready list has to hold both sides, or walking over the line is a
    // field that looks bare until its leavings are read
    const onTheLine = provincesNear(PROVINCE, PROVINCE, KEEP_READY);
    expect(onTheLine).toContain('1:1');
    expect(onTheLine).toContain('0:0');
    expect(onTheLine).toContain('0:1');
    expect(onTheLine).toContain('1:0');
    // and in the middle of one, only that one
    expect(provincesNear(PROVINCE / 2, PROVINCE / 2, KEEP_READY)).toEqual(['0:0']);
  });

  it('has a file of its own, under the world it belongs to', () => {
    expect(provincePath('worlds', 3, '2:-1')).toBe('worlds/3/2_-1.json');
    // the same province of two different worlds is two different files, or one seed's leavings
    // would turn up in another's
    expect(provincePath('worlds', 4, '2:-1')).not.toBe(provincePath('worlds', 3, '2:-1'));
  });
});

describe('the country, which knows nothing about any of this', () => {
  const shape = new Simplex2D(4242);
  const world = countryOf(4242, (x, z) => (shape.fbm(x * 0.004, z * 0.004, 2) + 1) * 0.5, { near: 6, far: 14, tries: 6 });

  it('does not stop at a province border', () => {
    // walk straight across a border and check the faces either side are ordinary neighbours: a
    // country that noticed the line would have a face that ends on it
    const border = PROVINCE;
    let crossed = 0;
    for (let z = 100; z < 400; z += 37) {
      const before = faceAt(world, border - 6, z);
      const after = faceAt(world, border + 6, z);
      expect(before, 'no country west of the border').toBeTruthy();
      expect(after, 'no country east of the border').toBeTruthy();
      if (before!.id === after!.id) crossed++;                   // one face lying across the line
      else if (before!.neighbours.includes(after!.id)) crossed++; // or two that border each other
    }
    expect(crossed, 'the country changes at a province border').toBeGreaterThan(5);
  });

  it('gives the same face on both sides of the line, asked from either province', () => {
    // the face that straddles the border, asked for from ground in one province and then the other
    for (let z = 120; z < 300; z += 41) {
      const west = faceAt(world, PROVINCE - 2, z);
      const east = faceAt(world, PROVINCE + 2, z);
      if (!west || !east || west.id !== east.id) continue;       // not a straddling face; try the next
      expect(west.corners.map((c) => `${c.x.toFixed(6)},${c.z.toFixed(6)}`))
        .toEqual(east.corners.map((c) => `${c.x.toFixed(6)},${c.z.toFixed(6)}`));
      expect(west.neighbours).toEqual(east.neighbours);
    }
  });
});
