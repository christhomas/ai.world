import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { faceUnder, indexFaces, scatterPoints, weldPolygons } from './polygons';

/**
 * The polygons, checked as geometry rather than as a country.
 *
 * These are the claims the world above rests on and cannot check for itself: that the scattering
 * really does vary its spacing, that a face is a face and not a folded ribbon, and above all that
 * the fast lookup and the slow one agree — because when they disagree, the map draws one world and
 * the ground you walk on is another, and nothing about the symptom points at the cause.
 */

const NEAR = 34, FAR = 62;
const rng = () => mulberry32(20260905);
/** Fine-grained in the west, open in the east, so the spacing is provably not one number. */
const spacing = (x: number): number => Math.min(1, Math.max(0, (x + 400) / 800));
const scatter = scatterPoints(rng(), (x) => spacing(x), { reach: 400, near: NEAR, far: FAR, tries: 22 });
const faces = weldPolygons(rng(), scatter.px, scatter.pz, { appetite: [1, 1.2, 1.6, 2.4], minRoads: 3, dent: 0.5 });
const index = indexFaces(faces, scatter.px, scatter.pz, NEAR);

/** The plain, slow answer: which faces claim this point, by asking every one of them. */
function claimedBy(x: number, z: number): number[] {
  const out: number[] = [];
  faces.forEach((face, id) => {
    let inside = false;
    const n = face.corners.length;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = scatter.px[face.corners[a]], az = scatter.pz[face.corners[a]];
      const bx = scatter.px[face.corners[b]], bz = scatter.pz[face.corners[b]];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    if (inside) out.push(id);
  });
  return out;
}

describe('scattering the crossroads', () => {
  it('never puts two closer together than the closest spacing allows', () => {
    for (let i = 0; i < scatter.px.length; i++) {
      for (let j = i + 1; j < scatter.px.length; j++) {
        const d = Math.hypot(scatter.px[i] - scatter.px[j], scatter.pz[i] - scatter.pz[j]);
        expect(d, `points ${i} and ${j}`).toBeGreaterThanOrEqual(NEAR - 1e-9);
      }
    }
  });

  it('spreads them further apart where the country is meant to be open', () => {
    // the whole reason for a varying spacing: measure the nearest neighbour on each side of the
    // map, and the open half must be visibly emptier than the close-grained half
    const nearest = (only: (x: number) => boolean): number => {
      let sum = 0, n = 0;
      for (let i = 0; i < scatter.px.length; i++) {
        if (!only(scatter.px[i])) continue;
        let best = Infinity;
        for (let j = 0; j < scatter.px.length; j++) {
          if (i === j) continue;
          best = Math.min(best, Math.hypot(scatter.px[i] - scatter.px[j], scatter.pz[i] - scatter.pz[j]));
        }
        sum += best; n++;
      }
      return sum / n;
    };
    const close = nearest((x) => x < -150), open = nearest((x) => x > 150);
    expect(open, `close ${close.toFixed(1)}, open ${open.toFixed(1)}`).toBeGreaterThan(close * 1.25);
  });

  it('starts at the middle, so the hero is always inside a face rather than on a border', () => {
    expect(scatter.px[0]).toBe(0);
    expect(scatter.pz[0]).toBe(0);
  });
});

describe('welding the triangles into faces', () => {
  it('gives every face between three and six sides, and a neighbour for each', () => {
    for (const face of faces) {
      expect(face.corners.length).toBeGreaterThanOrEqual(3);
      expect(face.corners.length).toBeLessThanOrEqual(6);
      expect(face.neighbours.length).toBe(face.corners.length);
    }
  });

  it('never uses a corner twice in one face, which would pinch it into a figure of eight', () => {
    for (const face of faces) {
      expect(new Set(face.corners).size).toBe(face.corners.length);
    }
  });

  it('agrees with itself about who is next to whom', () => {
    faces.forEach((face, id) => {
      for (let k = 0; k < face.corners.length; k++) {
        const n = face.neighbours[k];
        if (n < 0) continue;
        const a = face.corners[k], b = face.corners[(k + 1) % face.corners.length];
        const them = faces[n];
        const shares = them.corners.some((c, j) =>
          (c === b && them.corners[(j + 1) % them.corners.length] === a));
        expect(shares, `${id} says it borders ${n}`).toBe(true);
      }
    });
  });

  it('leaves every face wound the same way and its middle inside it', () => {
    for (const face of faces) {
      let twice = 0;
      for (let k = 0; k < face.corners.length; k++) {
        const a = face.corners[k], b = face.corners[(k + 1) % face.corners.length];
        twice += scatter.px[a] * scatter.pz[b] - scatter.px[b] * scatter.pz[a];
      }
      expect(twice, 'a face wound the wrong way, or folded over').toBeGreaterThan(0);
      expect(claimedBy(face.cx, face.cz), 'a face whose middle is not in it').toContain(faces.indexOf(face));
    }
  });

  it('leaves no crossroads with fewer than three roads leaving it', () => {
    const roads = new Map<number, Set<number>>();
    for (const face of faces) {
      for (let k = 0; k < face.corners.length; k++) {
        const a = face.corners[k], b = face.corners[(k + 1) % face.corners.length];
        if (!roads.has(a)) roads.set(a, new Set());
        if (!roads.has(b)) roads.set(b, new Set());
        roads.get(a)!.add(b);
        roads.get(b)!.add(a);
      }
    }
    for (const [corner, out] of roads) {
      expect(out.size, `crossroads ${corner}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('finding the face a point is in', () => {
  /** Well inside the scatter, so nothing here is about the ragged rim of the hull. */
  const inland: Array<[number, number]> = [];
  for (let z = -260; z <= 260; z += 17) for (let x = -260; x <= 260; x += 19) inland.push([x, z]);

  it('puts every point in exactly one face', () => {
    for (const [x, z] of inland) {
      expect(claimedBy(x, z).length, `(${x}, ${z}) is in more than one face or in none`).toBe(1);
    }
  });

  it('gives the same answer as asking every face in turn', () => {
    for (const [x, z] of inland) {
      expect(faceUnder(index, x, z), `(${x}, ${z})`).toBe(claimedBy(x, z)[0]);
    }
  });

  it('says nothing is there well past the edge of the scatter', () => {
    for (const [x, z] of [[900, 0], [0, -900], [-2000, 2000]] as const) {
      expect(faceUnder(index, x, z)).toBe(-1);
    }
  });
});
