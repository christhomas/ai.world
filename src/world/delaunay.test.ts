import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { triangulate } from './delaunay';

/**
 * The triangulation is the floor the whole world stands on: if it comes out torn, faces overlap,
 * the point lookup answers two different things about one place, and the country has holes in it
 * that no test of the finished map would obviously explain. So it is checked against its own
 * definition — no point inside anybody's circumcircle — rather than against a golden output, which
 * would only pin whatever it happened to do the first time it was run.
 */

/** A scatter with no three points on a line and no four on a circle, which is the ordinary case. */
function cloud(seed: number, n: number): { px: number[]; pz: number[] } {
  const rng = mulberry32(seed);
  const px: number[] = [], pz: number[] = [];
  for (let i = 0; i < n; i++) {
    px.push(rng() * 900 - 450);
    pz.push(rng() * 900 - 450);
  }
  return { px, pz };
}

const { px, pz } = cloud(7, 400);
const tris = triangulate(px, pz);

/** Twice the signed area: positive when the corners go round the way the triangulator winds them. */
const turn = (a: number, b: number, c: number): number =>
  (px[b] - px[a]) * (pz[c] - pz[a]) - (pz[b] - pz[a]) * (px[c] - px[a]);

describe('the triangulation', () => {
  it('uses every point it was given', () => {
    const used = new Set(tris);
    expect(used.size).toBe(px.length);
  });

  it('makes the number of triangles the count of points and the hull allow', () => {
    // Euler for a triangulated convex hull: 2n - h - 2, where h is the hull. So the count alone
    // catches a triangulation that has lost or double-counted anything.
    const hull = new Set<number>();
    const edges = new Map<number, number>();
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const u = tris[t + k], v = tris[t + (k + 1) % 3];
        const key = u < v ? u * 65536 + v : v * 65536 + u;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      if (count !== 1) continue;
      hull.add(Math.floor(key / 65536));
      hull.add(key % 65536);
    }
    expect(tris.length / 3).toBe(2 * px.length - hull.size - 2);
  });

  it('winds every triangle the same way round, which is what lets two be glued together', () => {
    for (let t = 0; t < tris.length; t += 3) {
      expect(turn(tris[t], tris[t + 1], tris[t + 2]), `triangle ${t / 3}`).toBeGreaterThan(0);
    }
  });

  it('shares every inside edge between exactly two triangles and every rim edge with one', () => {
    const edges = new Map<number, number>();
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const u = tris[t + k], v = tris[t + (k + 1) % 3];
        const key = u < v ? u * 65536 + v : v * 65536 + u;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      expect(count, `edge ${Math.floor(key / 65536)}-${key % 65536}`).toBeLessThanOrEqual(2);
    }
  });

  it('leaves no point inside anybody else’s circumcircle, which is what Delaunay means', () => {
    // the in-circle determinant, on triangles already known to be wound positively: a point inside
    // gives a positive answer. A handful of triangles times every point is a few million tests,
    // which is cheap enough to check exhaustively rather than by sampling.
    let inside = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      for (let d = 0; d < px.length; d++) {
        if (d === a || d === b || d === c) continue;
        const ax = px[a] - px[d], az = pz[a] - pz[d];
        const bx = px[b] - px[d], bz = pz[b] - pz[d];
        const cx = px[c] - px[d], cz = pz[c] - pz[d];
        const det = (ax * ax + az * az) * (bx * cz - bz * cx)
          - (bx * bx + bz * bz) * (ax * cz - az * cx)
          + (cx * cx + cz * cz) * (ax * bz - az * bx);
        if (det > 1e-6) inside++;
      }
    }
    expect(inside, 'points swallowed by a circumcircle they should be outside').toBe(0);
  });

  it('gives the same answer twice, and a different one for different points', () => {
    expect(triangulate(px, pz)).toEqual(tris);
    const other = cloud(8, 400);
    expect(triangulate(other.px, other.pz)).not.toEqual(tris);
  });

  it('has nothing to say about fewer than three points', () => {
    expect(triangulate([0, 1], [0, 1])).toEqual([]);
  });
});
