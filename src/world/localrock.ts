import { rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { CARVE, carveSpurs, cut, spursOf, type Point, type Rock } from './carve';
import { areaOf, kindOf } from './localland';
import { facesIn, type Country, type Face } from './localmesh';
import { hashOfName } from './localroads';
import type { Land } from './localroads';
import { FaceKind } from './mesh';
import { RANGE, indexTriangles, type Peak, type Ranges } from './ranges';
import type { Within } from './window';

/**
 * The rock of an endless country: the mountains that stand on its high ground.
 *
 * The ground already rises — that is `localland`, and it is what makes a range a range rather than a
 * cone dropped on a plain. This is the last few hundred feet, the part that is geometry rather than
 * heightfield, and it was the one thing the endless country did not have.
 *
 * `buildRanges` does it for a bounded world and cannot do it here for two reasons, both of the same
 * kind. It rolls a die for every face in the world in id order, so a mountain's height depends on
 * how many faces sort before it; and it measures each face against the widest mountain face in the
 * world, so adding country somewhere else makes this mountain shorter.
 *
 * Both have a local answer: a face's height comes from its own name, measured against the size a
 * face of this country's spacing has, which is a constant rather than a survey. There was a third —
 * a corner held down unless every face meeting there was a mountain, answered out of an array of
 * the whole world's corners — and it stopped being a question when #307 buried every rim. The rim
 * comes down to the ground wherever it stops now, like any other border.
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

  const peaks: Peak[] = [];
  const rock: Rock = { tris: [], owner: [], above: [] };
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

      // the rim: the face's own shape, pulled in towards this apex so the flanks are steep, and
      // buried wherever it stops so the rock is underground before it runs out
      const spread = RANGE.SPREAD / Math.sqrt(many);
      const rim = face.corners.map((c) => {
        const rx = ax + (c.x - ax) * spread;
        const rz = az + (c.z - az) * spread;
        return { x: rx, z: rz, ground: ground(rx, rz), lift: -CARVE.BURY };
      });
      const before = rock.above.length;
      for (let k = 0; k < rim.length; k++) {
        cut(apex, rim[k], rim[(k + 1) % rim.length], CARVE.CUTS, world.seed, RANGE.TALLEST, rock, id);
      }
      carveSpurs(rock, before, spursOf(world.seed, ax, az, reach * spread));
    }
  }

  const flat = new Float32Array(rock.tris);
  return {
    tris: flat, owner: new Int32Array(rock.owner), above: new Float32Array(rock.above), peaks, bowl: null,
    index: indexTriangles(flat, Math.hypot(wider.x1 - wider.x0, wider.z1 - wider.z0) / 2),
  };
}
