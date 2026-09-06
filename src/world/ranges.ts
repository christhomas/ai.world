import { WORLD } from '../core/config';
import { mulberry32, rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { FaceKind, faceAt, type WorldMesh } from './mesh';
import type { Massif } from './mountains';

/**
 * Mountains as polygons, not as a hill turned up.
 *
 * The layer this replaces stood a smooth dome on the map wherever the mesh said mountain: a circle
 * of raised ground, sampled tile by tile, flat on top because the alternative was a cone. Played,
 * it read as a grey mesa — the map underneath said "range" and the thing you walked up to said
 * "somebody dragged the terrain brush in a circle".
 *
 * The mesh already holds the shape a mountain wants. A face is a polygon of three to six sides,
 * sixty-odd tiles across, and the faces the generator marked as mountain run together into
 * territories. So a range is built the way a range looks: a peak over the middle of each face, the
 * corners it shares with its neighbours held down to make cols between the peaks, and the border
 * of the whole territory at ground level. Fan the triangles from the peak to the corners and the
 * result is a handful of enormous flat faces per mountain — which is the low-poly language the
 * rest of the game is drawn in, rather than a heightfield pretending to be rock.
 *
 * Three things come free from doing it this way, and they are the reason it is the right shape
 * rather than merely a better-looking one.
 *
 * The passes. Roads in this world are drawn along the borders between faces, and a border is where
 * this holds the ground down. A road through mountain country therefore threads the valleys
 * between the peaks without anything having to carve it a corridor.
 *
 * The ridges. Two mountain faces that share an edge share its two corners, so they agree exactly
 * about the height along it. A range is continuous, with a saddle where the faces meet, and no
 * seam can open between them because there is only one number.
 *
 * The scale. A face is not a tile. One mountain is six or eight triangles instead of four thousand
 * quads, so the whole of a world's mountain country costs less to draw than a single chunk of
 * ground does.
 */

export const RANGE = {
  /**
   * How high a peak stands above the ground it grows out of, in world units.
   *
   * Answerable to the camera, which is fixed at forty-five degrees and cannot step back. The
   * picture is half the zoom tall — fifteen world units above the hero at the ordinary zoom — so a
   * peak of fifty-five was a black wall filling the screen from its own foot, and no amount of
   * looking up made that a view rather than an obstruction. At thirty-four a mountain is still
   * twice anything else in the world and you can see past it.
   */
  TALLEST: 34,
  SHORTEST: 19,
  /**
   * How much of that a face gets for being large.
   *
   * Faces differ in area by five times over. Height entirely by die means a tiddler standing as
   * high as a face four times its width, which looks like a spike rather than a mountain; height
   * entirely by area means every range is a staircase of tidy sizes. Two thirds area, one third
   * die.
   */
  BY_AREA: 0.66,
  /**
   * Where a corner shared by mountain faces stands, as a share of the lower of the peaks it is
   * shared between.
   *
   * This is the single number that decides whether a range reads as a range. At 0 the faces are
   * separate pyramids with a slot between each pair; at 1 the whole territory is one slab with
   * bumps. Just under half leaves a col deep enough to see the sky through from the valley floor
   * and high enough to be a climb rather than a walk.
   */
  COL: 0.42,
  /**
   * How much face there has to be per peak, in tiles of area.
   *
   * A face is sixty to a hundred and fifty tiles across, and one peak on it is one mountain: a
   * range came out as a handful of separate cones with flat ground between them. Above this much
   * area a face carries a second peak, and above twice it a third, so a wide territory reads as a
   * chain with saddles between the summits — which is what makes it a range rather than a row.
   */
  PER_PEAK: 5200,
  /** However big the face, never more than this many, or a range turns into a bed of nails. */
  MOST_PEAKS: 3,
  /** The least a second or third summit stands, as a share of the tallest on its face. */
  LESSER: 0.55,
  /**
   * How far a peak sits from the middle of its face, as a share of the face's own reach, and the
   * quietest and loudest a face may push it.
   *
   * Dead centre reads as manufactured — every mountain a perfect fan seen from above. Pushing the
   * apex off-centre gives one long flank and one short steep one, which is what a mountain has.
   */
  LEAN: 0.3,
  /**
   * How much of its face a mountain actually stands on.
   *
   * The first version ran the rock all the way out to the polygon's own corners, and a face is a
   * hundred and fifty tiles across: fifty-five units of height spread over seventy-five tiles of
   * ground is a one-in-one-and-a-half ramp, which from a camera looking down at forty-five degrees
   * is a grey stain on the map rather than a mountain. Pulled in to under two thirds, the same
   * height stands on half the ground and the flanks are steep enough to read as rock. What is
   * given up is that neighbouring mountains no longer share their corners exactly — they overlap
   * instead, which draws as a saddle between two peaks and is what a range looks like anyway.
   */
  SPREAD: 0.62,
  /**
   * How far below the ground the border of a range is buried, in world units.
   *
   * Nought would put the rim exactly in the plane of the terraced ground it meets, and two
   * surfaces in one plane flicker against each other as the camera moves. Buried, the ground hides
   * the seam and the mountain grows out of it instead of resting on it.
   */
  BURY: 0.75,
  /**
   * How many times each triangle of a fan is cut into four, and how rough the cutting is.
   *
   * A fan alone is a tent: five or six enormous flat planes meeting at a point, which is a
   * polygon, not a mountain. Every cut adds a vertex at the middle of each edge and moves it up or
   * down by a share of that edge's own length, so the surface gains ridges at every scale down to
   * the last cut — the same trick a fractal landscape is made with, applied to a shape the map
   * chose rather than to a square of noise.
   *
   * Four cuts take a sixty-tile face down to triangles about four tiles across, which is the scale
   * the eye reads as rock. It also multiplies the triangle count by two hundred and fifty-six: a
   * world's mountains go from twenty triangles to about five thousand, which is still less than
   * two chunks of ground.
   *
   * The displacement is a hash of the two ends of the edge being cut, so both triangles sharing an
   * edge move its midpoint to exactly the same place and the surface cannot tear. It is also why
   * the mountains are the same every time the world is opened.
   */
  CUTS: 4,
  /** How far a midpoint moves, as a share of the length of the edge it sits on. */
  ROUGH: 0.34,
  /**
   * How much of that a low-lying midpoint gets.
   *
   * Full roughness everywhere puts crags on the valley floor and lifts the borders the roads run
   * along, which is exactly where the ground has to stay flat. Scaled by how high the edge already
   * is, the peaks are ragged and the passes stay passes.
   */
  ROUGH_FLOOR: 0.12,
  /**
   * The walled-in village: how far the wall stands from the middle of it, as a share of the
   * village's own radius, and how high it goes.
   *
   * The wall has to stand clear of the houses — a village lays itself out before any of this is
   * built, and rock through somebody's roof is not a feature — and near enough that it is plainly
   * the wall of *that* village rather than hills in the distance.
   */
  BOWL_OUT: 3.2,
  /** How thick the wall is, as a share of where it stands: the crest sits between these. */
  BOWL_INNER: 0.72,
  BOWL_OUTER: 1.34,
  /** How high the wall stands, in world units. Lower than a peak: it is a wall, not a mountain. */
  BOWL_HIGH: 34,
  /** However small the village, the wall stands at least this far out, in tiles. */
  BOWL_LEAST: 62,
  /** And it is never put round a village this near the middle of the world, where the hero starts. */
  BOWL_CLEAR_OF_START: 220,
  /**
   * How wide the gate is where a road crosses the wall, in tiles.
   *
   * The old walled village worked because roads were never lifted by the heightfield. Geometry has
   * no such manners, so the wall is cut down to the ground wherever a road runs through it. Wide
   * enough for the road and its verge, narrow enough that the wall still reads as a wall.
   */
  BOWL_GATE: 9,
  /**
   * How far from a peak still counts as being near it, in tiles.
   *
   * Wider than the mountain itself: what this measures is country in the shadow of a range, which
   * is where the springs are and where somebody would say they live in the mountains.
   */
  NEARBY: 150,
  /** Cell size of the lookup grid, in tiles. About a third of a face, so a cell meets few faces. */
  CELL: 20,
} as const;

/** One mountain face, as the triangle fan it is drawn and walked as. */
export interface Peak {
  /** The mesh face this grew from, so anything asking can find its way back to the map. */
  face: number;
  /** The region — the range this peak is one of. */
  range: number;
  /** Where the apex stands, and how high above the ground at that point. */
  x: number;
  z: number;
  lift: number;
  /** And where that puts it in the world, which is what a camera trying to frame it needs. */
  y: number;
}

/**
 * The world's mountains, as geometry.
 *
 * Positions are absolute world coordinates and `y` is absolute world height, because the thing
 * this describes is a solid standing in the world rather than an offset to be added to something
 * else. That is the whole difference from the layer it replaces.
 */
export interface Ranges {
  /** Three vertices a triangle, nine floats: x, y, z each. */
  tris: Float32Array;
  /** Which peak each triangle belongs to, one entry per triangle. */
  owner: Int32Array;
  peaks: Peak[];
  /** The walled-in village, when this world has one. */
  bowl: Bowl | null;
  /** Triangle ids by grid cell, for asking what is under a point without testing every triangle. */
  index: TriIndex;
}

/** A uniform grid of triangle ids: the same trick the mesh uses for faces, at a smaller scale. */
export interface TriIndex {
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** Where each cell's ids start in `ids`, with one extra entry so a cell's end is the next start. */
  starts: Int32Array;
  ids: Int32Array;
}

/** Height of the ground a mountain grows out of, in world units, at a point. */
export type GroundAt = (x: number, z: number) => number;

/**
 * The walled village to build, and how to find the roads that must be left open through its wall.
 *
 * Optional as a whole: the water asks for the mountains before there are villages to wall in, and
 * gets a world without one, which is right — a wall is not a mountain and nothing about the rivers
 * depends on it.
 */
export interface WalledVillage {
  bowl: Bowl;
  /** How far a point is from the middle of the nearest road, in tiles. */
  roadAway: (x: number, z: number) => number;
}

/**
 * Grow the mountains of a world.
 *
 * `ground` is asked only at the corners and apexes — a few hundred points for a whole world rather
 * than one per tile — because everything between them is the plane of a triangle. It has to be the
 * settled ground *without* mountains on it, which it now always is: nothing adds mountains to the
 * heightfield any more.
 */
export function buildRanges(mesh: WorldMesh, ground: GroundAt, walled?: WalledVillage): Ranges {
  const rng = mulberry32(derive(mesh.seed, SALT.MOUNTAINS));

  // Which faces are mountain, and how big each is relative to the biggest of them. Relative rather
  // than absolute so a world of small faces still has tall mountains in it.
  const mountains = mesh.faces.filter((f) => f.kind === FaceKind.Mountain);
  const widest = mountains.reduce((most, f) => Math.max(most, f.area), 1);

  /**
   * How high each face's apex stands. Rolled for every face in id order rather than only for the
   * mountains, so that adding or removing a mountain somewhere else in the world cannot shift the
   * height of this one: the same seed has to grow the same country every time it is opened.
   */
  const lift = new Float32Array(mesh.faces.length);
  for (const face of mesh.faces) {
    const die = rng();
    if (face.kind !== FaceKind.Mountain) continue;
    const room = Math.sqrt(face.area / widest);
    const share = room * RANGE.BY_AREA + die * (1 - RANGE.BY_AREA);
    lift[face.id] = RANGE.SHORTEST + share * (RANGE.TALLEST - RANGE.SHORTEST);
  }

  /**
   * How high each corner of the mesh stands.
   *
   * A corner is held at ground level unless every face meeting there is a mountain — one foot in
   * open country and the range has to come down to meet it, which is what makes a range end rather
   * than break off. Corners deep inside a range stand at a share of the lowest peak around them,
   * so the col between two mountains belongs to the smaller of the two.
   */
  const cornerLift = new Float32Array(mesh.vertices.length);
  const allMountain = new Uint8Array(mesh.vertices.length).fill(1);
  const lowestPeak = new Float32Array(mesh.vertices.length).fill(Infinity);
  const touched = new Uint8Array(mesh.vertices.length);
  for (const face of mesh.faces) {
    for (const c of face.corners) {
      touched[c] = 1;
      if (face.kind !== FaceKind.Mountain) { allMountain[c] = 0; continue; }
      lowestPeak[c] = Math.min(lowestPeak[c], lift[face.id]);
    }
  }
  for (let v = 0; v < cornerLift.length; v++) {
    // A corner on the hull of the world has faces missing rather than faces that are not mountain,
    // and an unvisited corner belongs to no face at all; both are edges of the country and come
    // down to the ground like any other border.
    cornerLift[v] = touched[v] === 1 && allMountain[v] === 1 && lowestPeak[v] < Infinity
      ? lowestPeak[v] * RANGE.COL
      : 0;
  }

  // The fans, cut down into rock. Each face becomes one triangle per side — apex, corner, next
  // corner — and each of those is cut into four again and again, every new midpoint moved off the
  // straight line it was on. What comes out is the same mountain the polygon described, with a
  // surface at every scale between the whole face and a few tiles.
  const tallest = mountains.reduce((most, f) => Math.max(most, lift[f.id]), 1);
  const peaks: Peak[] = [];
  const tris: number[] = [];
  const owner: number[] = [];
  for (const face of mountains) {
    const reach = Math.sqrt(face.area / Math.PI);
    // How many summits this face carries. A big territory is a range and wants several; a small one
    // is a mountain and wants the one.
    const many = Math.max(1, Math.min(RANGE.MOST_PEAKS, Math.round(face.area / RANGE.PER_PEAK)));
    // where each stands: spread round the middle at a share of the reach, turned by the die so two
    // faces of the same size are not the same mountain twice
    const turn = rng() * Math.PI * 2;
    for (let p = 0; p < many; p++) {
      const lean = many === 1 ? rng() * Math.PI * 2 : turn + (p / many) * Math.PI * 2;
      const away = (many === 1 ? rng() * RANGE.LEAN : RANGE.LEAN + rng() * RANGE.LEAN * 0.5) * reach;
      const ax = face.cx + Math.cos(lean) * away;
      const az = face.cz + Math.sin(lean) * away;
      // the summits of one range differ: a chain of identical peaks is a fence
      const height = lift[face.id] * (p === 0 ? 1 : RANGE.LESSER + rng() * (1 - RANGE.LESSER));
      const id = peaks.length;
      const under = ground(ax, az);
      peaks.push({ face: face.id, range: face.region, x: ax, z: az, lift: height, y: under + height });
      const apex: Point = { x: ax, z: az, ground: under, lift: height };

      // the rim: the polygon's own shape, pulled in towards this apex so the flanks are steep. With
      // several on one face they overlap, and where two flanks cross is a saddle.
      const spread = RANGE.SPREAD / Math.sqrt(many);
      const rim = face.corners.map((c) => {
        const v = mesh.vertices[c];
        const rx = ax + (v.x - ax) * spread;
        const rz = az + (v.z - az) * spread;
        return { x: rx, z: rz, ground: ground(rx, rz), lift: cornerLift[c] * spread - RANGE.BURY };
      });
      for (let k = 0; k < rim.length; k++) {
        cut(apex, rim[k], rim[(k + 1) % rim.length], RANGE.CUTS, mesh.seed, tallest, tris, owner, id);
      }
    }
  }

  if (walled) buildWall(walled, ground, mesh.seed, tris, owner);

  const flat = new Float32Array(tris);
  return {
    tris: flat, owner: new Int32Array(owner), peaks,
    bowl: walled?.bowl ?? null,
    index: indexTriangles(flat, mesh.radius),
  };
}

/**
 * A point on the mountain being built: where it is, how high the ground under it is, and how far
 * above that the rock stands.
 *
 * The two heights are kept apart all the way down the subdivision because they behave differently.
 * The ground is what it is and is only ever averaged between neighbours; the lift is what gets
 * roughened, and how much it may be roughened depends on how high it already is — a crag belongs
 * near a summit, and the same crag on the valley floor is a boulder in the middle of a road.
 */
interface Point {
  x: number;
  z: number;
  ground: number;
  lift: number;
}

/**
 * Cut one triangle into four, and those into four again, until there is nothing left to cut.
 *
 * The midpoint of each side is displaced along the vertical by a hash of that side's two ends —
 * not by the recursion's own random source, which would give the two triangles sharing the side
 * different answers and open a seam down every edge. Because the hash is taken from the sum of the
 * coordinates it is the same whichever way round the side is handed in.
 */
function cut(
  a: Point, b: Point, c: Point, depth: number, seed: number, tallest: number,
  tris: number[], owner: number[], id: number,
): void {
  if (depth <= 0) {
    tris.push(a.x, a.ground + a.lift, a.z, b.x, b.ground + b.lift, b.z, c.x, c.ground + c.lift, c.z);
    owner.push(id);
    return;
  }
  const ab = between(a, b, seed, tallest);
  const bc = between(b, c, seed, tallest);
  const ca = between(c, a, seed, tallest);
  cut(a, ab, ca, depth - 1, seed, tallest, tris, owner, id);
  cut(ab, b, bc, depth - 1, seed, tallest, tris, owner, id);
  cut(ca, bc, c, depth - 1, seed, tallest, tris, owner, id);
  cut(ab, bc, ca, depth - 1, seed, tallest, tris, owner, id);
}

/** The midpoint of a side, moved off the straight line by an amount that side alone decides. */
function between(a: Point, b: Point, seed: number, tallest: number): Point {
  const x = (a.x + b.x) / 2;
  const z = (a.z + b.z) / 2;
  const lift = (a.lift + b.lift) / 2;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  // high ground is rough, the valley floor is not: the borders carry the roads through
  const share = RANGE.ROUGH_FLOOR + (1 - RANGE.ROUGH_FLOOR) * Math.max(0, Math.min(1, lift / tallest));
  // the sum of the two ends, so the side hashes the same from either triangle that owns it
  const die = rand2(seed, Math.round((a.x + b.x) * 4), Math.round((a.z + b.z) * 4), SALT.MOUNTAINS);
  return {
    x, z,
    ground: (a.ground + b.ground) / 2,
    // never below the ground it stands on: a mountain that digs is a hole with a view
    lift: Math.max(-RANGE.BURY, lift + (die - 0.5) * 2 * RANGE.ROUGH * span * share),
  };
}

/**
 * The wall round a walled village: a ring of high country with a flat floor inside it.
 *
 * Three rings of points and two strips of triangles between them — the outer skirt at ground level,
 * the crest, and the inner foot back at ground where the village's own fields start. Nothing is
 * done to the floor itself: the houses, the roads and the fields are the ones the village already
 * laid out, which is the whole point of walling a village in rather than building one in a crater.
 *
 * Where a road crosses, the crest comes down to the ground. That is the gate, and it is what makes
 * the place somewhere you can get into: the old walled village worked because the heightfield never
 * lifted a road, and geometry has no such manners.
 */
function buildWall(
  walled: WalledVillage, ground: GroundAt, seed: number, tris: number[], owner: number[],
): void {
  const { bowl, roadAway } = walled;
  const sides = WALL_SIDES;
  const ring = (radius: number, lift: number): Point[] => Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2;
    const x = bowl.x + Math.cos(a) * radius;
    const z = bowl.z + Math.sin(a) * radius;
    // a gate where a road already runs, and nothing but ground for its verge
    const open = Math.max(0, Math.min(1, (roadAway(x, z) - RANGE.BOWL_GATE) / RANGE.BOWL_GATE));
    return { x, z, ground: ground(x, z), lift: lift * open - (lift > 0 ? 0 : RANGE.BURY) };
  });

  const outer = ring(bowl.radius * RANGE.BOWL_OUTER, 0);
  const crest = ring(bowl.radius, RANGE.BOWL_HIGH);
  const inner = ring(bowl.radius * RANGE.BOWL_INNER, 0);

  // the two strips, each a pair of triangles per side, cut down like any other mountain face
  for (let k = 0; k < sides; k++) {
    const next = (k + 1) % sides;
    for (const [a, b, c] of [
      [outer[k], crest[k], crest[next]], [outer[k], crest[next], outer[next]],
      [crest[k], inner[k], inner[next]], [crest[k], inner[next], crest[next]],
    ] as Array<[Point, Point, Point]>) {
      cut(a, b, c, RANGE.CUTS - 1, seed, RANGE.BOWL_HIGH, tris, owner, -1);
    }
  }
}

/**
 * How many sides the wall has.
 *
 * Enough that it reads as a ring of hills rather than as a polygon fort, few enough that each side
 * is a slab of rock the size of the faces the mountains are made of, so the two look like the same
 * country.
 */
const WALL_SIDES = 14;

/** Bucket every triangle into the grid cells its bounding box covers. */
function indexTriangles(tris: Float32Array, radius: number): TriIndex {
  const reach = radius + RANGE.CELL * 2;
  const cols = Math.ceil((reach * 2) / RANGE.CELL);
  const rows = cols;
  const count = tris.length / 9;
  const counts = new Int32Array(cols * rows + 1);
  const cellOf = (v: number, min: number): number => Math.floor((v - min) / RANGE.CELL);

  // Counted first, then filled, so the whole index is two typed arrays rather than a grid of
  // arrays: it is read once per height query and the cost of a query is chasing pointers.
  const box = (t: number): { x0: number; x1: number; z0: number; z1: number } => {
    const i = t * 9;
    return {
      x0: Math.min(tris[i], tris[i + 3], tris[i + 6]),
      x1: Math.max(tris[i], tris[i + 3], tris[i + 6]),
      z0: Math.min(tris[i + 2], tris[i + 5], tris[i + 8]),
      z1: Math.max(tris[i + 2], tris[i + 5], tris[i + 8]),
    };
  };
  const clamp = (c: number, most: number): number => Math.max(0, Math.min(most - 1, c));
  for (let t = 0; t < count; t++) {
    const b = box(t);
    for (let cz = clamp(cellOf(b.z0, -reach), rows); cz <= clamp(cellOf(b.z1, -reach), rows); cz++) {
      for (let cx = clamp(cellOf(b.x0, -reach), cols); cx <= clamp(cellOf(b.x1, -reach), cols); cx++) {
        counts[cz * cols + cx + 1]++;
      }
    }
  }
  for (let c = 0; c < cols * rows; c++) counts[c + 1] += counts[c];
  const ids = new Int32Array(counts[cols * rows]);
  const at = counts.slice(0, cols * rows);
  for (let t = 0; t < count; t++) {
    const b = box(t);
    for (let cz = clamp(cellOf(b.z0, -reach), rows); cz <= clamp(cellOf(b.z1, -reach), rows); cz++) {
      for (let cx = clamp(cellOf(b.x0, -reach), cols); cx <= clamp(cellOf(b.x1, -reach), cols); cx++) {
        ids[at[cz * cols + cx]++] = t;
      }
    }
  }
  return { minX: -reach, minZ: -reach, cols, rows, starts: counts, ids };
}

/**
 * How high the mountains are over a point, or null where there are none.
 *
 * Absolute world height, and the highest surface found rather than the first: fans of neighbouring
 * faces overlap slightly where a corner is shared, and the answer a walker needs is the top.
 */
export function mountainAt(ranges: Ranges, x: number, z: number): number | null {
  const { index, tris } = ranges;
  const cx = Math.floor((x - index.minX) / RANGE.CELL);
  const cz = Math.floor((z - index.minZ) / RANGE.CELL);
  if (cx < 0 || cz < 0 || cx >= index.cols || cz >= index.rows) return null;
  const cell = cz * index.cols + cx;
  let top: number | null = null;
  for (let k = index.starts[cell]; k < index.starts[cell + 1]; k++) {
    const y = heightIn(tris, index.ids[k], x, z);
    if (y !== null && (top === null || y > top)) top = y;
  }
  return top;
}

/**
 * How high the nearest mountain stands to a point, in world units, falling off with distance.
 *
 * Not the height at the point — that is `mountainAt`, and it is nought a step outside the rock.
 * This answers "is there a mountain about here", which is the question anything siting something
 * *beside* a range has to ask: where a spring rises, where a village of miners would be, where the
 * air is thin. Nought once nothing is within reach.
 */
export function nearestLift(ranges: Ranges, x: number, z: number, reach = RANGE.NEARBY): number {
  let most = 0;
  for (const peak of ranges.peaks) {
    const away = Math.hypot(peak.x - x, peak.z - z);
    if (away >= reach) continue;
    // its full height underneath it, none of it at the edge of reach
    most = Math.max(most, peak.lift * (1 - away / reach));
  }
  return most;
}

/** Whether a point stands on mountain geometry at all: the cheap question, asked far more often. */
export function inMountains(ranges: Ranges, x: number, z: number): boolean {
  return mountainAt(ranges, x, z) !== null;
}

/**
 * Where a triangle's plane is over a point, or null when the point is outside it.
 *
 * Barycentric, which answers both questions at once: the same three numbers say whether the point
 * is inside and what the plane is worth there.
 */
function heightIn(tris: Float32Array, t: number, x: number, z: number): number | null {
  const i = t * 9;
  const x1 = tris[i], y1 = tris[i + 1], z1 = tris[i + 2];
  const x2 = tris[i + 3], y2 = tris[i + 4], z2 = tris[i + 5];
  const x3 = tris[i + 6], y3 = tris[i + 7], z3 = tris[i + 8];
  const det = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3);
  if (det === 0) return null;              // a sliver with no area: nothing stands on it
  const a = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / det;
  const b = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / det;
  const c = 1 - a - b;
  if (a < 0 || b < 0 || c < 0) return null;
  return a * y1 + b * y2 + c * y3;
}

/** How steep the mountain is under a point, as a fall in world units per tile walked. */
export function slopeAt(ranges: Ranges, x: number, z: number): number {
  const here = mountainAt(ranges, x, z);
  if (here === null) return 0;
  let most = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const near = mountainAt(ranges, x + dx, z + dz);
    if (near !== null) most = Math.max(most, Math.abs(near - here));
  }
  return most;
}

/** A village with a ring of high country round it, and the roads it already had as the way in. */
export interface Bowl {
  village: string;
  x: number;
  z: number;
  /** Where the crest of the wall stands, in tiles from the middle. */
  radius: number;
}

/**
 * Which village, if any, is walled into the mountains.
 *
 * One in a world. Never the one nearest the middle, because the hero starts there and being walled
 * in on your first morning is a cage rather than a discovery; never one already standing in
 * mountain country, which has walls of its own; and only where there is dry land all the way round,
 * since a wall with a bay in it is not a wall. The one furthest out that passes is chosen, so the
 * walled village is somewhere you arrive at rather than somewhere you begin.
 */
export function planBowl(
  mesh: WorldMesh,
  villages: ReadonlyArray<{ name: string; x: number; z: number; radius: number }>,
  onLand: (x: number, z: number) => boolean,
): Bowl | null {
  const ringed = (x: number, z: number, radius: number): boolean => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (!onLand(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return false;
    }
    return true;
  };
  const candidates = villages
    .filter((v) => Math.hypot(v.x, v.z) > RANGE.BOWL_CLEAR_OF_START)
    .filter((v) => faceAtKind(mesh, v.x, v.z) !== FaceKind.Mountain)
    .map((v) => ({ v, radius: Math.max(v.radius * RANGE.BOWL_OUT, RANGE.BOWL_LEAST) }))
    .filter(({ v, radius }) => ringed(v.x, v.z, radius * RANGE.BOWL_OUTER))
    .sort((a, b) => Math.hypot(b.v.x, b.v.z) - Math.hypot(a.v.x, a.v.z));
  const chosen = candidates[0];
  return chosen ? { village: chosen.v.name, x: chosen.v.x, z: chosen.v.z, radius: chosen.radius } : null;
}

/** What kind of country a point stands in, or Sea past the edge of the world. */
function faceAtKind(mesh: WorldMesh, x: number, z: number): FaceKind {
  const face = faceAt(mesh, x, z);
  return face ? face.kind : FaceKind.Sea;
}

/**
 * A world's mountains as they finally stand: the ranges, and the one village walled into them.
 *
 * The two are built together because they are the same rock and share one lookup — a walker asking
 * what is underfoot should not have to ask twice — and because the bowl needs the villages, which
 * are the last thing a world grows.
 */
export function growRanges(
  mesh: WorldMesh,
  ground: GroundAt,
  villages: ReadonlyArray<{ name: string; x: number; z: number; radius: number }>,
  onLand: (x: number, z: number) => boolean,
  roadAway: (x: number, z: number) => number,
): Ranges {
  const bowl = planBowl(mesh, villages, onLand);
  return buildRanges(mesh, ground, bowl ? { bowl, roadAway } : undefined);
}

/**
 * The lift of a world's mountains, with no ground under them.
 *
 * The water has to know where the high ground is, and it has to know before the ground is settled —
 * the real ranges stand on a ground the rivers have not finished cutting. Only the lift matters for
 * that, and the lift is identical either way, because a range carries its ground and its lift
 * separately all the way down. So this is the same mountains, measured from nothing.
 */
export function liftField(mesh: WorldMesh): Ranges {
  return buildRanges(mesh, () => 0);
}

/**
 * How many terraces the mountains add at a point, for anything that counts in terraces.
 *
 * The ground is measured in half-unit steps and the rock in world units, and a number that means
 * one thing here and another there is the sort of thing that is only ever found by a river running
 * uphill.
 */
export function terracesAt(ranges: Ranges, x: number, z: number): number {
  return Math.max(0, (mountainAt(ranges, x, z) ?? 0) / WORLD.STEP);
}

/**
 * The mountains of a polygon world, described the way the older mountains were.
 *
 * Eyries and sky islands are placed against mountains — a village in the clouds hangs over one, and
 * the eagles that carry you up perch on its shoulder — and both were written against `Massif`, the
 * dome that the polygon ranges replaced. Rather than teach them a second kind of mountain, the new
 * kind describes itself in the old terms: where it stands, how far it reaches, how high it is.
 *
 * Without this both features quietly vanished from every polygon world, which is exactly the sort
 * of loss that leaves no error behind it — the eagles simply were not there, and nothing said so.
 */
export function rangesAsMassifs(ranges: Ranges, mesh: WorldMesh | null): Massif[] {
  return ranges.peaks.map((peak) => ({
    x: peak.x,
    z: peak.z,
    // the reach of the face it stands on, pulled in the same way the rock itself is, so a bird
    // lands on the shoulder of the mountain that is actually there
    radius: Math.sqrt((mesh?.faces[peak.face]?.area ?? 0) / Math.PI) * RANGE.SPREAD,
    // terraces, because that is what a Massif counts in and what everything reading one expects
    height: peak.lift / WORLD.STEP,
    hollow: 0,
  }));
}

/** A terrace's worth of height, so callers can talk in the units the rest of the ground uses. */
export const terracesOf = (units: number): number => units / WORLD.STEP;
