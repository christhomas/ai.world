import { rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { HIGHLAND, type Highland } from './highland';
import { faceAt, faceOf, facesIn, siteOf, type Country, type Face } from './localmesh';
import { FaceKind, MESH, roughenInto } from './mesh';
import { Simplex2D } from './noise';
import type { Within } from './window';

/**
 * What each face of an endless country is made of, and how high the mountains stand on it.
 *
 * `mesh.ts` settles this for a world with an edge in one pass over every face there is, and three
 * of the four things it does there cannot be done here. It drowns the faces near the rim, so the
 * map ends in open sea. It lifts a few faces of open water into islands, chosen by how far out they
 * are. It forces the face at the origin to be dry, because that is where the player wakes up. All
 * three are answers about a world's *shape*, and a world without an edge has no shape to answer
 * about. They are simply gone: an endless country ends nowhere, its islands are wherever the noise
 * happens to leave one, and there is no middle to keep clear.
 *
 * The fourth is the lakes, and that one is only a matter of saying it differently. There, a face
 * is made a lake and its neighbours are then offered the chance to join — but the offering is a
 * loop over a list, and a face that has already become a lake changes what the faces after it see,
 * so the answer depends on the order the world was walked in. Here the rule is stated about the
 * ground rather than about a walk: a face holds water if it would start a lake, or if a neighbour
 * would start one and takes it in. Both halves are settled inside two faces of the one being asked
 * about, and neither can be changed by anything further away.
 *
 * The high country is the piece that looks hardest and is not. `highlandLift` floods inward from
 * the edge of every range in the world to find how deep each face is; here a face counts its own
 * steps out to the nearest open ground, and stops at three — because the ground stops rising after
 * three, and a number that has already saturated is the same number however much further the
 * flooding might have gone. So a bounded count gives exactly the answer the whole-world flood
 * gives, rather than an approximation of it.
 */

/** How deep into a range it is worth counting: past this the ground has stopped rising anyway. */
const DEEPEST = Math.ceil(HIGHLAND.MOST / HIGHLAND.PER_STEP);

/**
 * How far outside a patch the mountains are looked for, in the world's own spacing.
 *
 * A range raises the ground far beyond its own faces — that swell is what makes foothills — so a
 * patch that gathered only the mountains standing in it would have the ground fall away at its own
 * edge. A face's reach is at most about `HIGHLAND.REACH` times its width, and this is comfortably
 * more than the widest face a world's spacing allows.
 */
const SPILL = 1.5;

/** Salts, so the two questions asked about a lake cannot be the same number. */
const OF_A_LAKE = 0x1a4e;
const OF_ITS_SPREAD = 0x5b2d;

/** The field that decides land from sea, made once per world. */
const fields = new Map<number, Simplex2D>();
function fieldFor(seed: number): Simplex2D {
  let field = fields.get(seed);
  if (!field) { field = new Simplex2D(derive(seed, SALT.MESH)); fields.set(seed, field); }
  return field;
}

/**
 * What a face would be made of before any water gathers on it.
 *
 * A function of where the face stands and nothing else, which is what lets everything below stay
 * local: a neighbour's kind can be asked for without working out that neighbour's own
 * neighbourhood.
 */
function bedrock(seed: number, x: number, z: number): FaceKind {
  const height = fieldFor(seed).fbm(x * MESH.CONTINENT_SCALE, z * MESH.CONTINENT_SCALE, 4);
  if (height < MESH.SHORE) return FaceKind.Sea;
  return height > MESH.PEAKS ? FaceKind.Mountain : FaceKind.Land;
}

/** Land or mountain: ground you can put your foot on, as opposed to sea or lake. */
const dry = (kind: FaceKind): boolean => kind === FaceKind.Land || kind === FaceKind.Mountain;

/** A hash of a face's name, so a question asked of it is asked the same way from anywhere. */
function keyOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Is this open ground with dry ground all the way round it?
 *
 * The condition for holding water at all, whether a lake starts here or reaches in from next door,
 * so that a lake is inland water and never a bite taken out of a coast.
 */
function inland(world: Country, face: Face): boolean {
  if (bedrock(world.seed, face.x, face.z) !== FaceKind.Land) return false;
  for (const id of face.neighbours) {
    const site = siteOf(world, id, face);
    if (!site || !dry(bedrock(world.seed, site.x, site.z))) return false;
  }
  return true;
}

/** Would a lake start here? Only sometimes, because a country of lakes is a marsh. */
function starts(world: Country, face: Face): boolean {
  return inland(world, face)
    && rand2(derive(world.seed, OF_A_LAKE), keyOf(face.id), 0, OF_A_LAKE) < MESH.LAKE_SHARE;
}

/**
 * What one face is made of.
 *
 * Sea, mountain or open ground from the field under it; and then water on top of that, if this face
 * would start a lake or a neighbour that would start one reaches into it. A single face is a tarn
 * and several together are a loch, and a world wants both — so whether a lake takes in a neighbour
 * is rolled for that pair rather than fixed, which spreads the sizes.
 */
export function kindOf(world: Country, face: Face): FaceKind {
  const known = remembered(world);
  const before = known.get(face.id);
  if (before !== undefined) return before;
  const kind = worked(world, face);
  known.set(face.id, kind);
  return kind;
}

/**
 * What each face of a country has been worked out to be, remembered.
 *
 * Not tidiness. Whether a face holds a lake is settled by asking each of its neighbours whether it
 * would start one, and each of those asks its own neighbours in turn — so one uncached answer is
 * some forty searches of the ground. The question is asked for every tile of every chunk, and eight
 * more times per ring while a coastline is felt for. Without this the ground is unaffordable; with
 * it, the second question about a face is free.
 *
 * Kept beside the country rather than in it, and weakly, so that a country going out of use takes
 * its answers with it.
 */
const worldsKinds = new WeakMap<Country, Map<string, FaceKind>>();
function remembered(world: Country): Map<string, FaceKind> {
  let known = worldsKinds.get(world);
  if (!known) { known = new Map(); worldsKinds.set(world, known); }
  return known;
}

/** What one face is made of, worked out from the ground rather than recalled. */
function worked(world: Country, face: Face): FaceKind {
  const bed = bedrock(world.seed, face.x, face.z);
  if (bed !== FaceKind.Land) return bed;
  if (!inland(world, face)) return FaceKind.Land;      // a face on a coast holds no water
  if (starts(world, face)) return FaceKind.Lake;
  for (const id of face.neighbours) {
    const site = siteOf(world, id, face);
    if (!site || !starts(world, faceOf(world, site))) continue;
    // rolled from the pair, so both faces agree about whether the water crossed between them
    const pair = id < face.id ? `${id}|${face.id}` : `${face.id}|${id}`;
    if (rand2(derive(world.seed, OF_ITS_SPREAD), keyOf(pair), 0, OF_ITS_SPREAD) < MESH.LAKE_SPREAD) {
      return FaceKind.Lake;
    }
  }
  return FaceKind.Land;
}

/**
 * Whether a point is somewhere you could stand.
 *
 * The point is pushed about by the same noise the bounded world uses before it is asked which face
 * it is in, which is what turns a border between two faces — a straight line, since a face is cut
 * out by bisectors — into a coastline with bays and headlands in it.
 */
export function landOf(world: Country): (x: number, z: number) => boolean {
  const rough = { x: 0, z: 0 };
  return (x, z) => {
    roughenInto(world.seed, x, z, rough);
    const face = faceAt(world, rough.x, rough.z);
    return face !== null && dry(kindOf(world, face));
  };
}

/**
 * How deep into the mountains a face is: steps to the nearest ground that is not mountain.
 *
 * Counted outward from the face itself rather than inward from the edge of a range, which is the
 * same number and can be had without knowing where the range ends. Stops at `DEEPEST`, and that is
 * not an approximation: the ground has stopped rising by then, so every deeper face is the same
 * height as one at that depth.
 */
function depthOf(world: Country, face: Face): number {
  if (kindOf(world, face) !== FaceKind.Mountain) return 0;
  let ring = [face];
  const seen = new Set<string>([face.id]);
  for (let step = 1; step <= DEEPEST; step++) {
    const next: Face[] = [];
    for (const here of ring) {
      for (const id of here.neighbours) {
        if (seen.has(id)) continue;
        const site = siteOf(world, id, here);
        if (!site) return step;                       // nothing out there is not mountain country
        seen.add(id);
        const neighbour = faceOf(world, site);
        if (kindOf(world, neighbour) !== FaceKind.Mountain) return step;
        next.push(neighbour);
      }
    }
    ring = next;
  }
  return DEEPEST;
}

/** A face's area, which is what its reach is measured from. The shoelace, as everywhere else. */
function areaOf(face: Face): number {
  let twice = 0;
  for (let i = 0; i < face.corners.length; i++) {
    const a = face.corners[i], b = face.corners[(i + 1) % face.corners.length];
    twice += a.x * b.z - b.x * a.z;
  }
  return Math.abs(twice) / 2;
}

/**
 * The high country reaching into a patch: where the ground rises, and by how much.
 *
 * Gathered over more than the patch itself, because a range raises the ground for a long way
 * outside its own faces — that swell is what makes foothills, and a patch that only looked at the
 * mountains standing in it would have the ground fall away at its edge.
 */
export function highlandNear(world: Country, within: Within): Highland[] {
  const swell = world.dials.far * HIGHLAND.REACH * SPILL;
  const out: Highland[] = [];
  for (const face of facesIn(world, {
    x0: within.x0 - swell, z0: within.z0 - swell, x1: within.x1 + swell, z1: within.z1 + swell,
  })) {
    const depth = depthOf(world, face);
    if (depth <= 0) continue;
    out.push({
      x: face.x,
      z: face.z,
      reach: Math.sqrt(areaOf(face) / Math.PI) * HIGHLAND.REACH,
      lift: Math.min(HIGHLAND.MOST, depth * HIGHLAND.PER_STEP),
    });
  }
  return out.filter((hill) => hill.x + hill.reach >= within.x0 && hill.x - hill.reach <= within.x1
    && hill.z + hill.reach >= within.z0 && hill.z - hill.reach <= within.z1);
}
