import { describe, expect, it } from 'vitest';
import { FaceKind, generateMesh, type WorldMesh } from './mesh';
import { RANGE, buildRanges, mountainAt, type Ranges } from './ranges';

/**
 * The mountains, as the shape they are rather than as a picture of one.
 *
 * Everything here is about the geometry agreeing with itself: that a range is continuous where its
 * faces meet, that it comes down to the ground where the map says the mountains stop, and that the
 * same seed grows the same mountains. A cliff seen from the wrong side is a screenshot's problem;
 * a seam between two faces is a hole a player falls through.
 */

/** Flat ground, so a test that is about the mountain is not also about the terrain under it. */
const FLAT = (): number => 0;
/** Ground that leans, for the tests that care whether a mountain sits on what it stands on. */
const SLOPING = (x: number, z: number): number => (x + z) * 0.01;

const worlds = (seeds: number[]): Array<{ seed: number; mesh: WorldMesh; ranges: Ranges }> =>
  seeds.map((seed) => {
    const mesh = generateMesh(seed);
    return { seed, mesh, ranges: buildRanges(mesh, FLAT) };
  });

describe('mountains built from the polygons', () => {
  it('gives every mountain face a fan and nothing else one', () => {
    for (const { seed, mesh, ranges } of worlds([1, 2, 3, 7, 42])) {
      const mountains = mesh.faces.filter((f) => f.kind === FaceKind.Mountain);
      expect(ranges.peaks.length, `seed ${seed} raises every mountain face`).toBe(mountains.length);
      expect(mountains.length, `seed ${seed} has mountains at all`).toBeGreaterThan(0);

      // one triangle per side of the polygon, each cut into four as many times as RANGE.CUTS says
      const sides = mountains.reduce((n, f) => n + f.corners.length, 0);
      expect(ranges.tris.length / 9, `seed ${seed}`).toBe(sides * 4 ** RANGE.CUTS);
      expect(ranges.peaks.every((p) => mesh.faces[p.face].kind === FaceKind.Mountain)).toBe(true);
    }
  });

  it('stands its peaks between the shortest and the tallest a mountain may be', () => {
    for (const { seed, ranges } of worlds([1, 2, 3, 7, 42])) {
      for (const peak of ranges.peaks) {
        expect(peak.lift, `seed ${seed} face ${peak.face}`).toBeGreaterThanOrEqual(RANGE.SHORTEST);
        expect(peak.lift, `seed ${seed} face ${peak.face}`).toBeLessThanOrEqual(RANGE.TALLEST);
      }
      // and they are not all the same mountain: a range of identical peaks is a lattice again
      const heights = ranges.peaks.map((p) => Math.round(p.lift));
      expect(new Set(heights).size, `seed ${seed} varies its peaks`).toBeGreaterThan(1);
    }
  });

  /**
   * The one that matters most. Two faces of a range share an edge, and each draws that edge from
   * the same two corners at the same two heights — so there is one surface across a range rather
   * than two that happen to be near each other. Anything else is a crack with the sky behind it.
   */
  it('agrees with itself along every edge two mountain faces share', () => {
    for (const { seed, mesh, ranges } of worlds([1, 2, 3, 7, 42])) {
      /** Every height this build gave to each corner of the mesh, gathered from the triangles. */
      const heightsAt = new Map<string, Set<number>>();
      for (let t = 0; t < ranges.tris.length / 9; t++) {
        // vertices 2 and 3 of a fan triangle are the polygon's own corners; vertex 1 is the apex
        for (const v of [1, 2]) {
          const i = t * 9 + v * 3;
          const key = `${ranges.tris[i].toFixed(3)},${ranges.tris[i + 2].toFixed(3)}`;
          const seen = heightsAt.get(key) ?? new Set<number>();
          seen.add(Number(ranges.tris[i + 1].toFixed(4)));
          heightsAt.set(key, seen);
        }
      }
      for (const [where, seen] of heightsAt) {
        expect(seen.size, `seed ${seed} corner ${where} has one height, not ${[...seen].join('/')}`).toBe(1);
      }
    }
  });

  /**
   * Where the mountains stop, they stop — and what stops them is the borders of their own faces,
   * which is where the roads are. A mountain that reached its polygon's corners would bury the
   * junction three roads meet at; this checks the corners are clear ground, which is what makes a
   * pass a pass rather than something that had to be carved.
   */
  it('leaves the corners its roads meet at standing on the ground', () => {
    for (const { seed, mesh, ranges } of worlds([1, 2, 3, 7, 42])) {
      let checked = 0;
      for (const face of mesh.faces) {
        if (face.kind !== FaceKind.Mountain) continue;
        for (const c of face.corners) {
          const v = mesh.vertices[c];
          const rock = mountainAt(ranges, v.x, v.z);
          checked++;
          // FLAT ground is 0, so anything above it here is rock standing on a crossroads
          expect(rock === null || rock <= 0, `seed ${seed} corner ${c} is under ${rock} of rock`).toBe(true);
        }
      }
      expect(checked, `seed ${seed} has mountain faces with corners`).toBeGreaterThan(0);
    }
  });

  it('grows the same mountains from the same seed, and different ones from a different seed', () => {
    const a = buildRanges(generateMesh(5), FLAT);
    const again = buildRanges(generateMesh(5), FLAT);
    const other = buildRanges(generateMesh(6), FLAT);
    expect([...a.tris]).toEqual([...again.tris]);
    expect([...a.tris]).not.toEqual([...other.tris]);
  });

  it('stands on the ground it is given rather than on nothing', () => {
    const mesh = generateMesh(3);
    const flat = buildRanges(mesh, FLAT);
    const leaning = buildRanges(mesh, SLOPING);
    const peak = flat.peaks[0];
    const onFlat = mountainAt(flat, peak.x, peak.z);
    const onSlope = mountainAt(leaning, peak.x, peak.z);
    expect(onFlat).not.toBeNull();
    expect(onSlope).not.toBeNull();
    // the same mountain, carried up by however high the ground under its apex is
    expect((onSlope as number) - (onFlat as number)).toBeCloseTo(SLOPING(peak.x, peak.z), 4);
  });

  describe('what is under a point', () => {
    it('answers with the summit at a peak and with nothing out at sea', () => {
      const mesh = generateMesh(3);
      const ranges = buildRanges(mesh, FLAT);
      for (const peak of ranges.peaks) {
        const y = mountainAt(ranges, peak.x, peak.z);
        expect(y, `face ${peak.face}`).not.toBeNull();
        expect(y as number).toBeCloseTo(peak.lift, 3);
      }
      // the far corner of the world, past the rim, where the mesh has nothing but open sea
      expect(mountainAt(ranges, mesh.radius * 2, mesh.radius * 2)).toBeNull();
    });

    it('falls away from the peak towards the edge of the face it stands on', () => {
      const mesh = generateMesh(3);
      const ranges = buildRanges(mesh, FLAT);
      const peak = ranges.peaks.reduce((a, b) => (a.lift > b.lift ? a : b));
      const face = mesh.faces[peak.face];
      const corner = mesh.vertices[face.corners[0]];
      let last = mountainAt(ranges, peak.x, peak.z) as number;
      for (let t = 0.2; t <= 1; t += 0.2) {
        const y = mountainAt(ranges, peak.x + (corner.x - peak.x) * t, peak.z + (corner.z - peak.z) * t);
        if (y === null) continue;               // past the fan, where the next face takes over
        expect(y, `at ${t} of the way out`).toBeLessThanOrEqual(last + 1e-6);
        last = y;
      }
      expect(last).toBeLessThan(peak.lift);
    });
  });
});
