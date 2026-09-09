import { mulberry32, rand2, shuffle } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { Biome } from './biomes';
import type { RoadEdge, RoadGraph, RoadNode } from './graph';
import { facesIn } from './localmesh';
import { hashOfName, junctionsOf, roadsOf, townAt, type Junction, type Land, type Road } from './localroads';
import { Simplex2D } from './noise';
import type { Within } from './window';

/**
 * The roads of one patch of an endless country, in the shape the rest of the game already reads.
 *
 * `roadweb.ts` builds the same thing for a world with an edge, and cannot build it for a world
 * without one: it walks a spanning tree out from the middle to give every crossroads a parent and a
 * depth, smooths the terraces along that tree, and consumes one number from a single stream of
 * randomness per road in a fixed order. Every one of those is an answer that depends on the whole
 * map, and in an endless world there is no whole map to depend on.
 *
 * So each of them is replaced by something a patch can work out alone:
 *
 * - **Which roads there are** comes from `localroads`, where a road is a border between two faces
 *   and belongs to the pair rather than to a network.
 * - **Where a road bends** is hashed from the road's own name instead of drawn from a stream, so
 *   the same road bends the same way whichever patch it is asked about, or in none at all.
 * - **How high a crossroads sits** is read off a slow field rather than smoothed outward from a
 *   hub. The field is gentle enough over the distance between two crossroads that a road climbs at
 *   most one terrace, which is what the smoothing was for; `localgraph.test.ts` holds it to that.
 *
 * What is not replaced here is what nothing local reads yet. `parent`, `depth` and `size` describe
 * a tree that does not exist, and the two things that read them — where a river rises and how big a
 * village grows — are their own units of this work. They are left at the values a lone crossroads
 * would have rather than filled with a plausible lie.
 */

/** How the roads of a patch are drawn. `roadweb.ts`'s numbers, since they are the same roads. */
const LOCAL = {
  /** How many pieces a road is bent into, and how far it may wander from the straight line. */
  BENDS: 3,
  WANDER: 0.19,
  /** Half-width of the road surface itself, in tiles. */
  ROAD_WIDTH: 2.2,
  /**
   * How the ground a road sits on rises, in terraces, and how slowly it varies.
   *
   * Far slower than the bounded world's field, and that is the whole trick. There the terraces were
   * smoothed along a spanning tree afterwards, so the field could be as rough as it liked; here
   * there is no tree to smooth along, so the field itself has to be gentle enough that two
   * crossroads a road apart are never more than a terrace out. A wavelength of some thousands of
   * tiles against a road of a hundred is that, with room to spare.
   */
  LEVEL_RANGE: 3,
  LEVEL_SCALE: 0.0004,
  /**
   * How far outside the window the country is worked out, in the world's own spacing.
   *
   * A road is only built when both of its ends are known, and its ends are crossroads that may lie
   * outside the window. Three faces' worth reaches past any road that touches the window, so the
   * roads inside it are the same ones a wider patch would find there.
   */
  ROOM: 3,
} as const;

/** The roads, crossroads and towns of one patch, as a graph. */
export function graphIn(world: Land, within: Within): RoadGraph {
  const margin = world.dials.far * LOCAL.ROOM;
  const faces = facesIn(world, {
    x0: within.x0 - margin, z0: within.z0 - margin, x1: within.x1 + margin, z1: within.z1 + margin,
  });

  // Every crossroads and every road the patch can see, each found once however many faces mention
  // it — which is the point of naming both after the faces they belong to rather than numbering
  // them.
  const junctions = new Map<string, Junction>();
  const roads = new Map<string, Road>();
  for (const face of faces) {
    for (const junction of junctionsOf(world, face)) junctions.set(junction.id, junction);
    for (const road of roadsOf(world, face)) roads.set(road.between.join('|'), road);
  }

  // Numbered in name order, so a patch built twice numbers them the same way. The numbers mean
  // nothing outside this graph: two patches that overlap agree about where a road *is*, not about
  // what it is called in an array.
  const named = [...junctions.keys()].sort();
  const indexOf = new Map<string, number>(named.map((id, i) => [id, i]));
  const nodes: RoadNode[] = named.map((id) => {
    const junction = junctions.get(id)!;
    return {
      x: junction.x, z: junction.z, parent: -1, depth: 0, size: 1,
      level: levelAt(world.seed, junction.x, junction.z),
    };
  });

  const edges: RoadEdge[] = [];
  for (const road of [...roads.values()].sort(byName)) {
    const ends = endsOf(road, named);
    if (!ends) continue;                        // one end is past the margin: another patch's road
    bend(world.seed, nodes, edges, indexOf.get(ends[0])!, indexOf.get(ends[1])!, road);
  }

  // The towns, which are junctions that said they were towns. Only those inside the window: a town
  // in the margin belongs to the patch it is in, and would otherwise be founded twice.
  const towns: number[] = [];
  for (const id of named) {
    const junction = junctions.get(id)!;
    if (junction.x < within.x0 || junction.x > within.x1) continue;
    if (junction.z < within.z0 || junction.z > within.z1) continue;
    if (townAt(world, junction)) towns.push(indexOf.get(id)!);
  }

  return {
    seed: world.seed,
    // how far the patch reaches, which is all a patch has. Nothing here is measured against the
    // edge of a world, because there is not one
    radius: Math.hypot(within.x1 - within.x0, within.z1 - within.z0) / 2,
    nodes, edges, towns,
    islands: [], mainlandNodes: nodes.length,
    ...sectorsFor(world.seed),
  };
}

/**
 * How high the ground stands here, in terraces, before it is cut into terraces.
 *
 * The field the terraces are rounded from, and worth having on its own: water runs down a slope
 * rather than down a staircase, and a river that took its heading from the rounded number would
 * see one flat step for a hundred tiles and no reason to go anywhere. Rounded, this is the height
 * a crossroads sits at; unrounded, it is the hill the rivers come off.
 */
export function groundAt(seed: number, x: number, z: number): number {
  const h = (fieldFor(seed).fbm(x * LOCAL.LEVEL_SCALE, z * LOCAL.LEVEL_SCALE, 2) + 1) * 0.5;
  return 1 + h * LOCAL.LEVEL_RANGE;
}

/**
 * How high the ground a crossroads stands on is, in terraces.
 *
 * A pure function of the place, which is the whole requirement: two patches that both hold a
 * crossroads must put it at the same height or the road between them is a cliff in one and a slope
 * in the other.
 */
export function levelAt(seed: number, x: number, z: number): number {
  return Math.max(1, Math.round(groundAt(seed, x, z)));
}

/** The terrace field of a world, made once. Building one per crossroads is most of a patch's time. */
const fields = new Map<number, Simplex2D>();
function fieldFor(seed: number): Simplex2D {
  let field = fields.get(seed);
  if (!field) { field = new Simplex2D(derive(seed, SALT.LOCAL_ROAD)); fields.set(seed, field); }
  return field;
}

/** The two crossroads a road runs between: the ones named after both of its faces. */
function endsOf(road: Road, named: string[]): [string, string] | null {
  const [a, b] = road.between;
  const found = named.filter((id) => {
    const around = id.split('|');
    return around.includes(a) && around.includes(b);
  });
  return found.length === 2 ? [found[0], found[1]] : null;
}

/**
 * Draw one road between two crossroads, bent.
 *
 * A road drawn straight from corner to corner draws the mesh: you can see the polygons through it.
 * The bend hides that and is what a road does anyway, since nobody ever laid one along a ruler —
 * but the swing has to come from the road itself rather than from a stream of numbers, or a road
 * bends one way in the patch that starts west of it and another in the patch that starts east.
 */
function bend(seed: number, nodes: RoadNode[], edges: RoadEdge[], a: number, b: number, road: Road): void {
  const key = hashOfName(road.between.join('|'));
  const swing = (rand2(derive(seed, SALT.LOCAL_ROAD), key, 0, 0) * 2 - 1) * LOCAL.WANDER;
  const from = nodes[a], to = nodes[b];
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len, pz = dx / len;

  let prev = a;
  for (let k = 1; k < LOCAL.BENDS; k++) {
    const t = k / LOCAL.BENDS;
    // a single arc rather than a jagged line: nought at both ends, most of it in the middle
    const off = Math.sin(t * Math.PI) * swing * len;
    const mid = nodes.length;
    nodes.push({
      x: from.x + dx * t + px * off,
      z: from.z + dz * t + pz * off,
      parent: -1, depth: 0, size: 1,
      level: Math.round(from.level + (to.level - from.level) * t),
    });
    edges.push({ a: prev, b: mid, width: Infinity, roadWidth: LOCAL.ROAD_WIDTH, loop: false });
    prev = mid;
  }
  edges.push({ a: prev, b, width: Infinity, roadWidth: LOCAL.ROAD_WIDTH, loop: false });
}

/** Roads in a fixed order, so a patch built twice builds them in the same one. */
function byName(a: Road, b: Road): number {
  return a.between.join('|') < b.between.join('|') ? -1 : 1;
}

/**
 * The biome pie, as the bounded world draws it.
 *
 * A wedge of desert that runs outward for ever is not what an endless world wants, and this is
 * kept only because `biomeAt` still reads it. What replaces it is a field like the one the land
 * itself comes from, which is its own piece of work.
 */
function sectorsFor(seed: number): { sectors: Biome[]; sectorOffset: number } {
  const rng = mulberry32(derive(seed, SALT.ROAD_RNG));
  return {
    sectors: shuffle(rng, [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow]),
    sectorOffset: rng() * Math.PI * 2,
  };
}
