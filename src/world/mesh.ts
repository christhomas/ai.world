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
  /** How coarse the noise that decides land from sea is. Smaller means bigger continents. */
  CONTINENT_SCALE: 0.0022,
  /** Above this, a face is dry. The sea takes everything below it. */
  SHORE: -0.3,
  /** And above this, dry land stands up as a mountain region. */
  PEAKS: 0.26,
  /** Share of inland faces that hold a lake instead of open ground. */
  LAKE_SHARE: 0.07,
  /** Faces nearer the rim than this fraction of the world radius are always sea, so the map ends in water. */
  RIM: 0.86,
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

export interface MeshFace {
  id: number;
  /** Where the face sits: the lattice point it grew from, which is inside it whatever the jitter. */
  cx: number;
  cz: number;
  kind: FaceKind;
  /** Corner indices, going round. Six of them; the jitter is what makes them look otherwise. */
  corners: number[];
  /** Face id across each edge, in the same order as `corners`. -1 where the world ends. */
  neighbours: number[];
}

export interface WorldMesh {
  seed: number;
  radius: number;
  vertices: MeshVertex[];
  faces: MeshFace[];
  /** The face a point falls in, or null past the edge of the world. */
  faceAt(x: number, z: number): MeshFace | null;
  /** Whether a point is somewhere you could stand: inside a face that is not water. */
  isLand(x: number, z: number): boolean;
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
  const faceByAxial = new Map<string, number>();

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

  // how far out the lattice has to run to cover the disc
  const span = Math.ceil(radius / (size * 1.5)) + 2;
  for (let r = -span; r <= span; r++) {
    for (let q = -span; q <= span; q++) {
      const { x, z } = hexCentre(q, r, size);
      const away = Math.hypot(x, z);
      if (away > radius + size) continue;
      const id = faces.length;
      faceByAxial.set(`${q},${r}`, id);
      faces.push({
        id, cx: x, cz: z, kind: FaceKind.Sea,
        corners: hexCorners(x, z, size).map((c) => vertexAt(c.x, c.z)),
        neighbours: [],
      });
    }
  }

  // neighbours, once every face exists
  for (let r = -span; r <= span; r++) {
    for (let q = -span; q <= span; q++) {
      const id = faceByAxial.get(`${q},${r}`);
      if (id === undefined) continue;
      faces[id].neighbours = NEIGHBOURS.map((n) => faceByAxial.get(`${q + n.q},${r + n.r}`) ?? -1);
    }
  }

  // what each face is made of. Noise rather than a die, so neighbours agree and the land comes out
  // in continents instead of confetti; the rim is drowned so the world ends in open sea.
  const lakeRoll = mulberry32(derive(seed, SALT.MESH ^ 0x5eed));
  for (const face of faces) {
    const away = Math.hypot(face.cx, face.cz);
    const rim = away / radius;
    if (rim > MESH.RIM) { face.kind = FaceKind.Sea; continue; }
    const height = shape.fbm(face.cx * MESH.CONTINENT_SCALE, face.cz * MESH.CONTINENT_SCALE, 4)
      - Math.max(0, (rim - 0.5) * 1.2);       // fall away towards the rim so coasts are not a circle
    if (height < MESH.SHORE) { face.kind = FaceKind.Sea; continue; }
    face.kind = height > MESH.PEAKS ? FaceKind.Mountain : FaceKind.Land;
  }
  for (const face of faces) {
    if (face.kind !== FaceKind.Land) continue;
    // a lake only where the ground around it is dry, so lakes are inland and not bites out of a coast
    if (face.neighbours.some((n) => n === -1 || faces[n].kind === FaceKind.Sea)) continue;
    if (lakeRoll() < MESH.LAKE_SHARE) face.kind = FaceKind.Lake;
  }

  // the middle of the world is where the player starts, so it had better be walkable
  const hub = faceAtLattice(0, 0);
  if (hub && hub.kind !== FaceKind.Land) hub.kind = FaceKind.Land;

  function faceAtLattice(x: number, z: number): MeshFace | null {
    const { q, r } = hexAt(x, z, size);
    const id = faceByAxial.get(`${q},${r}`);
    return id === undefined ? null : faces[id];
  }

  return {
    seed,
    radius,
    vertices,
    faces,
    faceAt(x, z) {
      const face = faceAtLattice(x, z);
      if (!face) return null;
      return Math.hypot(face.cx, face.cz) > radius + size ? null : face;
    },
    isLand(x, z) {
      const face = faceAtLattice(x, z);
      return face !== null && (face.kind === FaceKind.Land || face.kind === FaceKind.Mountain);
    },
  };
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
