/**
 * Delaunay triangulation, by Bowyer and Watson.
 *
 * Written out here rather than pulled off the shelf, for two reasons. The game has no runtime
 * dependencies beyond three.js, and a world generator is the last place to start adding them; and
 * more importantly a world must come out identical on every machine that grows it, which means
 * knowing exactly which floating-point operations happen in which order. A library is free to
 * reorder its work, spatially sort its input, or take a faster path on a longer point list, and
 * any of those would give two players different countries from the same seed.
 *
 * The algorithm is the simple one: start with a triangle big enough to swallow everything, insert
 * the points one at a time, and for each one delete every triangle whose circumcircle it falls
 * inside and re-fan the hole from the new point. That is quadratic in the worst case, which would
 * matter for a hundred thousand points and does not matter at all for the few hundred a world is
 * made of — a whole world triangulates in a millisecond or two.
 *
 * What comes out is the triangulation in which no point lies inside any triangle's circumcircle,
 * which is the one that avoids long thin slivers wherever it possibly can. That matters here
 * because these triangles are glued into the polygons the country is made of, and a sliver glued
 * to anything is still a sliver.
 */

/**
 * How far outside the points the scaffolding triangle's corners are pushed, as a multiple of the
 * widest the point set is.
 *
 * It has to be big enough that no real point ever falls outside the triangle — that would silently
 * lose the point — and big enough that its corners do not bend the circumcircles near the hull out
 * of shape. Too big and the squared coordinates start eating into the precision of the circumcircle
 * arithmetic; twenty is comfortably inside both limits for a world a thousand tiles across.
 */
const OUTSIDE = 20;

/**
 * How many vertices an edge key allows for, which caps how many points a world may be scattered
 * from. Sixty-five thousand is two hundred times what a world uses, and it keeps the key well
 * inside the range where a double holds every integer exactly — which is what lets an edge be one
 * number and so a Map key rather than a string.
 */
const STRIDE = 65536;

/** A directed edge as one number, so the edge and its reverse are different keys. */
const edgeKey = (from: number, to: number): number => from * STRIDE + to;

/** A triangle mid-construction: its corners, and the circumcircle every insertion is tested against. */
interface Cell {
  a: number;
  b: number;
  c: number;
  x: number;
  z: number;
  r2: number;
}

/**
 * Triangulate a set of points, given as two parallel coordinate arrays.
 *
 * Returns vertex indices three at a time, every triangle wound the same way round — the winding is
 * what lets the caller glue two triangles into a quadrilateral without having to work out which way
 * either of them faces.
 */
export function triangulate(px: ReadonlyArray<number>, pz: ReadonlyArray<number>): number[] {
  const n = px.length;
  if (n < 3) return [];

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (px[i] < minX) minX = px[i];
    if (px[i] > maxX) maxX = px[i];
    if (pz[i] < minZ) minZ = pz[i];
    if (pz[i] > maxZ) maxZ = pz[i];
  }
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const wide = Math.max(maxX - minX, maxZ - minZ) || 1;

  // the three scaffolding corners live past the end of the real points, so "is this corner real?"
  // is a comparison against n and nothing has to be tagged
  const x = px.slice();
  const z = pz.slice();
  x.push(midX - OUTSIDE * wide, midX + OUTSIDE * wide, midX);
  z.push(midZ - wide, midZ - wide, midZ + OUTSIDE * wide);
  const cells: Cell[] = [make(x, z, n, n + 1, n + 2)];

  const doomed: number[] = [];
  const rim = new Set<number>();
  for (let i = 0; i < n; i++) {
    doomed.length = 0;
    rim.clear();
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const dx = x[i] - cell.x, dz = z[i] - cell.z;
      if (dx * dx + dz * dz < cell.r2) doomed.push(c);
    }
    // Nothing swallowed the point, which the scaffolding triangle makes impossible unless the
    // arithmetic has gone wrong. Dropping the point loses one crossroads; carrying on and stitching
    // a hole that is not there would lose the world, so this is the safe way to fail.
    if (doomed.length === 0) continue;

    // Every edge inside the hole is walked twice, once from each side and in opposite directions;
    // every edge on its rim is walked once. So an edge belongs to the rim exactly when its reverse
    // was never seen, and a pair that meet cancel each other out.
    for (const c of doomed) {
      const cell = cells[c];
      keep(rim, cell.a, cell.b);
      keep(rim, cell.b, cell.c);
      keep(rim, cell.c, cell.a);
    }

    // drop the doomed triangles from the back forwards, so the indices still to come stay put
    for (let d = doomed.length - 1; d >= 0; d--) {
      cells[doomed[d]] = cells[cells.length - 1];
      cells.pop();
    }
    for (const k of rim) {
      const from = Math.floor(k / STRIDE);
      cells.push(make(x, z, from, k - from * STRIDE, i));
    }
  }

  const out: number[] = [];
  for (const cell of cells) {
    if (cell.a >= n || cell.b >= n || cell.c >= n) continue;   // still hanging off the scaffolding
    out.push(cell.a, cell.b, cell.c);
  }
  return out;
}

/** Remember an edge, unless its reverse is already there — in which case neither is on the rim. */
function keep(rim: Set<number>, from: number, to: number): void {
  const back = edgeKey(to, from);
  if (rim.has(back)) rim.delete(back);
  else rim.add(edgeKey(from, to));
}

/**
 * A triangle with its circumcircle worked out once.
 *
 * The circle is stored rather than recomputed because every insertion tests every triangle against
 * it, and the corners are wound so every triangle here goes round the same way: the caller relies
 * on that to glue two of them together without checking which way either one faces.
 */
function make(x: number[], z: number[], a: number, b: number, c: number): Cell {
  const turn = (x[b] - x[a]) * (z[c] - z[a]) - (z[b] - z[a]) * (x[c] - x[a]);
  if (turn < 0) { const swap = b; b = c; c = swap; }
  const ax = x[a], az = z[a], bx = x[b], bz = z[b], cx = x[c], cz = z[c];
  const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  if (d === 0) {
    // Three points on a line have no circumcircle. A circle of no size swallows nothing, so the
    // sliver sits there inert until a later insertion happens to delete it, which is exactly the
    // behaviour wanted: it never claims a point and never blocks one.
    return { a, b, c, x: ax, z: az, r2: 0 };
  }
  const aa = ax * ax + az * az, bb = bx * bx + bz * bz, cc = cx * cx + cz * cz;
  const ux = (aa * (bz - cz) + bb * (cz - az) + cc * (az - bz)) / d;
  const uz = (aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) / d;
  return { a, b, c, x: ux, z: uz, r2: (ax - ux) * (ax - ux) + (az - uz) * (az - uz) };
}
