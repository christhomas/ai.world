import { derive, SALT } from '../core/salts';
import { FaceKind, type WorldMesh } from './mesh';
import { Simplex2D } from './noise';

/**
 * Mountain country: the ground itself rising, before any rock stands on it.
 *
 * The first version of the mountains was wrong in a way no amount of tuning would fix. It put peaks
 * on the ground the way a tree is put on the ground — a flat plain, and then a cone of rock rising
 * out of nowhere. That is not what a mountain is. A range is high *country*: the land tilts up for
 * miles before anything worth calling a peak, the valleys between the summits are themselves higher
 * than the plain, and you know you are in the mountains long before you are on one.
 *
 * So the land rises first, and here is where. A face the mesh marked as mountain is high ground; a
 * face bordering open country is the edge of it, and the further in a face is from that edge the
 * higher it stands. Peaks are built on top of what this returns, so a summit is high because it is
 * a rise on high ground rather than because a tall thing was dropped on a field.
 *
 * The rise is in the terraced heightfield rather than in the polygon rock, which matters for
 * everything else: it is walkable, rivers run down it, villages sit in its valleys, snow falls on
 * it, and the map draws it. The rock on top is only the last few hundred feet.
 */

export const HIGHLAND = {
  /**
   * How high the country stands for each step a face is from open ground, in terraces.
   *
   * A terrace is half a world unit, so the edge of a range stands about seven units above the
   * plain and the country behind it fourteen. That is the climb: by the time you are among the
   * peaks you have already walked up something.
   */
  PER_STEP: 21,
  /** However deep the country, the ground itself never rises past this, in terraces. */
  MOST: 56,
  /**
   * How far the ground round a mountain face is raised, as a share of the face's own reach.
   *
   * This is what makes foothills. A face is sixty to a hundred and fifty tiles across; at two and a
   * half times that, the ground begins tilting up a long way out in open country and goes on
   * rising all the way in. Narrower and a range is a plateau with a cliff round it, which is the
   * mistake this replaced — mountains standing up out of a flat plain like nothing else in nature.
   */
  REACH: 2.5,
  /**
   * How much of that reach is spent climbing, as against being high country already.
   *
   * At one the whole swell is a slope and there is no plateau at the top. At nought it is a mesa.
   * Two thirds gives a long approach and a broad shoulder of high ground for the peaks to stand on.
   */
  SHOULDER: 0.66,
  /**
   * How much of the height is carved by ridges, as against being the plain swell underneath.
   *
   * This is what stops a range being a dome. High ground does not rise evenly to a middle: it goes
   * up in spurs with valleys between them, and a walk into the hills climbs, levels, drops into a
   * hollow and climbs again. At nought that is gone and a range is a hemisphere; at one the swell
   * disappears and the ridges have nothing to stand on. Two thirds ridge, one third swell.
   */
  RIDGED: 0.66,
  /**
   * How large the ridges are, in tiles, and how many scales of them there are.
   *
   * The first octave is the length of a spur — a few hundred tiles, so a range has two or three
   * arms rather than a texture. Each one after it is half the size and worth less, which is what
   * gives a hillside its shoulders and hollows without turning it into gravel.
   */
  RIDGE_SCALE: 320,
  RIDGE_OCTAVES: 4,
} as const;

/** One face's worth of high country: where it is, how far its ground rises, and how high. */
export interface Highland {
  x: number;
  z: number;
  /** Tiles from the middle at which the ground is back down to the plain. */
  reach: number;
  /** Terraces the ground stands at the middle of it. */
  lift: number;
}

/**
 * The high country of a world: where the ground rises, and by how much.
 *
 * Worked out by walking inward from the edge of every range — faces touching open country are the
 * foothills, faces behind them stand higher — and then spread over a reach far wider than the faces
 * themselves, because a range is not the shape of the polygons that decided where it goes. What
 * comes out is a broad swell of country with the polygons' own peaks standing on top of it.
 */
export function highlandLift(mesh: WorldMesh): Highland[] {
  const depth = new Int32Array(mesh.faces.length).fill(-1);

  // the edge of the mountains: any mountain face with something that is not mountain beside it
  const edge: number[] = [];
  for (const face of mesh.faces) {
    if (face.kind !== FaceKind.Mountain) continue;
    const open = face.neighbours.some((n) => n < 0 || mesh.faces[n].kind !== FaceKind.Mountain);
    if (!open) continue;
    depth[face.id] = 1;
    edge.push(face.id);
  }
  // and inward from there, a step at a time
  for (let at = 0; at < edge.length; at++) {
    const here = mesh.faces[edge[at]];
    for (const next of here.neighbours) {
      if (next < 0 || mesh.faces[next].kind !== FaceKind.Mountain || depth[next] >= 0) continue;
      depth[next] = depth[here.id] + 1;
      edge.push(next);
    }
  }

  const country: Highland[] = [];
  for (const face of mesh.faces) {
    if (depth[face.id] < 0) continue;
    country.push({
      x: face.cx,
      z: face.cz,
      reach: Math.sqrt(face.area / Math.PI) * HIGHLAND.REACH,
      lift: Math.min(HIGHLAND.MOST, depth[face.id] * HIGHLAND.PER_STEP),
    });
  }
  return country;
}

/**
 * The ridges a world's high country is carved into.
 *
 * Made from the seed, so a range has the same spurs every time it is looked at, and separate from
 * the swells because the swells say *where* the country is high and this says *what shape* it is.
 */
export function highlandRidges(seed: number): Simplex2D {
  return new Simplex2D(derive(seed, SALT.MESH ^ 0x5d9e));
}

/**
 * How high the ground stands at a point because of the country it is in, in terraces.
 *
 * Two things multiplied. The swell says how much height this country is allowed — the highest of
 * what any range nearby makes of it, rather than the sum, because two shoulders overlapping make a
 * saddle at the height of the higher one. The ridges say how much of that allowance the ground
 * actually takes here, and that is what makes it hills rather than a dome: a walk into them climbs
 * a spur, levels off, drops into a hollow and climbs again, and the trend is upward the whole way
 * without a single stretch of it being a slope to a middle.
 */
export function highlandAt(
  country: ReadonlyArray<Highland>, ridges: Simplex2D, x: number, z: number,
): number {
  let most = 0;
  for (const hill of country) {
    const away = Math.hypot(hill.x - x, hill.z - z);
    if (away >= hill.reach) continue;
    // flat-ish over the middle, falling away over the outer part of the reach
    const inward = (hill.reach - away) / (hill.reach * HIGHLAND.SHOULDER);
    const share = Math.max(0, Math.min(1, inward));
    const eased = share * share * (3 - 2 * share);
    most = Math.max(most, hill.lift * eased);
  }
  if (most <= 0) return 0;
  // the noise already knows how to fold itself into crests; this only says at what size
  const ridge = ridges.ridged(x / HIGHLAND.RIDGE_SCALE, z / HIGHLAND.RIDGE_SCALE, HIGHLAND.RIDGE_OCTAVES);
  return most * (1 - HIGHLAND.RIDGED + HIGHLAND.RIDGED * ridge);
}

