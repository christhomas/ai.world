import { GRAPH } from '../core/config';
import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Simplex2D } from './noise';
import { faceUnder, indexFaces, scatterPoints, weldPolygons, type FaceIndex } from './polygons';

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
 * line. Neighbouring land faces run together into expanses of any size, water faces are the sea
 * and the lakes, and the border between the two is a coastline that costs nothing to find. The
 * corners of the polygons are the crossroads and the edges between them are the roads that may be
 * built, so the road network stops being a tree that land hangs off and becomes a web laid over
 * the country.
 *
 * The first version of this tiled the plane with hexagons, on the reasoning that a lattice cannot
 * come out malformed and jittering its corners would hide it. It could not, and the reason is
 * worth writing down because it is the whole argument for the machinery below. A lattice has one
 * cell size and one cell shape, and every corner in it has exactly three roads leaving at a
 * hundred and twenty degrees. Noise added afterwards can move that, but it cannot add variety
 * that was never generated: the verdict on the finished thing was "a uniform, boring world with no
 * variety and no randomness, everything is fixed and predictable", and the map read as a repeating
 * pattern from the first glance.
 *
 * So the faces are made rather than laid out. Points are scattered with a spacing that itself
 * varies across the map, they are triangulated, and neighbouring triangles are welded together
 * into faces of three to six sides — so the country is a mixture of triangles, quadrilaterals,
 * pentagons and hexagons of several different sizes, and a crossroads has three, four or five
 * roads leaving it depending on how many faces happen to meet there.
 *
 * Everything comes from the world seed, so the same seed is the same world on every machine and
 * for the life of the world, exactly as the road tree was.
 */

export const MESH = {
  /**
   * How closely the crossroads are scattered in the fine-grained country and in the open country,
   * in tiles.
   *
   * The gap between the two is the point: it is what stops every territory being the same size.
   * Both together set how far apart the roads are, since a road runs along a face border — near 34
   * and far 62 give a world of a couple of hundred faces, which is a road every seventy tiles or
   * so in the close country and every hundred and twenty in the open. Halve them and the map turns
   * into a net; double them and a face is bigger than the view and the polygons stop reading as
   * territories at all.
   */
  NEAR: 34,
  FAR: 62,
  /**
   * How coarsely the close country gives way to the open country.
   *
   * A wavelength of about four hundred tiles, so a world holds a handful of each rather than one
   * of each (which reads as a gradient across the map) or dozens (which averages back out to one
   * spacing everywhere and undoes the whole idea).
   */
  GRAIN: 0.0026,
  /** How many places a crossroads tries to grow a neighbour before it gives up. */
  TRIES: 22,
  /**
   * How far past the world's edge the points are scattered, in tiles.
   *
   * Points have to reach beyond the radius for two reasons: the rim of a point set has no
   * polygons worth the name, only the long slivers that close off its hull, and a lookup displaces
   * the point it is given — by up to half of WARP, since the noise runs a half either way — before
   * it asks anything. Both want a margin, and this is comfortably more than either needs.
   */
  OUTSIDE: 80,
  /**
   * Relative appetite for three, four, five and six sides.
   *
   * Weighted rather than uniform because the welding is not free: a face may be refused its sixth
   * side because the neighbour it would have taken has already grown, or because the result would
   * be dented, and every refusal lands in a lower bucket. Asking for more of the larger faces than
   * you want is what makes the four come out in comparable numbers.
   */
  APPETITE: [1, 1.2, 1.6, 2.4],
  /** The fewest roads that may leave a crossroads, so a junction is a junction. */
  MIN_ROADS: 3,
  /** How much of a dent a face may have in it. See `WeldDials.dent`. */
  DENT: 0.5,
  /**
   * How wide a square of the lookup grid is, in tiles.
   *
   * About the closest two crossroads ever come, which keeps three or four faces filed under a
   * typical square: small enough that a lookup tests a handful of polygons rather than a hundred,
   * large enough that a big face is not filed under fifty squares.
   */
  INDEX_CELL: 34,
  /** How coarse the noise that decides land from sea is. Smaller means bigger continents. */
  CONTINENT_SCALE: 0.0022,
  /** Above this, a face is dry. The sea takes everything below it. */
  SHORE: -0.3,
  /** And above this, dry land stands up as mountain country. */
  PEAKS: 0.26,
  /**
   * How many islands a world is guaranteed, and how far out they stand.
   *
   * The mesh throws off islands by itself, but only sometimes. An island is somewhere to sail to
   * and one of the few reasons to own a boat, so a couple are made on purpose: a face of open
   * water well out from the middle, with nothing but water all round it, is lifted into land.
   * Lifting water can never damage a coast, which drowning land repeatedly did.
   */
  ISLANDS: 3,
  ISLAND_OUT: 0.45,
  /** Share of inland faces that hold a lake instead of open ground. */
  LAKE_SHARE: 0.07,
  /**
   * How likely a lake is to take in one more face, each time it is offered one.
   *
   * A single face is a tarn and several are a loch, and a world wants both. Rolled per neighbour
   * rather than fixed, so the sizes come out spread instead of all being the same.
   */
  LAKE_SPREAD: 0.45,
  /** Faces nearer the rim than this fraction of the world radius are always sea, so the map ends in water. */
  RIM: 0.86,
  /**
   * How far a point is displaced before it is asked which face it is in, in tiles, and how coarse
   * that displacement is.
   *
   * Without it a face border is a straight line, and the coastline comes out ruled. The point is
   * moved rather than the border, which costs a few noise evaluations instead of remeshing, and
   * gives bays, spits and headlands that are the same on every machine because they come from the
   * seed and the position and nothing else.
   *
   * A hundred is more than twice the width of a face, and it has to be: anything much less and the
   * straight border can still be read through the coast it makes. It buys that at a price paid in
   * `WEB.FOOTHOLD` — the further the coast wanders from the border it was drawn from, the more
   * borders end up under water and cannot carry a road.
   */
  WARP: 100,
  WARP_SCALE: 0.009,
  /**
   * How many octaves of noise the displacement is made of, and how each one compares to the last.
   *
   * One octave was not enough and the reason is worth writing down: a single wave about as long as
   * a face is wide moves whole faces around without changing their shape, so the coast came out as
   * a chain of gently bent straight edges — "too uniform and too regular", which is exactly what it
   * looked like. Coastlines are rough at every scale at once. The first octave swings whole
   * headlands out into the sea, the second cuts bays into those headlands, the third frets the
   * edges of the bays and the fourth roughens the fretting.
   *
   * Four rather than three, and each one louder relative to the last than it used to be: measured
   * as coastline length over the square root of the land it encloses, the fourth octave is worth
   * as much roughness as raising the displacement by a third, and it does not push any more of the
   * road network out to sea to get it. The fifth would be finer than a tile and nobody would see it.
   */
  WARP_OCTAVES: 4,
  /** How much quieter each octave is than the one before, and how much shorter its waves. */
  WARP_GAIN: 0.62,
  WARP_LACUNARITY: 2.4,
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

/** Every face you can walk between without changing what you are walking on: one territory. */
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
  /** The territory this face is part of. Its kind is the region's kind and the region's is its. */
  region: number;
  /** The area centroid, which is inside the face: where the face "is", for anything that asks. */
  cx: number;
  cz: number;
  /** How much ground it covers, in tiles. Faces differ by several times over, which is the idea. */
  area: number;
  kind: FaceKind;
  /** Corner indices, going round. Three to six of them. */
  corners: number[];
  /** Face id across each edge, in the same order as `corners`. -1 where the world ends. */
  neighbours: number[];
}

/**
 * The mesh, as plain data.
 *
 * Deliberately without methods on it: the graph is handed to a Web Worker to build chunks off the
 * main thread, and a structured clone cannot carry a function. So the lookups are free functions
 * that take the mesh, and the spatial index is a bundle of typed arrays for the same reason — it
 * crosses the wire and it is read for every tile in the world.
 */
export interface WorldMesh {
  seed: number;
  radius: number;
  /**
   * The radius of a middling face, in tiles.
   *
   * Faces are all different sizes now, so this is the one number that stands for "about how big is
   * a face" — the half-width a massif or an island is scaled by. Measured off the finished mesh
   * rather than declared, so it stays true when the spacing is retuned.
   */
  size: number;
  /** Which face is under a point, without asking every face. */
  index: FaceIndex;
  vertices: MeshVertex[];
  faces: MeshFace[];
  /** The faces run together into territories. A face's kind is its region's kind. */
  regions: MeshRegion[];
}

/**
 * The face a point falls in, or null past the edge of the world.
 *
 * The point is pushed about by a little noise first, which is what turns the polygon borders into
 * a coastline. Two faces asked about the same point are pushed the same way, so the borders stay
 * shared and nothing tears.
 */
export function faceAt(mesh: WorldMesh, x: number, z: number): MeshFace | null {
  roughen(mesh.seed, x, z);
  const id = faceUnder(mesh.index, x + drift.x * MESH.WARP, z + drift.z * MESH.WARP);
  return id < 0 ? null : mesh.faces[id];
}

/** Whether a point is somewhere you could stand: inside a face that is not water. */
export function isLand(mesh: WorldMesh, x: number, z: number): boolean {
  const face = faceAt(mesh, x, z);
  return face !== null && (face.kind === FaceKind.Land || face.kind === FaceKind.Mountain);
}

/** Land or mountain: ground you can put your foot on, as opposed to sea or lake. */
const dryKind = (kind: FaceKind): boolean => kind === FaceKind.Land || kind === FaceKind.Mountain;

/**
 * Where `roughen` leaves its answer, each coordinate roughly a half either way.
 *
 * A returned pair would be an object allocated on every lookup, and a lookup happens for every
 * tile of every chunk in the world and twice a pixel while the map is drawn. Written to rather
 * than returned, and read straight away by the one caller: nothing here is re-entrant, and each
 * worker has its own copy of the module.
 */
const drift = { x: 0, z: 0 };

/**
 * Noise at several scales at once, in both directions at once.
 *
 * A coastline is rough at every scale — headlands with bays cut into them and the bays themselves
 * fretted — and one wave cannot do that. This stacks a few, each shorter and quieter than the last,
 * and divides by the total so the result keeps the range a single octave had and WARP goes on
 * meaning what it meant.
 *
 * The displacement is two-dimensional and hashing the lattice a second time for the second
 * direction was half the cost of a lookup, so both come out of the same four hashes: one from bits
 * eight to twenty-three and the other from sixteen to thirty-one. They share a byte, which is
 * worth a word. The byte they share is the top of one number and the bottom of the other, so it
 * carries two hundred and fifty-six times the weight in the first as it does in the second, and
 * what correlation that leaves between the two is well under a per cent — far below anything the
 * eye could pick out of a coastline.
 */
function roughen(seed: number, x: number, z: number): void {
  let sumX = 0, sumZ = 0, amplitude = 1, frequency = MESH.WARP_SCALE, loudest = 0;
  for (let octave = 0; octave < MESH.WARP_OCTAVES; octave++) {
    // each octave gets its own seed, or they would all be the same wave at different sizes and the
    // sum would have a visible grain running through it
    const spin = seed ^ Math.imul(octave + 1, 0x85ebca6b);
    const px = x * frequency, pz = z * frequency;
    const x0 = Math.floor(px), z0 = Math.floor(pz);
    const fx = px - x0, fz = pz - z0;
    const ex = fx * fx * (3 - 2 * fx), ez = fz * fz * (3 - 2 * fz);
    const ha = hashAt(spin, x0, z0), hb = hashAt(spin, x0 + 1, z0);
    const hc = hashAt(spin, x0, z0 + 1), hd = hashAt(spin, x0 + 1, z0 + 1);
    sumX += blend(low(ha), low(hb), low(hc), low(hd), ex, ez) * amplitude;
    sumZ += blend(high(ha), high(hb), high(hc), high(hd), ex, ez) * amplitude;
    loudest += amplitude;
    amplitude *= MESH.WARP_GAIN;
    frequency *= MESH.WARP_LACUNARITY;
  }
  drift.x = sumX / loudest;
  drift.z = sumZ / loudest;
}

/** One lattice corner's hash. No object to build, so it can be used from a free function. */
function hashAt(seed: number, ix: number, iz: number): number {
  return Math.imul(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed, 0x9e3779b1);
}

const low = (h: number): number => ((h >>> 8) & 0xffff) / 0xffff - 0.5;
const high = (h: number): number => ((h >>> 16) & 0xffff) / 0xffff - 0.5;

/** Smoothly across a lattice square, given its four corners and the eased fractions. */
function blend(a: number, b: number, c: number, d: number, ex: number, ez: number): number {
  return (a + (b - a) * ex) * (1 - ez) + (c + (d - c) * ex) * ez;
}

/**
 * Grow the world's polygons.
 *
 * The seed decides everything: where the crossroads fall, how the triangles between them are
 * welded into faces, which faces are dry, which of the dry ones stand up as mountains, and which
 * hollows hold a lake.
 */
export function generateMesh(seed: number, radius = GRAPH.RADIUS): WorldMesh {
  const grain = new Simplex2D(derive(seed, SALT.MESH ^ 0x9a17));
  const shape = new Simplex2D(derive(seed, SALT.MESH));

  const { px, pz } = scatterPoints(
    mulberry32(derive(seed, SALT.MESH)),
    (x, z) => (grain.fbm(x * MESH.GRAIN, z * MESH.GRAIN, 2) + 1) * 0.5,
    { reach: radius + MESH.OUTSIDE, near: MESH.NEAR, far: MESH.FAR, tries: MESH.TRIES },
  );
  const polygons = weldPolygons(
    mulberry32(derive(seed, SALT.MESH ^ 0xc1a3)), px, pz,
    { appetite: MESH.APPETITE, minRoads: MESH.MIN_ROADS, dent: MESH.DENT },
  );

  const vertices: MeshVertex[] = px.map((x, i) => ({ x, z: pz[i] }));
  const faces: MeshFace[] = polygons.map((p, id) => ({
    id, region: -1, cx: p.cx, cz: p.cz, area: p.area, kind: FaceKind.Sea,
    corners: p.corners, neighbours: p.neighbours,
  }));
  // the middling face rather than the average one: a handful of enormous slivers close off the
  // hull, and an average would let them speak for the whole country
  const areas = polygons.map((p) => p.area).sort((a, b) => a - b);
  const middling = areas.length > 0 ? areas[areas.length >> 1] : MESH.NEAR * MESH.NEAR;
  const mesh: WorldMesh = {
    seed, radius, vertices, faces, regions: [],
    // the radius of a hexagon of that area, so the number means what it meant when the world was
    // a hexagon lattice and everything downstream was tuned against it
    size: Math.sqrt(middling / 2.598),
    index: indexFaces(polygons, px, pz, MESH.INDEX_CELL),
  };

  // What each face is made of. Noise rather than a die, so neighbours agree and the land comes out
  // in continents instead of confetti; the rim is drowned so the world ends in open sea.
  for (const face of faces) {
    const rim = Math.hypot(face.cx, face.cz) / radius;
    if (rim > MESH.RIM) { face.kind = FaceKind.Sea; continue; }
    const height = shape.fbm(face.cx * MESH.CONTINENT_SCALE, face.cz * MESH.CONTINENT_SCALE, 4)
      - Math.max(0, (rim - 0.5) * 1.2);       // fall away towards the rim so coasts are not a circle
    if (height < MESH.SHORE) { face.kind = FaceKind.Sea; continue; }
    face.kind = height > MESH.PEAKS ? FaceKind.Mountain : FaceKind.Land;
  }

  // Lakes, in the hollows that have dry ground all the way round them, so a lake is inland water
  // and never a bite taken out of a coast. Grown into their neighbours rather than being one face
  // each, because a world wants tarns and lochs and not one size of pond.
  const lakeRoll = mulberry32(derive(seed, SALT.MESH ^ 0x5eed));
  const inland = (face: MeshFace): boolean =>
    face.kind === FaceKind.Land && face.neighbours.every((n) => n >= 0 && dryKind(faces[n].kind));
  for (const face of faces) {
    if (!inland(face) || lakeRoll() >= MESH.LAKE_SHARE) continue;
    face.kind = FaceKind.Lake;
    for (const n of face.neighbours) {
      if (lakeRoll() >= MESH.LAKE_SPREAD || !inland(faces[n])) continue;
      faces[n].kind = FaceKind.Lake;
    }
  }

  // Islands, made by raising the sea rather than by drowning the land. The first attempt cut them
  // loose from the coast, and doing that safely is impossible: a "neighbour" can be the continent,
  // and seed 1 lost two fifths of its mainland to make four islands. Lifting a face of open water
  // that already has water all round it cannot damage anything.
  const offshore = faces
    .filter((f) => f.kind === FaceKind.Sea)
    .filter((f) => {
      const away = Math.hypot(f.cx, f.cz);
      // out to very nearly the edge: the genuinely open water, which is where an island belongs,
      // lies past the line where the map starts drowning itself
      if (away < radius * MESH.ISLAND_OUT || away > radius * 0.97) return false;
      return f.neighbours.every((n) => n < 0 || !dryKind(faces[n].kind));
    })
    .sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
  for (const island of offshore.slice(0, MESH.ISLANDS)) island.kind = FaceKind.Land;

  // The middle of the world is where the player starts, so it had better be walkable — and walkable
  // for some way around, because the clearing the hero wakes up in is wider than one small face.
  const hub = faceAt(mesh, 0, 0);
  if (hub && hub.kind !== FaceKind.Land) {
    hub.kind = FaceKind.Land;
    for (const n of hub.neighbours) {
      if (n >= 0 && !dryKind(faces[n].kind)) faces[n].kind = FaceKind.Land;
    }
  }

  // and finally the territories: everywhere you can walk to without the ground changing under you.
  // Grown from the kinds rather than the kinds from them, so a region is a real stretch of country
  // — one mountain range, one lake, one sea — and not a bookkeeping clump.
  for (const face of faces) {
    if (face.region >= 0) continue;
    const id = mesh.regions.length;
    const mine: number[] = [face.id];
    face.region = id;
    for (let head = 0; head < mine.length; head++) {
      for (const n of faces[mine[head]].neighbours) {
        if (n < 0 || faces[n].region >= 0 || faces[n].kind !== face.kind) continue;
        faces[n].region = id;
        mine.push(n);
      }
    }
    let cx = 0, cz = 0, weight = 0;
    for (const f of mine) { cx += faces[f].cx * faces[f].area; cz += faces[f].cz * faces[f].area; weight += faces[f].area; }
    mesh.regions.push({
      id, kind: face.kind, faces: mine,
      cx: weight > 0 ? cx / weight : faces[face.id].cx,
      cz: weight > 0 ? cz / weight : faces[face.id].cz,
    });
  }

  return mesh;
}

/** Every face reachable from `start` over faces of the same kind: one territory, however shaped. */
export function territoryOf(mesh: WorldMesh, start: MeshFace): MeshFace[] {
  return mesh.regions[start.region].faces.map((f) => mesh.faces[f]);
}
