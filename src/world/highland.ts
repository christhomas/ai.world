import { derive, SALT } from '../core/salts';
import { FaceKind, type WorldMesh } from './mesh';
import { Simplex2D } from './noise';

/**
 * How high the ground stands, before anything is built on it or stood on top of it.
 *
 * Two things, and they answer to two different maps. Mountain country is the mesh's: a face marked
 * mountain, and every face behind it standing higher. The uplands at the foot of this file are the
 * biome pie's: a country standing higher for being the kind of country it is, which today is the
 * snow lands and nothing else.
 *
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

/**
 * How far a valley side goes back for every terrace it climbs, in tiles. One number for two jobs,
 * and they have to agree: the slope the ground beside a river is held down to, and the slope the
 * high country may come back up at as it leaves the water. Disagree, and one of them leaves a step.
 */
export const VALLEY_SIDE = 1.4;

/**
 * The high country a river or a lake is allowed to have around it.
 *
 * Water is part of the country it lies in. The ground meets it at its own surface and climbs away
 * at the rate a valley side climbs, and the country here is whichever is smaller — what the swell
 * asked for, or what the valley allows. Both halves of that matter and both were learned the hard
 * way: without any cut at all, a road crossing high ground with a river in it stands on a causeway
 * with a ten-unit drop either side, because the ground beside the river is dragged down to meet it
 * and nothing tells the road; cut to nothing instead, and the ground drops while the lake does not,
 * which leaves it standing on a pedestal of its own bank.
 *
 * @param roadLevel the level the road web has here, which is what `country` is measured on top of.
 */
export function cutForWater(
  country: number, water: { level: number; wd: number } | null, roadLevel: number, bank: number,
): number {
  if (!water) return country;
  const allowed = (Math.max(1, water.level) - roadLevel) + Math.max(0, water.wd - bank) / VALLEY_SIDE;
  return Math.min(country, Math.max(0, allowed));
}

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

/**
 * The other way ground stands high: because of what kind of country it is.
 *
 * Everything above is mountain country, which the mesh decides face by face. This is the snow
 * lands, which the biome pie decides — and the pie is drawn in angular wedges with a line between
 * one and the next, so a country cannot simply be told to stand eighteen terraces higher than its
 * neighbour. It would stand eighteen terraces higher across one tile, which is a cliff nobody can
 * climb and nothing in the world explains.
 *
 * Measured rather than argued: `BIOME_BASE` is read straight at a crossroads today, and with snow
 * put up to eighteen the ground beside a road in the snow lands read 18, 17, 16 with the ground
 * beside the next road along reading 6, 5, 5 — a thirteen-terrace step in open country, walked
 * into with nothing to see.
 *
 * So the answer is taken on a lattice, each post averaged over its own nine, and eased between
 * them. What comes out is a slope some two hundred tiles wide wherever the map changes its mind,
 * which is a walk uphill rather than a wall, and — because the road web's own levels are what this
 * feeds — it is a slope everything else in the world already agrees about: the ground follows the
 * road it is nearest, a village square sits at the level of the crossroads it was founded on, and
 * a river runs down the same field.
 */

/**
 * How far apart the posts are, in tiles.
 *
 * This is the width of every climb between one country and the next, and it is set against what a
 * road may do: `assignLevels` holds each crossroads within a terrace of its parent and crossroads
 * stand about seven tiles apart, so a road can climb a terrace every seven tiles and no faster.
 * Averaging over nine posts and easing between them spreads a rise over about two and a half posts
 * — two hundred tiles for the eighty here, which is a terrace every eleven tiles at the steepest
 * point of the eighteen-terrace climb into the snow. Comfortably inside what the roads allow, and
 * that margin is the whole point.
 *
 * Halve it and the climb is a hundred tiles, which is steeper than the roads can follow: the clamp
 * wins, the ground lags behind the country it is supposed to be in, and the lag comes out as a step
 * where two branches that climbed at different times meet. Double it and the snow lands shrink,
 * because the climb eats the country it was meant to lift.
 */
const POST = 80;

/**
 * How high the country stands for being the kind of country it is, smoothed.
 *
 * An object rather than a function because it remembers. Every crossroads in a world asks it, and
 * the same few hundred posts answer all of them: a post costs nine questions of the map and is then
 * free for the life of the world.
 */
export class Uplands {
  private readonly posts = new Map<number, number>();

  /**
   * @param standsAt how high the country at a point stands, in terraces — the map's own opinion,
   *   asked at a post and nowhere else, so it is free to be as sharp-edged as it likes.
   */
  constructor(private readonly standsAt: (x: number, z: number) => number) {}

  /**
   * One post, averaged over itself and its eight neighbours.
   *
   * The averaging is what makes the climb long. Easing between bare posts gives a ramp one post
   * wide with a crease along the top and the bottom of it; averaging first spreads the same rise
   * over three posts and leaves no crease anywhere, because every post near a border is already
   * part of the way up.
   */
  private post(ix: number, iz: number): number {
    // one number per post, and no world is thirty thousand posts across
    const key = (ix + 0x8000) * 0x10000 + (iz + 0x8000);
    const known = this.posts.get(key);
    if (known !== undefined) return known;
    let sum = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) sum += this.standsAt((ix + dx) * POST, (iz + dz) * POST);
    }
    const mean = sum / 9;
    this.posts.set(key, mean);
    return mean;
  }

  /** How high the country stands here, in terraces. */
  at(x: number, z: number): number {
    const fx = x / POST, fz = z / POST;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    // eased rather than blended straight: a straight blend leaves a crease along every post line,
    // and a crease running dead straight for a mile is the one thing noise cannot hide
    const ex = tx * tx * (3 - 2 * tx), ez = tz * tz * (3 - 2 * tz);
    const near = this.post(ix, iz), nearOn = this.post(ix + 1, iz);
    const far = this.post(ix, iz + 1), farOn = this.post(ix + 1, iz + 1);
    const north = near + (nearOn - near) * ex;
    const south = far + (farOn - far) * ex;
    return north + (south - north) * ez;
  }
}

