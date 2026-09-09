import { rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { areaOf, kindOf } from './localland';
import { facesIn, type Country, type Face } from './localmesh';
import { hashOfName, junctionsIn } from './localroads';
import type { Land } from './localroads';
import { FaceKind } from './mesh';
import { RANGE, cut, indexTriangles, type Peak, type Point, type Ranges } from './ranges';
import type { Within } from './window';

/**
 * The rock of an endless country: the mountains that stand on its high ground.
 *
 * The ground already rises — that is `localland`, and it is what makes a range a range rather than a
 * cone dropped on a plain. This is the last few hundred feet, the part that is geometry rather than
 * heightfield, and it was the one thing the endless country did not have.
 *
 * `buildRanges` does it for a bounded world and cannot do it here for three reasons, all of the same
 * kind. It rolls a die for every face in the world in id order, so a mountain's height depends on
 * how many faces sort before it. It measures each face against the widest mountain face in the
 * world, so adding country somewhere else makes this mountain shorter. And it holds a corner down
 * unless every face meeting there is a mountain, which it answers from an array of the world's
 * corners.
 *
 * Each has a local answer. A face's height comes from its own name. It is measured against the size
 * a face of this country's spacing has, which is a constant rather than a survey. And a corner is a
 * crossroads, so what meets there is a question `junctionsIn` already answers inside a bounded
 * neighbourhood.
 *
 * What is not replaced is the subdivision, because it never needed replacing: a midpoint is
 * displaced by a hash of the two ends of the side it sits on, so two triangles sharing a side agree
 * about it without either knowing the other exists. That was written to close a seam inside one
 * mountain, and it closes the seam between two patches for nothing.
 */

/** Salts, so the questions asked of a mountain cannot be the same number. */
const OF_ITS_HEIGHT = 0x3a17;
const OF_ITS_PEAKS = 0x6b2e;

/**
 * How far outside a patch the mountains are gathered, in the world's own spacing.
 *
 * A mountain stands on its face and spreads to `RANGE.SPREAD` of the face's corners, so its rock
 * never reaches further than the face itself — but a face whose middle is outside the patch may
 * still have most of its rock inside it. Two spacings is more than any face is wide.
 */
const SPILL = 2;

/**
 * How high one mountain face stands, in world units.
 *
 * The bounded world rolls this from a stream and scales it by the widest mountain face there is;
 * here it comes from the face's own name, scaled against the size a face of this country's spacing
 * has. So a big territory still carries a taller mountain than a small one, and neither depends on
 * what the rest of the world happens to contain.
 */
function liftOf(world: Country, face: Face): number {
  const usual = Math.PI * (world.dials.far / 2) ** 2;
  const room = Math.min(1, Math.sqrt(areaOf(face) / usual));
  const die = rand2(derive(world.seed, OF_ITS_HEIGHT), hashOfName(face.id), 0, OF_ITS_HEIGHT);
  const share = room * RANGE.BY_AREA + die * (1 - RANGE.BY_AREA);
  return RANGE.SHORTEST + share * (RANGE.TALLEST - RANGE.SHORTEST);
}

/**
 * How high a corner of the country stands.
 *
 * Held at ground level unless every face meeting there is a mountain: one foot in open country and
 * the range has to come down to meet it, which is what makes a range end rather than break off.
 * Deep inside a range it stands at a share of the lowest peak around it, so the col between two
 * mountains belongs to the smaller of the two.
 */
function cornerLift(world: Land, around: string[]): number {
  let lowest = Infinity;
  for (const id of around) {
    const face = world.faces.get(id);
    if (!face || kindOf(world, face) !== FaceKind.Mountain) return 0;
    lowest = Math.min(lowest, liftOf(world, face));
  }
  return lowest === Infinity ? 0 : lowest * RANGE.COL;
}

/**
 * The rock standing in a patch.
 *
 * `ground` is how high the finished ground is at a point — the mountains stand on it rather than
 * being part of it, so it has to be settled before this runs, exactly as in a bounded world.
 */
export function rockIn(world: Land, within: Within, ground: (x: number, z: number) => number): Ranges {
  const spill = world.dials.far * SPILL;
  const wider = {
    x0: within.x0 - spill, z0: within.z0 - spill, x1: within.x1 + spill, z1: within.z1 + spill,
  };

  // every crossroads the patch can see, so a face can ask how high its own corners stand
  const corners = new Map<string, number>();
  for (const junction of junctionsIn(world, wider)) {
    corners.set(cornerName(junction.x, junction.z), cornerLift(world, junction.id.split('|')));
  }

  const peaks: Peak[] = [];
  const tris: number[] = [];
  const owner: number[] = [];
  for (const face of facesIn(world, wider)) {
    if (kindOf(world, face) !== FaceKind.Mountain) continue;
    const area = areaOf(face);
    const reach = Math.sqrt(area / Math.PI);
    const lift = liftOf(world, face);
    const key = hashOfName(face.id);
    // How many summits this face carries. A big territory is a range and wants several; a small one
    // is a mountain and wants the one.
    const many = Math.max(1, Math.min(RANGE.MOST_PEAKS, Math.round(area / RANGE.PER_PEAK)));
    const turn = rand2(derive(world.seed, OF_ITS_PEAKS), key, 0, OF_ITS_PEAKS) * Math.PI * 2;

    for (let p = 0; p < many; p++) {
      const roll = (n: number): number => rand2(derive(world.seed, OF_ITS_PEAKS), key, p * 4 + n, OF_ITS_PEAKS);
      const lean = many === 1 ? turn : turn + (p / many) * Math.PI * 2;
      const away = (many === 1 ? roll(1) * RANGE.LEAN : RANGE.LEAN + roll(1) * RANGE.LEAN * 0.5) * reach;
      const ax = face.x + Math.cos(lean) * away;
      const az = face.z + Math.sin(lean) * away;
      // the summits of one range differ: a chain of identical peaks is a fence
      const height = lift * (p === 0 ? 1 : RANGE.LESSER + roll(2) * (1 - RANGE.LESSER));
      const id = peaks.length;
      const under = ground(ax, az);
      // a face is its own range here: there are no regions in a country nobody has walked over
      peaks.push({ face: id, range: id, x: ax, z: az, lift: height, y: under + height });
      const apex: Point = { x: ax, z: az, ground: under, lift: height };

      // the rim: the face's own shape, pulled in towards this apex so the flanks are steep
      const spread = RANGE.SPREAD / Math.sqrt(many);
      const rim = face.corners.map((c) => {
        const rx = ax + (c.x - ax) * spread;
        const rz = az + (c.z - az) * spread;
        const held = corners.get(cornerName(c.x, c.z)) ?? 0;
        return { x: rx, z: rz, ground: ground(rx, rz), lift: held * spread - RANGE.BURY };
      });
      for (let k = 0; k < rim.length; k++) {
        cut(apex, rim[k], rim[(k + 1) % rim.length], RANGE.CUTS, world.seed, RANGE.TALLEST, tris, owner, id);
      }
    }
  }

  const flat = new Float32Array(tris);
  return {
    tris: flat, owner: new Int32Array(owner), peaks, bowl: null,
    index: indexTriangles(flat, Math.hypot(wider.x1 - wider.x0, wider.z1 - wider.z0) / 2),
  };
}

/**
 * A corner's name: where it is, rounded fine.
 *
 * A face names its corners by position and a junction names itself by the faces that meet there, so
 * the two are joined by the one thing they agree about. Rounded because both arrive at the same
 * point by different arithmetic — a circumcentre and a clipped polygon corner — and the last bit of
 * a double is not something two routes to the same place can be asked to share.
 */
function cornerName(x: number, z: number): string {
  return `${Math.round(x * 64)},${Math.round(z * 64)}`;
}
