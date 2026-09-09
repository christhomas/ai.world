import { rand2 } from '../core/rng';
import { derive } from '../core/salts';
import { faceOf, onTheHalfwayLine, type Corner, type Country, type Face } from './localmesh';
import type { Site } from './scattercells';

/**
 * Roads, crossroads and towns, decided where they are rather than from the middle outwards.
 *
 * The web this world runs on is built from the mesh: a border between two dry faces is a road, a
 * corner where roads meet is a crossroads, and towns are chosen from the crossroads. All of that is
 * local in spirit and none of it was in practice. `generateWebGraph` walks the whole mesh, numbers
 * every corner in one fixed order, and then builds a tree out of the network from the hub outwards —
 * so a town's rank, its size and even whether it exists depend on a traversal of the entire country.
 * There is no way to ask what stands a hundred miles east without building everything in between.
 *
 * Three replacements, each of them the same rule stated locally:
 *
 * A **road** is a border, so it belongs to the two faces that share it. Both compute the same
 * halfway line — that was B2 — so both compute the same road, and a road built from the east is the
 * road built from the west.
 *
 * A **crossroads** is a corner where three faces meet, so its name is those three faces. That falls
 * out of the mesh being Voronoi and it is the piece that makes the rest work: any of the three can
 * name the junction without asking the others, and all three name it the same.
 *
 * A **town** stands at a crossroads if the crossroads says so — a hash of its name, weighed against
 * how many roads meet there and whether the ground is worth living on. Not by rank in a tree that
 * cannot exist, and not by a count of everything else in the world.
 */

/** Salts, so the four questions asked of a junction cannot be the same number. */
const OF_A_TOWN = 0x4a71;
const OF_A_NAME = 0x9c2d;
const OF_A_SIZE = 0x33bd;

/** What the ground has to be for a road to run on it, sampled along a border rather than at its ends. */
const FOOTING = [0.15, 0.35, 0.5, 0.65, 0.85] as const;
const FOOTHOLD = 4;

/** A world, as roads need it: the mesh, and whether a given spot is dry. */
export interface Land extends Country {
  /** Is there walkable ground here? The same question the sampler answers for the drawn world. */
  land: (x: number, z: number) => boolean;
}

/** A road: the border between two faces, and the ground it runs over. */
export interface Road {
  /** The two faces it lies between, in a fixed order, which is the road's name. */
  between: [string, string];
  /** Its two ends, which are crossroads. */
  ends: [Corner, Corner];
  /** How far it runs. */
  length: number;
}

/** A crossroads: where three or more faces meet, named by the faces that meet there. */
export interface Junction {
  /** The faces around it, sorted — the same name computed from any of them. */
  id: string;
  x: number;
  z: number;
  /** How many roads run into it. A dead end has one; a proper crossroads has three or more. */
  roads: number;
}

/** A town, if one stands at a junction. */
export interface Town {
  id: string;
  name: string;
  x: number;
  z: number;
  /** One to three: a hamlet, a village, a market town. */
  level: number;
}

/** The name of a road, from the two faces it lies between: the same either way round. */
export function roadName(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Is there a road along the border between these two faces?
 *
 * Both sides dry, and ground the whole way along rather than merely at the ends — the ends are
 * shared with the next border round, and one wet corner would otherwise cut a whole junction out of
 * the web. Sampled at five places, four of which must be land, which is the rule the drawn world
 * already uses.
 */
export function roadBetween(world: Land, face: Face, otherId: string): Road | null {
  const other = siteOf(world, otherId, face);
  if (!other) return null;
  if (!world.land(face.x, face.z) || !world.land(other.x, other.z)) return null;

  const border = onTheHalfwayLine(face.corners, { x: face.x, z: face.z, claim: 0, id: face.id }, other);
  if (border.length < 2) return null;
  // the two furthest apart, which are the ends of the border however many corners lie on it
  const [from, to] = furthest(border);

  let dry = 0;
  for (const t of FOOTING) {
    if (world.land(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) dry++;
  }
  if (dry < FOOTHOLD) return null;

  return {
    between: roadName(face.id, otherId),
    ends: [from, to],
    length: Math.hypot(to.x - from.x, to.z - from.z),
  };
}

/** Every road out of one face. */
export function roadsOf(world: Land, face: Face): Road[] {
  return face.neighbours
    .map((id) => roadBetween(world, face, id))
    .filter((road): road is Road => road !== null);
}

/**
 * The crossroads around one face, named by the three faces that meet at each.
 *
 * Not found by looking at corners. A corner has to be produced by clipping and then matched with a
 * margin, and a fourth site a hair away turns a triple into a quadruple and renames the junction —
 * which is a seam, and the first version of this had one. Instead: any two neighbours of this face
 * that also border each other make a triple, and a triple of faces meets at one point. Tolerance
 * free, and the same name and the same place computed from any of the three.
 *
 * That is the whole trick. A junction needs no register and no numbering, so two faces on opposite
 * sides of a province border agree about the junction between them without either knowing the
 * province exists.
 */
export function junctionsOf(world: Land, face: Face): Junction[] {
  // gathered at the distance the rule below is stated in, not at the mesher's — a list fetched
  // narrower than it is filtered is a list missing the very company it is being filtered for, and
  // that was version five: two faces forty-four tiles apart, sharing a junction, one of them never
  // having heard of the other because the square it looked in reached forty-two
  const near = sitesAround(world, face.x, face.z, world.dials.far * MIGHT_MEET);
  const byId = new Map(near.map((site) => [site.id, site]));
  const me = byId.get(face.id) ?? { x: face.x, z: face.z, claim: 0, id: face.id };

  /*
   * The sites near enough to share a junction with this one — by distance, never by count.
   *
   * "The nearest twelve" was the third version of this and it was wrong for a reason worth keeping:
   * it is not symmetric. A can be among B's nearest twelve while B is thirteenth for A, so A finds
   * the junction and B does not, and a town appears to one face and not to the other. A radius is
   * symmetric by construction: if the two are within it of each other, each is inside the other's
   * reach, whichever way round the question is asked.
   */
  const canReach = (world.dials.far * MIGHT_MEET) ** 2;
  const closest = near.filter((site) => site.id !== face.id
    && (site.x - me.x) ** 2 + (site.z - me.z) ** 2 <= canReach);

  const out: Junction[] = [];
  for (let i = 0; i < closest.length; i++) {
    for (let j = i + 1; j < closest.length; j++) {
      const a = closest[i], b = closest[j];
      const at = circumcentre(me, a, b);
      if (!at) continue;                               // three sites in a line meet nowhere

      /*
       * Three faces meet here if nobody else is nearer to the meeting point.
       *
       * Delaunay's own condition, and it has to be asked about the ground round *the meeting point*
       * rather than round the face doing the asking. That was the fourth version of this and the
       * distinction is the whole thing: all three faces work out the same meeting point, so a
       * neighbourhood centred there is the same neighbourhood for all three, and they cannot
       * disagree. Centred on the asker instead, each of the three looks at a different patch of
       * country, and a site that spoils the circle for one is out of sight for another — which is a
       * town that exists from the east and not from the west.
       */
      const reach = (at.x - me.x) ** 2 + (at.z - me.z) ** 2;
      // near enough that all three of them were bound to have looked at each other — see MIGHT_MEET
      if (reach > (world.dials.far * MIGHT_MEET / 2) ** 2) continue;
      const wide = Math.sqrt(reach) + world.dials.far;
      const contest = world.scatter.sitesIn({
        x0: at.x - wide, z0: at.z - wide, x1: at.x + wide, z1: at.z + wide,
      });
      const empty = contest.every((other) => {
        if (other.id === me.id || other.id === a.id || other.id === b.id) return true;
        return (at.x - other.x) ** 2 + (at.z - other.z) ** 2 >= reach * (1 - 1e-9);
      });
      if (!empty) continue;

      // how many of the three borders carry a road
      let roads = 0;
      for (const [one, two] of [[me.id, a.id], [me.id, b.id], [a.id, b.id]] as const) {
        const from = byId.get(one);
        if (from && roadBetween(world, faceOf(world, from), two)) roads++;
      }
      out.push({ id: [me.id, a.id, b.id].sort().join('|'), x: at.x, z: at.z, roads });
    }
  }
  return out;
}

/**
 * How far out a face looks for the company it might share a junction with, in claims.
 *
 * And the rule that goes with it, which took four attempts to get right: a junction is only accepted
 * if it lies within *half* of this of its faces. That is what makes it mutually visible. A junction
 * sits exactly its circumradius from all three of its faces, and the two furthest of those faces can
 * be twice that apart — so a face gathering company out to this distance is certain to have gathered
 * the other two of any junction it may be part of, and all three ask the same question about the
 * same three sites.
 *
 * Bounding the *pairwise distance from the asker* instead, which is the obvious thing to write, is
 * not symmetric: two faces can both be near the asker and far from each other, so the face in the
 * middle finds the junction and the two on the outside never consider the pair. That was version
 * four, and it looked exactly like a town that exists from one side and not the other.
 */
const MIGHT_MEET = 4;

/**
 * Where three sites meet: the point equally far from all three.
 *
 * The junction of three Voronoi cells, computed from the sites rather than from anybody's corners.
 * That is what makes it tolerance-free — a corner has to be found by clipping and compared with a
 * margin, and a fourth site a hair away turns a triple into a quadruple and renames the junction,
 * which is exactly the seam this was built to avoid. Three sites either meet at a point or lie in a
 * line, and both are decided by arithmetic rather than by a threshold.
 */
function circumcentre(a: Corner, b: Corner, c: Corner): Corner | null {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-12) return null;
  const sa = a.x * a.x + a.z * a.z, sb = b.x * b.x + b.z * b.z, sc = c.x * c.x + c.z * c.z;
  return {
    x: (sa * (b.z - c.z) + sb * (c.z - a.z) + sc * (a.z - b.z)) / d,
    z: (sa * (c.x - b.x) + sb * (a.x - c.x) + sc * (b.x - a.x)) / d,
  };
}

/**
 * The town at a junction, if there is one.
 *
 * Decided by the junction's own name and what meets there: a hash for whether anybody settled, the
 * number of roads for how big it grew, and dry ground for whether it could have happened at all.
 * Deliberately not by rank in a network — a rank needs a whole world to be ranked against, and this
 * world has no whole.
 */
export function townAt(world: Land, junction: Junction): Town | null {
  if (!world.land(junction.x, junction.z)) return null;
  if (junction.roads < 2) return null;                          // nobody settles a dead end

  const of = derive(world.seed, OF_A_TOWN);
  const settled = rand2(of, hashOfName(junction.id), junction.roads, OF_A_TOWN);
  // the more roads meet, the likelier a town: a crossing is a reason for a market
  if (settled > 0.18 + 0.09 * junction.roads) return null;

  const size = rand2(of, hashOfName(junction.id), junction.roads, OF_A_SIZE);
  return {
    id: junction.id,
    name: nameOf(world.seed, junction.id),
    x: junction.x,
    z: junction.z,
    level: junction.roads >= 4 && size > 0.5 ? 3 : junction.roads >= 3 ? 2 : 1,
  };
}

/**
 * A name for a place, from the place itself.
 *
 * Two halves out of two word lists, chosen by the junction's name — so a town is called what it is
 * called for ever, without anybody keeping a list of which names are taken. Two towns a long way
 * apart may share a name, which is what happens in every country there has ever been.
 */
const FIRST = [
  'Stone', 'Oak', 'Ash', 'Mill', 'Black', 'White', 'Long', 'Nether', 'Upper', 'Elder',
  'Bram', 'Hart', 'Wold', 'Fen', 'Crag', 'Marsh', 'Thorn', 'Wind', 'Ford', 'Kirk',
] as const;
const LAST = [
  'mere', 'cross', 'stead', 'vale', 'ford', 'bridge', 'field', 'ton', 'ham', 'wick',
  'bury', 'combe', 'thorpe', 'holt', 'by', 'gate', 'well', 'moor', 'dale', 'reach',
] as const;

export function nameOf(seed: number, id: string): string {
  const of = derive(seed, OF_A_NAME);
  const key = hashOfName(id);
  const first = FIRST[Math.floor(rand2(of, key, 1, OF_A_NAME) * FIRST.length)];
  const last = LAST[Math.floor(rand2(of, key, 2, OF_A_NAME) * LAST.length)];
  return `${first}${last}`;
}

/** A junction's name as a number, so it can be hashed. */
function hashOfName(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The two corners furthest apart, which are the ends of a border. */
function furthest(corners: Corner[]): [Corner, Corner] {
  let best: [Corner, Corner] = [corners[0], corners[1] ?? corners[0]], most = -1;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const away = Math.hypot(corners[i].x - corners[j].x, corners[i].z - corners[j].z);
      if (away > most) { most = away; best = [corners[i], corners[j]]; }
    }
  }
  return best;
}

/** The sites near a face, which is the neighbourhood everything here is decided in. */
function sitesAround(world: Country, x: number, z: number, reach = world.dials.far * 3): Site[] {
  return world.scatter.sitesIn({ x0: x - reach, z0: z - reach, x1: x + reach, z1: z + reach });
}

/** One site by name, looked for around a face that knows it. */
function siteOf(world: Country, id: string, near: Face): Site | null {
  return sitesAround(world, near.x, near.z).find((site) => site.id === id) ?? null;
}
