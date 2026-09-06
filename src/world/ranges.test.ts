import { describe, expect, it } from 'vitest';
import { FaceKind, generateMesh, type WorldMesh } from './mesh';
import { RANGE, buildRanges, mountainAt, planBowl, type Ranges } from './ranges';
import { highlandAt, highlandLift, highlandRidges } from './highland';

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
  it('raises every mountain face, and a wide one more than once', () => {
    for (const { seed, mesh, ranges } of worlds([1, 2, 3, 7, 42])) {
      const mountains = mesh.faces.filter((f) => f.kind === FaceKind.Mountain);
      expect(mountains.length, `seed ${seed} has mountains at all`).toBeGreaterThan(0);
      // every face gets at least one summit, and none gets more than a range's worth
      const perFace = new Map<number, number>();
      for (const peak of ranges.peaks) perFace.set(peak.face, (perFace.get(peak.face) ?? 0) + 1);
      for (const face of mountains) {
        const many = perFace.get(face.id) ?? 0;
        expect(many, `seed ${seed} face ${face.id}`).toBeGreaterThanOrEqual(1);
        expect(many, `seed ${seed} face ${face.id}`).toBeLessThanOrEqual(RANGE.MOST_PEAKS);
      }
      expect(ranges.peaks.every((p) => mesh.faces[p.face].kind === FaceKind.Mountain)).toBe(true);

      // one triangle per side of the polygon per summit, each cut into four RANGE.CUTS times
      const sides = ranges.peaks.reduce((n, p) => n + mesh.faces[p.face].corners.length, 0);
      expect(ranges.tris.length / 9, `seed ${seed}`).toBe(sides * 4 ** RANGE.CUTS);
    }
  });

  it('gives a wide territory a chain rather than one enormous cone', () => {
    // somewhere among these seeds there is a face big enough for a second summit; that is the case
    // this exists to protect, because the first version had exactly one peak however wide the face
    const many = worlds([1, 2, 3, 5, 7, 11, 42])
      .flatMap(({ ranges }) => ranges.peaks.map((p) => p.face))
      .reduce((counts, face) => counts.set(face, (counts.get(face) ?? 0) + 1), new Map<number, number>());
    expect([...many.values()].some((n) => n > 1), 'some face carries a chain').toBe(true);
  });

  it('stands its peaks between the shortest and the tallest a mountain may be', () => {
    for (const { seed, ranges } of worlds([1, 2, 3, 7, 42])) {
      // A face's own mountain is within the range; the second and third summits on a wide face are
      // shorter than it by design, because a chain of identical peaks is a fence.
      const tallestOn = new Map<number, number>();
      for (const peak of ranges.peaks) {
        tallestOn.set(peak.face, Math.max(tallestOn.get(peak.face) ?? 0, peak.lift));
      }
      for (const [face, tallest] of tallestOn) {
        expect(tallest, `seed ${seed} face ${face}`).toBeGreaterThanOrEqual(RANGE.SHORTEST);
        expect(tallest, `seed ${seed} face ${face}`).toBeLessThanOrEqual(RANGE.TALLEST);
      }
      for (const peak of ranges.peaks) {
        const most = tallestOn.get(peak.face) ?? 0;
        expect(peak.lift, `seed ${seed} face ${peak.face}`).toBeGreaterThanOrEqual(most * RANGE.LESSER - 1e-6);
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

describe('the village walled into the mountains', () => {
  /** A village, as the planner needs to see one. */
  const village = (name: string, x: number, z: number, radius = 22) => ({ name, x, z, radius });
  const everywhereLand = (): boolean => true;

  it('walls one village, and never the one the hero starts beside', () => {
    const mesh = generateMesh(3);
    const near = village('Homestead', 40, 20);
    const far = village('Faraway', 300, 240);
    const bowl = planBowl(mesh, [near, far], everywhereLand);
    expect(bowl?.village).toBe('Faraway');
  });

  it('walls nobody when there is nobody far enough out to wall', () => {
    expect(planBowl(generateMesh(3), [village('Homestead', 40, 20)], everywhereLand)).toBeNull();
    expect(planBowl(generateMesh(3), [], everywhereLand)).toBeNull();
  });

  it('will not wall a village whose ring runs into the sea', () => {
    const mesh = generateMesh(3);
    const far = village('Seaside', 300, 240);
    // land everywhere except one bearing, which is all it takes for a wall to have a hole in it
    const gap = (x: number, z: number): boolean => !(x > 300 && z > 240);
    expect(planBowl(mesh, [far], gap)).toBeNull();
  });

  it('stands a wall round the village and leaves its floor alone', () => {
    const mesh = generateMesh(3);
    const far = village('Faraway', 300, 240);
    const bowl = planBowl(mesh, [far], everywhereLand);
    expect(bowl).not.toBeNull();
    if (!bowl) return;
    // no roads anywhere, so nothing is gated: the wall should be unbroken
    const ranges = buildRanges(mesh, FLAT, { bowl, roadAway: () => Infinity });
    expect(ranges.bowl?.village).toBe('Faraway');

    let walled = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const y = mountainAt(ranges, bowl.x + Math.cos(a) * bowl.radius, bowl.z + Math.sin(a) * bowl.radius);
      if (y !== null && y > RANGE.BOWL_HIGH / 2) walled++;
    }
    expect(walled, 'the wall goes all the way round').toBe(24);
    // and the village itself is standing where it always was
    const floor = mountainAt(ranges, bowl.x, bowl.z);
    expect(floor === null || floor <= 0, 'the floor is clear').toBe(true);
  });

  it('opens a gate where a road already runs through the wall', () => {
    const mesh = generateMesh(3);
    const bowl = planBowl(mesh, [village('Faraway', 300, 240)], everywhereLand);
    if (!bowl) throw new Error('no bowl to test');
    // one road, running east from the village: the wall must come down where it crosses
    const roadAway = (x: number, z: number): number => (x > bowl.x ? Math.abs(z - bowl.z) : Infinity);
    const ranges = buildRanges(mesh, FLAT, { bowl, roadAway });
    const onTheRoad = mountainAt(ranges, bowl.x + bowl.radius, bowl.z);
    const offIt = mountainAt(ranges, bowl.x - bowl.radius, bowl.z);
    expect(onTheRoad === null || onTheRoad < 2, 'the gate is open').toBe(true);
    expect(offIt ?? 0, 'the rest of the wall still stands').toBeGreaterThan(RANGE.BOWL_HIGH / 2);
  });
});

describe('mountain country', () => {
  /**
   * The mistake this exists to prevent, and it was a design mistake rather than a tuning one: peaks
   * standing out of a flat plain like nothing in nature. A range is high country first — the land
   * tilts up for a long way, the valleys between summits are already higher than the fields, and
   * you are in the mountains before you are on one.
   */
  it('raises the country a long way before any rock stands on it', () => {
    const mesh = generateMesh(3);
    const country = highlandLift(mesh);
    const ridges = highlandRidges(mesh.seed);
    expect(country.length, 'seed 3 has mountain country').toBeGreaterThan(0);

    const middle = country.reduce((a, b) => (a.lift > b.lift ? a : b));
    // walking out from the middle of the highest country: high, then lower, then the plain
    const near = highlandAt(country, ridges, middle.x, middle.z);
    const halfway = highlandAt(country, ridges, middle.x + middle.reach * 0.6, middle.z);
    expect(near).toBeGreaterThan(6);
    expect(halfway).toBeLessThan(near);
    // and somewhere no range reaches at all is the plain. Far out, because ranges overlap: a point
    // just past one face's reach is often still inside the next face's, which is what a range is.
    const away = Math.max(...country.map((c) => Math.hypot(c.x, c.z) + c.reach)) + 200;
    expect(highlandAt(country, ridges, away, away), 'the plain is the plain').toBe(0);
  });

  it('climbs rather than steps: no cliff anywhere on the approach', () => {
    const mesh = generateMesh(3);
    const country = highlandLift(mesh);
    const ridges = highlandRidges(mesh.seed);
    const middle = country.reduce((a, b) => (a.lift > b.lift ? a : b));
    let worst = 0;
    for (let out = 0; out < middle.reach * 1.4; out += 2) {
      const here = highlandAt(country, ridges, middle.x + out, middle.z);
      const next = highlandAt(country, ridges, middle.x + out + 2, middle.z);
      worst = Math.max(worst, Math.abs(next - here));
    }
    // two tiles of walking never changes the country by more than a terrace and a half
    expect(worst, 'the ground rises smoothly').toBeLessThan(1.5);
  });

  it('puts its peaks on that high ground rather than on the plain', () => {
    const mesh = generateMesh(3);
    const country = highlandLift(mesh);
    const ridges = highlandRidges(mesh.seed);
    // the ground a peak stands on, as the world would report it: the country under the summit
    const ranges = buildRanges(mesh, (x, z) => highlandAt(country, ridges, x, z) * 0.5);
    for (const peak of ranges.peaks) {
      const under = highlandAt(country, ridges, peak.x, peak.z) * 0.5;
      expect(peak.y, `${peak.face}`).toBeCloseTo(under + peak.lift, 4);
      expect(under, 'and that ground is high before the rock is counted').toBeGreaterThan(0);
    }
  });
});
