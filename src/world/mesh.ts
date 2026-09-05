import { GRAPH } from '../core/config';
import { hash3, mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Simplex2D } from './noise';

/**
 * The world as a mesh of polygons.
 *
 * The old world was a road tree with land painted along it: walkable ground meant "within W tiles
 * of a road". That makes ribbons. Measured across a finished world, the land was fifteen tiles
 * wide at the median and twenty-eight at its widest, which is why every large cliff in the game
 * turned out to be coastline and why a mountain the width of a real mountain could not be put
 * anywhere at all.
 *
 * So the primitive here is the face, not the road. The plane is tiled with polygons; each one is
 * sea, lake, open land or mountain; and land is somewhere inside a land face rather than near a
 * line. Neighbouring land faces merge into expanses of any size, water faces are the sea and the
 * lakes, and the border between the two is a coastline that costs nothing to find. The corners of
 * the polygons are the crossroads and the edges between them are the roads that may be built, so
 * the road network stops being a tree that land hangs off and becomes a web laid over the country.
 *
 * Hexagons rather than a Delaunay triangulation, for one reason worth stating: every corner is
 * shared by exactly three faces and every face has exactly six neighbours, so the topology needs
 * no computing and cannot come out malformed. The corners are then pushed about by a hash of
 * their own position, which is what stops it looking like a beehive; faces of the same kind are
 * merged when anything asks about territory, so a "polygon" as the player meets it is a run of
 * three to a dozen hexes with a ragged border, not a hexagon.
 *
 * Everything comes from the world seed, so the same seed is the same world on every machine and
 * for the life of the world, exactly as the road tree was.
 */

export const MESH = {
  /** Distance from a face's middle to its corners, in tiles, before the corners are jittered. */
  FACE_RADIUS: 42,
  /**
   * How far a corner may be pushed from where the lattice put it, as a share of the radius. Past
   * about a third the polygons start to turn inside out; well under it and they still read hexagonal.
   */
  JITTER: 0.3,
  /**
   * How many hexes are glued together into one region, at most.
   *
   * Hexagons alone give the game away however much they are jittered: every corner has exactly
   * three roads leaving it at a hundred and twenty degrees, and the eye reads that as a lattice
   * immediately. Glueing them into clumps of two to five gives regions of five to a dozen sides
   * with corners of every angle, and roads run along the borders between regions rather than along
   * every hex edge — so what is drawn is territories, not a honeycomb.
   */
  CLUMP: 5,
  /** How coarse the noise that decides land from sea is. Smaller means bigger continents. */
  CONTINENT_SCALE: 0.0022,
  /** Above this, a face is dry. The sea takes everything below it. */
  SHORE: -0.3,
  /** And above this, dry land stands up as a mountain region. */
  PEAKS: 0.26,
  /**
   * How many islands a world is guaranteed, and how far out they stand.
   *
   * The mesh throws off islands by itself, but only sometimes — two worlds in six, of three faces
   * each. An island is somewhere to sail to and one of the few reasons to own a boat, so a couple
   * are made on purpose: a land region well out from the middle has its land neighbours drowned
   * until the sea goes all the way round it.
   */
  ISLANDS: 3,
  ISLAND_OUT: 0.45,
  /** Share of inland faces that hold a lake instead of open ground. */
  LAKE_SHARE: 0.07,
  /** Faces nearer the rim than this fraction of the world radius are always sea, so the map ends in water. */
  RIM: 0.86,
  /**
   * How far a point is displaced before it is asked which face it is in, in tiles, and how coarse
   * that displacement is.
   *
   * Without it a face border is a straight hexagon edge, and the coastline comes out ruled. The
   * point is moved rather than the border, which costs two evaluations instead of remeshing, and
   * gives bays, spits and headlands that are the same on every machine because they come from the
   * seed and the position and nothing else.
   */
  WARP: 34,
  WARP_SCALE: 0.009,
  /**
   * How many octaves of noise the displacement is made of, and how each one compares to the last.
   *
   * One octave was not enough and the reason is worth writing down: a single wave whose length is
   * about the width of a hex moves whole hexes around without changing their shape, so the coast
   * came out as a chain of gently bent hexagon edges — "too uniform and too regular", which is
   * exactly what it looked like. Coastlines are rough at every scale at once. The first octave
   * swings whole headlands out into the sea, the second cuts bays into those headlands, and the
   * third frets the edges of the bays; together they hide the lattice the land is grown on.
   *
   * Three, because the fourth is finer than a tile and nobody would ever see it.
   */
  WARP_OCTAVES: 3,
  /** How much quieter each octave is than the one before, and how much shorter its waves. */
  WARP_GAIN: 0.5,
  WARP_LACUNARITY: 2.7,
} as const;

/** What a face is made of. The player meets these as territories, not as polygons. */
export const enum FaceKind {
  Sea = 0,
  Lake = 1,
  Land = 2,
  Mountain = 3,
}

export interface MeshVertex {
  x: number;
  z: number;
}

/** A run of hexes glued together: what the player meets as one stretch of country. */
export interface MeshRegion {
  id: number;
  kind: FaceKind;
  /** Face ids belonging to it. */
  faces: number[];
  cx: number;
  cz: number;
}

export interface MeshFace {
  id: number;
  /** The region this hex was glued into. Its kind is the region's kind. */
  region: number;
  /** Where the face sits: the lattice point it grew from, which is inside it whatever the jitter. */
  cx: number;
  cz: number;
  kind: FaceKind;
  /** Corner indices, going round. Six of them; the jitter is what makes them look otherwise. */
  corners: number[];
  /** Face id across each edge, in the same order as `corners`. -1 where the world ends. */
  neighbours: number[];
}

/**
 * The mesh, as plain data.
 *
 * Deliberately without methods on it: the graph is handed to a Web Worker to build chunks off the
 * main thread, and a structured clone cannot carry a function. So the lookups are free functions
 * that take the mesh, and the lattice index is a typed array rather than a Map for the same
 * reason — it crosses the wire and it is read for every tile in the world.
 */
export interface WorldMesh {
  seed: number;
  radius: number;
  /** Lattice spacing the faces were laid out on, before their corners were pushed about. */
  size: number;
  /** How far the lattice runs either side of the middle, which is what indexes `lattice`. */
  span: number;
  /** Face id at each lattice position, -1 where there is none. Indexed by (r + span, q + span). */
  lattice: Int32Array;
  vertices: MeshVertex[];
  faces: MeshFace[];
  /** The hexes glued into territories. A face's kind is its region's kind. */
  regions: MeshRegion[];
}

/**
 * The face a point falls in, or null past the edge of the world.
 *
 * The point is pushed about by a little noise first, which is what turns the hexagon borders into
 * a coastline. Two faces asked about the same point are pushed the same way, so the borders stay
 * shared and nothing tears.
 */
export function faceAt(mesh: WorldMesh, x: number, z: number): MeshFace | null {
  const wx = x + roughen(mesh.seed, x, z) * MESH.WARP;
  const wz = z + roughen(mesh.seed ^ 0x9e37, x, z) * MESH.WARP;
  const { q, r } = hexAt(wx, wz, mesh.size);
  if (Math.abs(q) > mesh.span || Math.abs(r) > mesh.span) return null;
  const id = mesh.lattice[(r + mesh.span) * (2 * mesh.span + 1) + (q + mesh.span)];
  return id < 0 ? null : mesh.faces[id];
}

/** Whether a point is somewhere you could stand: inside a face that is not water. */
export function isLand(mesh: WorldMesh, x: number, z: number): boolean {
  const face = faceAt(mesh, x, z);
  return face !== null && (face.kind === FaceKind.Land || face.kind === FaceKind.Mountain);
}

/** Axial hex coordinates, which is the lattice the faces are laid out on. */
interface Axial { q: number; r: number; }

const SQRT3 = Math.sqrt(3);

/** Middle of the hex at (q, r), in tiles. Pointy-topped, so rows interlock along x. */
function hexCentre(q: number, r: number, size: number): { x: number; z: number } {
  return { x: size * SQRT3 * (q + r / 2), z: size * 1.5 * r };
}

/** Which hex a point falls in. Standard cube rounding, done on the lattice before any jitter. */
function hexAt(x: number, z: number, size: number): Axial {
  const r = (2 / 3) * z / size;
  const q = (SQRT3 / 3) * x / size - r / 2;
  // round in cube space so the three coordinates keep summing to zero
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** The six corners of a hex, before jitter. Pointy-topped: the first corner is due north. */
function hexCorners(cx: number, cz: number, size: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 90);
    out.push({ x: cx + size * Math.cos(angle), z: cz + size * Math.sin(angle) });
  }
  return out;
}

/** The six neighbours of a hex, in the same order as its corners' edges. */
const NEIGHBOURS: ReadonlyArray<Axial> = [
  { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
  { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
];

/**
 * Noise at several scales at once, in the range of roughly a half either way.
 *
 * A coastline is rough at every scale — headlands with bays cut into them and the bays themselves
 * fretted — and one wave cannot do that. This stacks a few, each shorter and quieter than the last,
 * and divides by the total so the result keeps the range a single octave had and WARP goes on
 * meaning what it meant.
 */
function roughen(seed: number, x: number, z: number): number {
  let sum = 0, amplitude = 1, frequency = MESH.WARP_SCALE, loudest = 0;
  for (let octave = 0; octave < MESH.WARP_OCTAVES; octave++) {
    // each octave gets its own seed, or they would all be the same wave at different sizes and the
    // sum would have a visible grain running through it
    sum += wobble(seed ^ Math.imul(octave + 1, 0x85ebca6b), x * frequency, z * frequency) * amplitude;
    loudest += amplitude;
    amplitude *= MESH.WARP_GAIN;
    frequency *= MESH.WARP_LACUNARITY;
  }
  return sum / loudest;
}

/** Smooth value noise from a hash: no object to build, so it can be used from a free function. */
function wobble(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const ex = fx * fx * (3 - 2 * fx), ez = fz * fz * (3 - 2 * fz);
  const at = (ix: number, iz: number): number => {
    const h = Math.imul(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed, 0x9e3779b1);
    return ((h >>> 8) & 0xffff) / 0xffff - 0.5;
  };
  const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
  return (a + (b - a) * ex) * (1 - ez) + (c + (d - c) * ex) * ez;
}

/** A key that two faces sharing a corner both arrive at, so the corner is one vertex and not three. */
function cornerKey(x: number, z: number): string {
  return `${Math.round(x * 8)},${Math.round(z * 8)}`;
}

/**
 * Grow the world's polygons.
 *
 * The lattice decides the topology and the seed decides everything else: where each corner is
 * actually pushed to, which faces are dry, which of the dry ones stand up as mountains, and which
 * hollows hold a lake.
 */
export function generateMesh(seed: number, radius = GRAPH.RADIUS): WorldMesh {
  const size = MESH.FACE_RADIUS;
  const shape = new Simplex2D(derive(seed, SALT.MESH));
  const vertices: MeshVertex[] = [];
  const byKey = new Map<string, number>();
  const faces: MeshFace[] = [];
  const span = Math.ceil(radius / (size * 1.5)) + 2;
  const stride = 2 * span + 1;
  const lattice = new Int32Array(stride * stride).fill(-1);
  const latticeAt = (q: number, r: number): number =>
    (Math.abs(q) > span || Math.abs(r) > span) ? -1 : lattice[(r + span) * stride + (q + span)];

  /** One vertex per corner position, jittered once and then shared by all three faces. */
  const vertexAt = (x: number, z: number): number => {
    const key = cornerKey(x, z);
    const known = byKey.get(key);
    if (known !== undefined) return known;
    // pushed by a hash of where it is, so every face that meets here agrees on where "here" is
    const rng = mulberry32(hash3(seed, Math.round(x * 8), Math.round(z * 8), SALT.MESH & 0xffff));
    const angle = rng() * Math.PI * 2;
    const push = rng() * MESH.JITTER * size;
    const id = vertices.length;
    vertices.push({ x: x + Math.cos(angle) * push, z: z + Math.sin(angle) * push });
    byKey.set(key, id);
    return id;
  };

  for (let r = -span; r <= span; r++) {
    for (let q = -span; q <= span; q++) {
      const { x, z } = hexCentre(q, r, size);
      const away = Math.hypot(x, z);
      if (away > radius + size) continue;
      const id = faces.length;
      lattice[(r + span) * stride + (q + span)] = id;
      faces.push({
        id, region: -1, cx: x, cz: z, kind: FaceKind.Sea,
        corners: hexCorners(x, z, size).map((c) => vertexAt(c.x, c.z)),
        neighbours: [],
      });
    }
  }

  // neighbours, once every face exists
  for (let r = -span; r <= span; r++) {
    for (let q = -span; q <= span; q++) {
      const id = latticeAt(q, r);
      if (id < 0) continue;
      faces[id].neighbours = NEIGHBOURS.map((n) => latticeAt(q + n.q, r + n.r));
    }
  }

  // Glue the hexes into regions. Grown rather than diced so a region is a connected clump, and
  // grown in face order so the same seed clumps them the same way.
  const clumpRoll = mulberry32(derive(seed, SALT.MESH ^ 0xc1a3));
  const regions: MeshRegion[] = [];
  for (const face of faces) {
    if (face.region >= 0) continue;
    const id = regions.length;
    const mine: number[] = [face.id];
    face.region = id;
    const want = 1 + Math.floor(clumpRoll() * MESH.CLUMP);
    // breadth-first over free neighbours, so a clump stays in a lump rather than trailing away
    for (let head = 0; head < mine.length && mine.length < want; head++) {
      for (const n of faces[mine[head]].neighbours) {
        if (mine.length >= want) break;
        if (n < 0 || faces[n].region >= 0) continue;
        faces[n].region = id;
        mine.push(n);
      }
    }
    let cx = 0, cz = 0;
    for (const f of mine) { cx += faces[f].cx; cz += faces[f].cz; }
    regions.push({ id, kind: FaceKind.Sea, faces: mine, cx: cx / mine.length, cz: cz / mine.length });
  }

  // what each region is made of. Noise rather than a die, so neighbours agree and the land comes
  // out in continents instead of confetti; the rim is drowned so the world ends in open sea.
  const lakeRoll = mulberry32(derive(seed, SALT.MESH ^ 0x5eed));
  for (const region of regions) {
    const rim = Math.hypot(region.cx, region.cz) / radius;
    if (rim > MESH.RIM) { region.kind = FaceKind.Sea; continue; }
    const height = shape.fbm(region.cx * MESH.CONTINENT_SCALE, region.cz * MESH.CONTINENT_SCALE, 4)
      - Math.max(0, (rim - 0.5) * 1.2);       // fall away towards the rim so coasts are not a circle
    if (height < MESH.SHORE) { region.kind = FaceKind.Sea; continue; }
    region.kind = height > MESH.PEAKS ? FaceKind.Mountain : FaceKind.Land;
  }
  for (const region of regions) {
    if (region.kind !== FaceKind.Land) continue;
    // a lake only where the ground around it is dry, so lakes are inland and not bites out of a coast
    const touchesSea = region.faces.some((f) => faces[f].neighbours
      .some((n) => n === -1 || (faces[n].region !== region.id && regions[faces[n].region]?.kind === FaceKind.Sea)));
    if (touchesSea) continue;
    if (lakeRoll() < MESH.LAKE_SHARE) region.kind = FaceKind.Lake;
  }
  for (const face of faces) face.kind = regions[face.region].kind;

  // Islands, made by raising the sea rather than by drowning the land. The first attempt cut
  // them loose from the coast, and doing that safely is impossible: a "neighbour" can be the
  // continent, and seed 1 lost two fifths of its mainland to make four islands. Lifting an
  // offshore region that is already surrounded by water cannot damage anything.
  const dryKind = (k: FaceKind): boolean => k === FaceKind.Land || k === FaceKind.Mountain;
  const openSea = regions
    .filter((r) => r.kind === FaceKind.Sea)
    .filter((r) => r.faces.length <= 3)
    .filter((r) => {
      const away = Math.hypot(r.cx, r.cz);
      // out to very nearly the edge: the genuinely open water, which is where an island belongs,
      // lies past the line where the map starts drowning itself
      if (away < radius * MESH.ISLAND_OUT || away > radius * 0.97) return false;
      // every face of it must have open water all the way round, or it is a peninsula
      return r.faces.every((f) => faces[f].neighbours.every((n) =>
        n < 0 || faces[n].region === r.id || !dryKind(faces[n].kind)));
    })
    .sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));

  for (const island of openSea.slice(0, MESH.ISLANDS)) {
    island.kind = FaceKind.Land;
    for (const f of island.faces) faces[f].kind = FaceKind.Land;
  }

  // the middle of the world is where the player starts, so it had better be walkable
  const hubId = latticeAt(0, 0);
  if (hubId >= 0 && faces[hubId].kind !== FaceKind.Land) {
    const region = regions[faces[hubId].region];
    region.kind = FaceKind.Land;
    for (const f of region.faces) faces[f].kind = FaceKind.Land;
  }

  return { seed, radius, size, span, lattice, vertices, faces, regions };
}

/** Every face reachable from `start` over faces of the same kind: one territory, however shaped. */
export function territoryOf(mesh: WorldMesh, start: MeshFace): MeshFace[] {
  const want = start.kind;
  const seen = new Set<number>([start.id]);
  const out: MeshFace[] = [start];
  const queue = [start];
  while (queue.length > 0) {
    const face = queue.pop()!;
    for (const n of face.neighbours) {
      if (n < 0 || seen.has(n)) continue;
      const next = mesh.faces[n];
      if (next.kind !== want) continue;
      seen.add(n);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}
