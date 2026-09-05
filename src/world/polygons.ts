import type { Rng } from '../core/rng';
import { triangulate } from './delaunay';

/**
 * The polygons a country is cut into, and how to find the one you are standing in.
 *
 * Three steps, in order. Points are scattered so that no two come closer than a distance that
 * itself varies across the map, which gives fine-grained country in some places and open country
 * in others. Those points are triangulated. Then neighbouring triangles are welded together until
 * the map is a mixture of triangles, quadrilaterals, pentagons and hexagons of visibly different
 * sizes — which is the whole point of doing it this way, and the thing a lattice of any one shape
 * can never give you however hard its corners are jittered.
 *
 * The corners of those polygons are the crossroads of the world and their edges are the roads that
 * may be built along them, so the shape of the country and the shape of its road network are the
 * same fact looked at twice. A crossroads has as many roads leaving it as there are polygons
 * meeting there — three, four or five — rather than the flat three that a hexagon lattice gives
 * every junction in the world.
 *
 * Everything here takes its randomness from the caller, so a world is a pure function of its seed.
 */

/** One face of the finished map. */
export interface Polygon {
  /** Point indices, going round, always the same way round. Three to six of them. */
  corners: number[];
  /** The face across each edge, in the same order as `corners`. -1 past the edge of the map. */
  neighbours: number[];
  /** The area centroid, which is inside the polygon: where the face "is", for anything that asks. */
  cx: number;
  cz: number;
  /** How much ground it covers, in tiles. Faces differ by several times over, which is the idea. */
  area: number;
}

/** How the points are thrown down. */
export interface ScatterDials {
  /** Radius of the disc filled with points, in tiles. */
  reach: number;
  /** Closest two points ever come, in tiles: the fine-grained country. */
  near: number;
  /** And furthest apart they get: the open country. */
  far: number;
  /** How many places a point tries to grow a neighbour before it gives up and goes quiet. */
  tries: number;
}

/** How the triangles are welded into polygons. */
export interface WeldDials {
  /**
   * Relative likelihood that a face asks for three, four, five and six sides.
   *
   * What comes out is not this: a face that asks for six and is refused its last swallow lands in
   * the pentagon column instead, and the refusals all fall downhill. So the larger faces are asked
   * for more often than they are wanted, and the histogram is checked rather than assumed. Without
   * any weighting at all — everything grows as far as it can — the map comes out almost entirely
   * hexagons, which is the lattice again by another road.
   */
  appetite: readonly number[];
  /**
   * The fewest roads that may leave a crossroads.
   *
   * Welding two faces together deletes the edge between them, and that takes a road away from the
   * corner at each end. Left alone it strands corners with two roads, which is not a junction at
   * all but a kink in a single road, and the map fills up with them. Three is the least that reads
   * as a place where you choose which way to go.
   */
  minRoads: number;
  /**
   * How much of a dent a face may have in it, as the sine of the reflex angle allowed at a corner.
   *
   * Nought welds only into convex faces, which is safe and a little too tidy — every territory
   * comes out a puffed-up blob. A little slack lets faces take on a wedge or an elbow without ever
   * letting one fold over itself, which point-in-polygon would survive but a road drawn round the
   * border would not.
   */
  dent: number;
}

/** A uniform grid of face ids, and enough geometry to answer "which face is this point in?". */
export interface FaceIndex {
  /** Side of one grid square, in tiles. */
  cell: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** Where each grid square's face list starts in `cellFaces`; one longer than there are squares. */
  cellStart: Int32Array;
  cellFaces: Int32Array;
  /** Where each face's corners start in `faceCorners`; one longer than there are faces. */
  faceStart: Int32Array;
  faceCorners: Int32Array;
  vx: Float64Array;
  vz: Float64Array;
}

/**
 * How many vertices a face key allows for. Same reasoning as the triangulator's: it keeps an
 * undirected edge inside one exactly-representable integer, so it can be a Map key without a string.
 */
const STRIDE = 65536;

const pairKey = (u: number, v: number): number => (u < v ? u * STRIDE + v : v * STRIDE + u);

/**
 * Scatter points so that no two come closer than a distance that varies across the map.
 *
 * Bridson's dart-throwing, with one change: the distance a point demands is asked of `spacing` at
 * the point itself rather than being fixed for the whole set, and a candidate is refused if it
 * falls inside either its own claim or the claim of somebody already there. That is what makes
 * some country fine-grained and some of it open, and it costs nothing — the alternative, one
 * spacing everywhere, produces a point set of one scale, which is the flaw this whole exercise
 * exists to fix, only moved one level down.
 *
 * The first point is the middle of the world, so the hero always starts inside a face rather than
 * on a border, and always inside the same one for a given seed.
 */
export function scatterPoints(
  rng: Rng,
  spacing: (x: number, z: number) => number,
  dials: ScatterDials,
): { px: number[]; pz: number[] } {
  const px: number[] = [], pz: number[] = [], claim: number[] = [];
  // One grid square as wide as the largest claim any point can make, so everything that could be
  // too close to a candidate is in one of the nine squares around it and nothing further need be
  // looked at. Sizing it to the smallest claim instead would be faster to search and wrong.
  const cell = dials.far;
  const cols = Math.ceil((dials.reach * 2) / cell) + 1;
  const buckets: number[][] = [];
  for (let i = 0; i < cols * cols; i++) buckets.push([]);
  const at = (v: number): number => Math.min(cols - 1, Math.max(0, Math.floor((v + dials.reach) / cell)));

  const drop = (x: number, z: number, want: number): number => {
    px.push(x); pz.push(z); claim.push(want);
    buckets[at(z) * cols + at(x)].push(px.length - 1);
    return px.length - 1;
  };
  const room = (x: number, z: number, want: number): boolean => {
    const cx = at(x), cz = at(z);
    for (let j = Math.max(0, cz - 1); j <= Math.min(cols - 1, cz + 1); j++) {
      for (let i = Math.max(0, cx - 1); i <= Math.min(cols - 1, cx + 1); i++) {
        for (const p of buckets[j * cols + i]) {
          const dx = px[p] - x, dz = pz[p] - z;
          const need = Math.max(want, claim[p]);
          if (dx * dx + dz * dz < need * need) return false;
        }
      }
    }
    return true;
  };

  const reachable = (x: number, z: number): number => {
    const t = Math.min(1, Math.max(0, spacing(x, z)));
    return dials.near + (dials.far - dials.near) * t;
  };

  const live = [drop(0, 0, reachable(0, 0))];
  while (live.length > 0) {
    const which = Math.floor(rng() * live.length);
    const from = live[which];
    let grew = false;
    for (let k = 0; k < dials.tries; k++) {
      const angle = rng() * Math.PI * 2;
      // somewhere in the annulus between one claim and two: closer would be refused anyway, and
      // further leaves holes that nothing ever comes back to fill
      const away = claim[from] * (1 + rng());
      const x = px[from] + Math.cos(angle) * away;
      const z = pz[from] + Math.sin(angle) * away;
      if (x * x + z * z > dials.reach * dials.reach) continue;
      const want = reachable(x, z);
      if (!room(x, z, want)) continue;
      live.push(drop(x, z, want));
      grew = true;
      break;
    }
    // it has no room left, so take it off the list — by swapping in the last one, which keeps the
    // order the seed decides rather than shuffling everything down
    if (!grew) { live[which] = live[live.length - 1]; live.pop(); }
  }
  return { px, pz };
}

/**
 * Triangulate the points and weld the triangles into three-, four-, five- and six-sided faces.
 *
 * Faces are grown rather than merged pairwise. Each triangle in turn, in a shuffled order, is
 * taken as the seed of a face, told how many sides it is to have, and then swallows free
 * neighbouring triangles one at a time until it has them — every triangle swallowed adds exactly
 * one side, since it brings three and buries the two along the seam.
 *
 * Growing beats merging and the difference is not small. Welding pairs in edge order, a face that
 * wants six sides has to happen upon three willing partners in the right order, and the world came
 * out sixty per cent triangles with barely a hexagon in it. Growing gives the face first refusal on
 * everything it touches, so what it ends up with is what it asked for unless the ground genuinely
 * refuses — which lets the mixture be chosen rather than merely hoped for.
 *
 * A swallow is refused when it would strand a crossroads with too few roads, when the triangle
 * touches the face at some corner other than the two along the seam — which would pinch the result
 * into a figure of eight — and when the result would be dented more than the dials allow.
 */
export function weldPolygons(
  rng: Rng,
  px: ReadonlyArray<number>,
  pz: ReadonlyArray<number>,
  dials: WeldDials,
): Polygon[] {
  const tris = triangulate(px, pz);
  const count = tris.length / 3;
  const roads = new Int32Array(px.length);

  // every edge, and the one or two triangles along it. A face grows across the two-sided ones; the
  // one-sided ones are the rim of the map and have nothing on the far side to swallow.
  const seams = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const u = tris[t * 3 + k], v = tris[t * 3 + (k + 1) % 3];
      const key = pairKey(u, v);
      const both = seams.get(key);
      if (both) both.push(t);
      else { seams.set(key, [t]); roads[u]++; roads[v]++; }
    }
  }

  const appetite = dials.appetite;
  let total = 0;
  for (const w of appetite) total += w;
  const hunger = (): number => {
    let roll = rng() * total;
    for (let s = 0; s < appetite.length; s++) {
      roll -= appetite[s];
      if (roll < 0) return 3 + s;
    }
    return 3 + appetite.length - 1;
  };

  // Seeded in a shuffled order rather than in triangulation order, which would sweep across the map
  // and leave every face growing the same way — the leftovers all end up along one side.
  const order: number[] = [];
  for (let t = 0; t < count; t++) order.push(t);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = order[i]; order[i] = order[j]; order[j] = swap;
  }

  const owner = new Int32Array(count).fill(-1);
  const loops: number[][] = [];
  const members: number[][] = [];
  const choices: number[] = [];
  for (const seed of order) {
    if (owner[seed] >= 0) continue;
    const id = loops.length;
    owner[seed] = id;
    loops.push([tris[seed * 3], tris[seed * 3 + 1], tris[seed * 3 + 2]]);
    members.push([seed]);
    const wants = hunger();
    while (loops[id].length < wants) {
      const here = loops[id];
      choices.length = 0;
      for (let k = 0; k < here.length; k++) {
        const u = here[k], v = here[(k + 1) % here.length];
        if (roads[u] <= dials.minRoads || roads[v] <= dials.minRoads) continue;
        const both = seams.get(pairKey(u, v))!;
        if (both.length !== 2) continue;
        const across = owner[both[0]] === id ? both[1] : both[0];
        if (owner[across] >= 0) continue;
        choices.push(k);
      }
      // shuffled, so a face does not always grow towards the same quarter of the compass
      for (let i = choices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const swap = choices[i]; choices[i] = choices[j]; choices[j] = swap;
      }
      let grew = false;
      for (const k of choices) {
        const u = here[k], v = here[(k + 1) % here.length];
        const both = seams.get(pairKey(u, v))!;
        const across = owner[both[0]] === id ? both[1] : both[0];
        const lb = [tris[across * 3], tris[across * 3 + 1], tris[across * 3 + 2]];
        // touching anywhere but along the seam would fold the result over on itself
        let shared = 0;
        for (const c of here) if (lb.includes(c)) shared++;
        if (shared !== 2) continue;
        const joined = stitch(here, lb, u, v);
        if (!joined || !holdsTogether(joined, px, pz, dials.dent)) continue;
        loops[id] = joined;
        owner[across] = id;
        members[id].push(across);
        roads[u]--; roads[v]--;
        grew = true;
        break;
      }
      if (!grew) break;
    }
  }

  // Mop up the leftovers.
  //
  // A face is a triangle either because it asked to be one or because everything it could have
  // swallowed had already been claimed, and towards the end of the growing almost everything has.
  // Left alone that puts a third of the map in the three column whatever the appetite says, which
  // is the mixture being decided by the order the faces happened to be seeded in rather than by
  // the dials. So each leftover is offered once to a neighbour with room for another side: the
  // triangle goes, and the neighbour gets the side it wanted and could not have.
  const most = 2 + appetite.length;
  const gone: boolean[] = loops.map(() => false);
  const spare: number[] = [];
  loops.forEach((loop, id) => { if (loop.length === 3) spare.push(id); });
  for (let i = spare.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = spare[i]; spare[i] = spare[j]; spare[j] = swap;
  }
  for (const id of spare) {
    if (gone[id] || loops[id].length !== 3) continue;
    const here = loops[id];
    for (let k = 0; k < 3; k++) {
      const u = here[k], v = here[(k + 1) % 3];
      if (roads[u] <= dials.minRoads || roads[v] <= dials.minRoads) continue;
      const both = seams.get(pairKey(u, v))!;
      if (both.length !== 2) continue;
      const host = owner[owner[both[0]] === id ? both[1] : both[0]];
      if (host === id || gone[host] || loops[host].length + 1 > most) continue;
      let shared = 0;
      for (const c of loops[host]) if (here.includes(c)) shared++;
      if (shared !== 2) continue;
      const joined = stitch(here, loops[host], u, v);
      if (!joined || !holdsTogether(joined, px, pz, dials.dent)) continue;
      loops[host] = joined;
      gone[id] = true;
      for (const t of members[id]) { owner[t] = host; members[host].push(t); }
      roads[u]--; roads[v]--;
      break;
    }
  }

  // then find out who is across each edge from whom
  const faces: Polygon[] = [];
  for (let id = 0; id < loops.length; id++) {
    if (gone[id]) continue;
    const shape = centreOf(loops[id], px, pz);
    faces.push({ corners: loops[id], neighbours: loops[id].map(() => -1), cx: shape.cx, cz: shape.cz, area: shape.area });
  }
  const sides = new Map<number, number[]>();
  faces.forEach((face, id) => {
    for (let k = 0; k < face.corners.length; k++) {
      const key = pairKey(face.corners[k], face.corners[(k + 1) % face.corners.length]);
      const list = sides.get(key);
      if (list) list.push(id);
      else sides.set(key, [id]);
    }
  });
  faces.forEach((face, id) => {
    for (let k = 0; k < face.corners.length; k++) {
      const list = sides.get(pairKey(face.corners[k], face.corners[(k + 1) % face.corners.length]))!;
      face.neighbours[k] = list.length === 2 ? (list[0] === id ? list[1] : list[0]) : -1;
    }
  });
  return faces;
}

/**
 * Two loops sharing the edge u→v, as one loop.
 *
 * Both are wound the same way round, so the shared edge runs u→v in one of them and v→u in the
 * other: walk the first all the way round from v back to u, then carry on through the second from
 * the far side of u round to v. What is left out is precisely the seam.
 */
function stitch(la: number[], lb: number[], u: number, v: number): number[] | null {
  const i = la.indexOf(u), j = lb.indexOf(v);
  if (i < 0 || j < 0) return null;
  if (la[(i + 1) % la.length] !== v || lb[(j + 1) % lb.length] !== u) return null;
  const out: number[] = [];
  for (let k = 1; k <= la.length; k++) out.push(la[(i + k) % la.length]);
  for (let k = 2; k < lb.length; k++) out.push(lb[(j + k) % lb.length]);
  return out;
}

/** Whether a loop is a face you could draw a road round: no corner turned back further than `dent`. */
function holdsTogether(loop: number[], px: ReadonlyArray<number>, pz: ReadonlyArray<number>, dent: number): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i + n - 1) % n], b = loop[i], c = loop[(i + 1) % n];
    const ux = px[b] - px[a], uz = pz[b] - pz[a];
    const wx = px[c] - px[b], wz = pz[c] - pz[b];
    const turn = ux * wz - uz * wx;
    if (turn <= 0 && -turn > dent * Math.sqrt((ux * ux + uz * uz) * (wx * wx + wz * wz))) return false;
  }
  return true;
}

/** Where a polygon's weight sits, and how much ground it covers. */
function centreOf(loop: number[], px: ReadonlyArray<number>, pz: ReadonlyArray<number>): { cx: number; cz: number; area: number } {
  let twice = 0, cx = 0, cz = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const cross = px[a] * pz[b] - px[b] * pz[a];
    twice += cross;
    cx += (px[a] + px[b]) * cross;
    cz += (pz[a] + pz[b]) * cross;
  }
  if (twice === 0) return { cx: px[loop[0]], cz: pz[loop[0]], area: 0 };
  return { cx: cx / (3 * twice), cz: cz / (3 * twice), area: Math.abs(twice) / 2 };
}

/**
 * A uniform grid of face ids over the map.
 *
 * The hexagon world answered "which face is this?" with arithmetic and no lookup at all, which an
 * irregular mesh cannot do. So every face is filed under the grid squares its bounding box touches
 * and a query tests the handful of faces filed under its own square. With squares about as wide as
 * the closest two crossroads come, that handful is three or four, and the cost of the whole lookup
 * stays well under the cost of the noise that displaces the point before it is asked.
 *
 * Flat typed arrays rather than arrays of arrays because this crosses into a Web Worker with the
 * rest of the mesh, and because it is read once per tile of every chunk in the world.
 */
export function indexFaces(
  faces: ReadonlyArray<Polygon>,
  px: ReadonlyArray<number>,
  pz: ReadonlyArray<number>,
  cell: number,
): FaceIndex {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const face of faces) {
    for (const c of face.corners) {
      if (px[c] < minX) minX = px[c];
      if (px[c] > maxX) maxX = px[c];
      if (pz[c] < minZ) minZ = pz[c];
      if (pz[c] > maxZ) maxZ = pz[c];
    }
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);

  const faceStart = new Int32Array(faces.length + 1);
  for (let i = 0; i < faces.length; i++) faceStart[i + 1] = faceStart[i] + faces[i].corners.length;
  const faceCorners = new Int32Array(faceStart[faces.length]);
  faces.forEach((face, i) => faceCorners.set(face.corners, faceStart[i]));

  /** The block of grid squares a face's bounding box covers, clamped to the grid. */
  const box = (face: Polygon): { x0: number; z0: number; x1: number; z1: number } => {
    let lx = Infinity, lz = Infinity, hx = -Infinity, hz = -Infinity;
    for (const c of face.corners) {
      if (px[c] < lx) lx = px[c];
      if (px[c] > hx) hx = px[c];
      if (pz[c] < lz) lz = pz[c];
      if (pz[c] > hz) hz = pz[c];
    }
    return {
      x0: Math.max(0, Math.floor((lx - minX) / cell)), x1: Math.min(cols - 1, Math.floor((hx - minX) / cell)),
      z0: Math.max(0, Math.floor((lz - minZ) / cell)), z1: Math.min(rows - 1, Math.floor((hz - minZ) / cell)),
    };
  };

  const cellStart = new Int32Array(cols * rows + 1);
  for (const face of faces) {
    const b = box(face);
    for (let j = b.z0; j <= b.z1; j++) for (let i = b.x0; i <= b.x1; i++) cellStart[j * cols + i + 1]++;
  }
  for (let i = 0; i < cols * rows; i++) cellStart[i + 1] += cellStart[i];
  const cellFaces = new Int32Array(cellStart[cols * rows]);
  const fill = cellStart.slice(0, cols * rows);
  faces.forEach((face, id) => {
    const b = box(face);
    for (let j = b.z0; j <= b.z1; j++) for (let i = b.x0; i <= b.x1; i++) cellFaces[fill[j * cols + i]++] = id;
  });

  const vx = Float64Array.from(px);
  const vz = Float64Array.from(pz);
  return { cell, minX, minZ, cols, rows, cellStart, cellFaces, faceStart, faceCorners, vx, vz };
}

/**
 * The face a point falls in, or -1 outside the map.
 *
 * The crossing test is used rather than anything cleverer because it decides a point on a shared
 * border in favour of exactly one of the two faces: the comparison is strict on one side and not
 * on the other, so no point in the world is in two faces and none is in none of them.
 */
export function faceUnder(ix: FaceIndex, x: number, z: number): number {
  const i = Math.floor((x - ix.minX) / ix.cell);
  const j = Math.floor((z - ix.minZ) / ix.cell);
  if (i < 0 || j < 0 || i >= ix.cols || j >= ix.rows) return -1;
  const from = ix.cellStart[j * ix.cols + i], to = ix.cellStart[j * ix.cols + i + 1];
  for (let c = from; c < to; c++) {
    const face = ix.cellFaces[c];
    const start = ix.faceStart[face], end = ix.faceStart[face + 1];
    let inside = false;
    for (let a = start, b = end - 1; a < end; b = a++) {
      const ax = ix.vx[ix.faceCorners[a]], az = ix.vz[ix.faceCorners[a]];
      const bx = ix.vx[ix.faceCorners[b]], bz = ix.vz[ix.faceCorners[b]];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    if (inside) return face;
  }
  return -1;
}
