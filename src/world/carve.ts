import { rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';

/**
 * Turning a fan into rock: cutting it down, and carving a summit's arms out of it.
 *
 * `ranges.ts` decides where the mountains of a world are and how big each one is; this is what
 * happens to one of them between being a handful of enormous triangles and being something that
 * reads as rock. It is a separate file because it knows nothing whatever about maps — no mesh, no
 * faces, no country — and because the module that does had reached the seven hundred lines
 * `architecture.test.ts` allows.
 *
 * Two things happen here and they are deliberately in that order.
 *
 * **The cut.** Every triangle is divided into four and each new midpoint moved off the straight
 * line it sat on, again and again, which is the usual fractal landscape applied to a shape the map
 * chose rather than to a square of noise. The displacement is a hash of the two ends of the side
 * being cut, so the two triangles sharing that side move its midpoint to exactly the same place and
 * no seam can open — within one mountain, between two mountains, or between two patches of an
 * endless country that have never met.
 *
 * **The carve.** The cut is isotropic, and isotropic roughness on a cone is a lumpy cone. Measured
 * on the tallest peak of three seeds, the rock's height round a ring halfway up its own flank had no
 * angular scale in it at all: the strongest component at the size a spur runs at was worth seven per
 * cent of the flank's own height, against a wavenumber-one tilt worth three times that — which is
 * nothing but `LEAN` pushing the apex off-centre. That is #307's complaint in one number, *"a smooth
 * dome sitting on the ground, with no ridges, no spurs and no summit to speak of"*.
 *
 * A mountain is not lumpy. Water runs off a summit down a handful of arms with valleys between
 * them, and the arms are what the eye reads as a mountain rather than as a heap. So the flank is
 * carved rather than roughened further: the rock keeps its full height along a few bearings and
 * loses half of it between them.
 *
 * ## Why the carve takes height away rather than adding it
 *
 * The apex and the peak list are the world's answer to "how high is that mountain", and the camera,
 * the eyries and the sky islands all read it. Adding height along the arms would make every one of
 * those numbers wrong by however much the dial was worth. Taking height away between them cannot:
 * the summit is untouched, `peaks[].lift` still names the highest rock there is, and what changes is
 * only the ground the rock does *not* cover.
 *
 * ## Why the carve is afterwards rather than inside the cut
 *
 * It was tried inside the cut once and thrown away — *"it made almost no visible difference, at 0.3
 * and again at 0.5"* — and the reason is worth keeping. A displacement applied while a triangle is
 * being divided lands on a midpoint whose height is already an average of two roughened ends, so it
 * compounds down the recursion and has to be tapered to nothing at both ends of every edge to stay
 * stable. What survives that taper is a ripple, and the ripple sits underneath a random
 * displacement that the first cut alone is worth several units of.
 *
 * Carving the finished vertices has none of that. It is a pure function of where a vertex is and of
 * the summit it belongs to, so two triangles sharing a vertex are carved identically and the surface
 * still cannot tear; it is applied once, at full strength, at every scale of the mesh at once; and
 * because it is the last thing that happens, what it says is what the mountain is.
 */

export const CARVE = {
  /**
   * How far below the ground the border of a range is buried, in world units.
   *
   * Nought would put the rim exactly in the plane of the terraced ground it meets, and two
   * surfaces in one plane flicker against each other as the camera moves. Buried, the ground hides
   * the seam and the mountain grows out of it instead of resting on it.
   *
   * The rim is buried *everywhere* — item 4 of #307. It used to carry a share of the lower of the
   * two peaks wherever a corner was shared by mountain faces, on the argument that a col between
   * two summits belongs to the smaller of them. But `RANGE.SPREAD` pulls each fan in towards its
   * own apex, so two neighbours no longer meet at that corner: each stopped several units above the
   * ground with nothing beside it, which measured as up to 5.7 units of rock ending in mid-air.
   * A col is made of ground here — `highland.ts` raises the country between summits, and roads run
   * over it — so the rock has nothing to say about it and now says nothing.
   */
  BURY: 0.75,
  /**
   * How many times each triangle of a fan is cut into four, and how rough the cutting is.
   *
   * A fan alone is a tent: five or six enormous flat planes meeting at a point, which is a
   * polygon, not a mountain. Every cut adds a vertex at the middle of each edge and moves it up or
   * down by a share of that edge's own length, so the surface gains ridges at every scale down to
   * the last cut — the same trick a fractal landscape is made with, applied to a shape the map
   * chose rather than to a square of noise.
   *
   * Four cuts take a sixty-tile face down to triangles about four tiles across, which is the scale
   * the eye reads as rock. It also multiplies the triangle count by two hundred and fifty-six: a
   * world's mountains go from twenty triangles to about five thousand, which is still less than
   * two chunks of ground.
   *
   * The displacement is a hash of the two ends of the edge being cut, so both triangles sharing an
   * edge move its midpoint to exactly the same place and the surface cannot tear. It is also why
   * the mountains are the same every time the world is opened.
   */
  CUTS: 4,
  /** How far a midpoint moves, as a share of the length of the edge it sits on. */
  ROUGH: 0.34,
  /**
   * How much of that a low-lying midpoint gets.
   *
   * Full roughness everywhere puts crags on the valley floor and lifts the borders the roads run
   * along, which is exactly where the ground has to stay flat. Scaled by how high the edge already
   * is, the peaks are ragged and the passes stay passes.
   *
   * This is a floor on the *slope*, though, and not on the rim. A midpoint already at or under the
   * ground gets no displacement at all, however long its side: a twelfth of full roughness over a
   * fifty-tile border was worth more than a unit, and it was lifting the buried rim back out of the
   * ground it was buried in — which is half of what item 4 of #307 was looking at.
   */
  ROUGH_FLOOR: 0.12,
  /**
   * How many arms a summit has, at fewest and at most.
   *
   * Three is a tent and a dozen is a cog. Four to seven is what a hill has when you stand under one
   * and count the skylines, and at four cuts a sixty-tile face has triangles about four tiles
   * across — so seven arms is about eight triangles of flank apiece, enough for an arm to read as a
   * shape rather than as a facet.
   */
  ARMS_LEAST: 4,
  ARMS_MOST: 7,
  /**
   * How much height a valley loses, as a share of the rock that was there.
   *
   * The whole of it at 1, which would cut the fan to the ground between every pair of arms and
   * leave a starfish. Half takes the flank down far enough that the arms stand clear of it at every
   * height — measured, it moves the ring's dominant angular component from seven per cent of the
   * flank's own height to a quarter of it — and leaves the valleys as valleys rather than as gaps.
   */
  DEEP: 0.5,
  /**
   * How far from the apex the carving reaches full strength, as a share of the fan's own reach.
   *
   * Nought carves the summit itself, and a summit is a point: every bearing meets there, so carving
   * it turns the top of the mountain into a star of knife edges and the peak into whichever arm
   * happens to own the last triangle. A tenth of the way out is a summit block a few tiles across
   * for the arms to run down from, which is what a summit is.
   */
  NOSE: 0.1,
} as const;

/**
 * A point on the mountain being built: where it is, how high the ground under it is, and how far
 * above that the rock stands.
 *
 * The two heights are kept apart all the way down the subdivision because they behave differently.
 * The ground is what it is and is only ever averaged between neighbours; the lift is what gets
 * roughened, and how much it may be roughened depends on how high it already is — a crag belongs
 * near a summit, and the same crag on the valley floor is a boulder in the middle of a road.
 */
export interface Point {
  x: number;
  z: number;
  ground: number;
  lift: number;
}

/**
 * The rock being built up, as the three parallel lists it comes out as.
 *
 * `above` is how far each vertex stands over the ground under it, alongside the world height that
 * `tris` already carries. Both readings exist all the way through the build and only one of them
 * used to survive it, which is a loss with a name: a summit twenty-one units tall standing on
 * country twelve units up is at y = 33, and `render/mountains.ts` asked how far up the mountain
 * that was by dividing it by the tallest peak's *lift*. 33 over 21 is 1.57, which clamps, so every
 * triangle above a unit of rock was at the top of the ramp and #308's snow line sat at the foot of
 * the mountain. It is also what the carve below works on, since a valley is cut out of the rock and
 * not out of the world.
 */
export interface Rock {
  tris: number[];
  owner: number[];
  above: number[];
}

/**
 * Cut one triangle into four, and those into four again, until there is nothing left to cut.
 *
 * The midpoint of each side is displaced along the vertical by a hash of that side's two ends —
 * not by the recursion's own random source, which would give the two triangles sharing the side
 * different answers and open a seam down every edge. Because the hash is taken from the sum of the
 * coordinates it is the same whichever way round the side is handed in.
 */
export function cut(
  a: Point, b: Point, c: Point, depth: number, seed: number, tallest: number,
  into: Rock, id: number,
): void {
  if (depth <= 0) {
    into.tris.push(a.x, a.ground + a.lift, a.z, b.x, b.ground + b.lift, b.z, c.x, c.ground + c.lift, c.z);
    into.above.push(a.lift, b.lift, c.lift);
    into.owner.push(id);
    return;
  }
  const ab = between(a, b, seed, tallest);
  const bc = between(b, c, seed, tallest);
  const ca = between(c, a, seed, tallest);
  cut(a, ab, ca, depth - 1, seed, tallest, into, id);
  cut(ab, b, bc, depth - 1, seed, tallest, into, id);
  cut(ca, bc, c, depth - 1, seed, tallest, into, id);
  cut(ab, bc, ca, depth - 1, seed, tallest, into, id);
}

/** The midpoint of a side, moved off the straight line by an amount that side alone decides. */
export function between(a: Point, b: Point, seed: number, tallest: number): Point {
  const x = (a.x + b.x) / 2;
  const z = (a.z + b.z) / 2;
  const lift = (a.lift + b.lift) / 2;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  // high ground is rough, the valley floor is not: the borders carry the roads through
  const up = Math.max(0, Math.min(1, lift / tallest));
  // and rock already at or under the ground is not roughened at all, or the rim that was buried to
  // hide the seam is lifted back out of it — item 4 of #307, measured at up to 1.6 units of it
  const clear = Math.max(0, Math.min(1, (lift + CARVE.BURY) / CARVE.BURY));
  const share = clear * (CARVE.ROUGH_FLOOR + (1 - CARVE.ROUGH_FLOOR) * up);
  // the sum of the two ends, so the side hashes the same from either triangle that owns it
  const die = rand2(seed, Math.round((a.x + b.x) * 4), Math.round((a.z + b.z) * 4), SALT.MOUNTAINS);
  return {
    x, z,
    ground: (a.ground + b.ground) / 2,
    // never below the ground it stands on: a mountain that digs is a hole with a view
    lift: Math.max(-CARVE.BURY, lift + (die - 0.5) * 2 * CARVE.ROUGH * span * share),
  };
}
/** One summit's arms: where they radiate from, how many, which way round, and the block on top. */
export interface Spurs {
  x: number;
  z: number;
  arms: number;
  turn: number;
  /** Tiles from the apex at which the valleys are cut to their full depth. */
  nose: number;
}

/**
 * The arms of the summit standing at a point.
 *
 * Hashed from where the apex is rather than rolled from a stream, for the reason every other number
 * in this country is: an endless world builds the patch the hero is standing in and nothing else, so
 * a mountain that asked how many faces sorted before it would be a different mountain depending on
 * which way he walked in.
 */
export function spursOf(seed: number, x: number, z: number, reach: number): Spurs {
  const of = derive(seed, SALT.MOUNTAINS ^ 0x5fa7);
  const ix = Math.round(x * 4), iz = Math.round(z * 4);
  const choices = CARVE.ARMS_MOST - CARVE.ARMS_LEAST + 1;
  return {
    x, z,
    arms: CARVE.ARMS_LEAST + Math.floor(rand2(of, ix, iz, 1) * choices),
    turn: rand2(of, ix, iz, 2) * Math.PI * 2,
    nose: Math.max(1, reach * CARVE.NOSE),
  };
}

/**
 * How high the rock stands at a point once its summit's valleys are cut out of it.
 *
 * Height above the ground rather than above the sea, because that is what a valley is cut out of:
 * the ground under a flank is already rising, and a carve working on the absolute height would take
 * a share of the country away along with the rock.
 */
function carvedAt(spurs: Spurs, above: number, x: number, z: number): number {
  if (above <= 0) return above;                 // already buried: the rim, and nothing to carve
  const bearing = Math.atan2(z - spurs.z, x - spurs.x);
  // nought along an arm, one between two of them
  const valley = (1 - Math.cos(spurs.arms * bearing + spurs.turn)) / 2;
  const away = Math.hypot(x - spurs.x, z - spurs.z);
  return above * (1 - CARVE.DEEP * valley * Math.min(1, away / spurs.nose));
}

/**
 * Carve the valleys out of the rock one summit put down.
 *
 * `from` is how many vertices the rock had before that summit was cut, so this touches its own fan
 * and nothing that was already standing. Both heights move together: the world height and the
 * height above the ground are two readings of one surface, and the shading downstream reads the
 * second.
 */
export function carveSpurs(rock: Rock, from: number, spurs: Spurs): void {
  for (let v = from; v < rock.above.length; v++) {
    const was = rock.above[v];
    const at = v * 3;
    const now = carvedAt(spurs, was, rock.tris[at], rock.tris[at + 2]);
    rock.tris[at + 1] -= was - now;
    rock.above[v] = now;
  }
}
