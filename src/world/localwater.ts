import { rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { highlandAt, highlandRidges, type Highland } from './highland';
import { groundAt } from './localgraph';
import { highlandNear } from './localland';
import type { Country } from './localmesh';
import { hashOfName, junctionsIn, type Land } from './localroads';
import { Simplex2D } from './noise';
import type { Hydrology, Lake, RiverNode } from './rivers';
import type { Within } from './window';

/**
 * The rivers and lakes of an endless country.
 *
 * This is the piece of the world that most obviously cannot be done the way it is done now, and it
 * is worth being exact about why. A river today is chosen from a list of the world's crossroads
 * sorted by height, walked outward along the road corridor, and stopped when it comes within six
 * tiles of any water built *before it* — so a river's course depends on how many rivers the world
 * happened to build first, which is a traversal wearing a disguise. Move the starting point of that
 * loop and the rivers move.
 *
 * Three rules replace it, and each is settled inside a bounded neighbourhood:
 *
 * - **A spring is a property of a place.** A crossroads high enough to hold water rises a river if
 *   its own name says so, and if no better spring stands within a spring's distance of it. That is
 *   the mutual-choice rule the ferries use, asked of one thing instead of a pair.
 * - **A river runs downhill and nothing else.** Not along a road: down the slope of the ground
 *   itself, which is a field and therefore has a gradient at every point. So "a river never runs
 *   uphill" stops being something the code has to enforce with a running minimum and becomes true
 *   by construction — and where the ground stops going down, the water stops, which is what a lake
 *   is.
 * - **Where two rivers meet, the lesser one ends.** Ranked by the springs' names rather than by
 *   which was built first, so both ends of the question agree without either knowing what else the
 *   world contains.
 *
 * What it costs is a wider gather: a river three hundred tiles long can reach into a patch from
 * three hundred tiles outside it, so every spring within that reach has to be traced before a patch
 * knows its own water. That is the price of the rule, it is bounded, and it is why a local river is
 * shorter than a world-sized one.
 */

/** How the water of a patch is found. Tiles, except where it says otherwise. */
const WATER = {
  /**
   * How far a river runs before it is a river somebody else has to deal with, in steps and tiles
   * a step.
   *
   * Shorter than the bounded world's, and deliberately: the reach of a river is exactly how far
   * outside a patch that patch has to look, so a river of six hundred tiles means gathering
   * springs over a square twelve hundred tiles across before a chunk can be drawn. Sixty steps is
   * three hundred tiles, which is a long walk and half the gathering.
   */
  MAX_STEPS: 60,
  STEP: 5,
  /** Shorter attempts are a stream, and a stream is not worth drawing. */
  MIN_NODES: 6,
  /** How close two springs may stand. The one with the better name keeps the water. */
  SPACING: 45,
  /** How high the ground has to stand, in terraces, before water comes out of it at all. */
  HIGH_ENOUGH: 1.6,
  /** And how much a range standing beside a crossroads counts towards it, per terrace of swell. */
  FOOT_OF_THE_HILLS: 0.5,
  /** Share of the crossroads high enough to hold water that actually do. */
  SPRINGS: 0.28,
  /** How wide a river is at its source and near its mouth, as a half-width. */
  MIN_WIDTH: 1.1,
  MAX_WIDTH: 2.6,
  /** How much a river widens per step of its course. */
  WIDENING: 0.05,
  /** How close a river comes to other water before it gives up and pools. */
  MERGE: 6,
  /** How far the ground is felt to find which way is downhill, and how far the wander goes. */
  FEEL: 4,
  MEANDER: 0.45,
  MEANDER_SCALE: 0.04,
  /** A river that cannot find any way down has arrived at a lake this big, plus a little. */
  POOL: 3,
  POOL_MORE: 2.5,
  /** Share of crossroads with no river near them that hold a lake of their own, and how big. */
  TARNS: 0.06,
  TARN: 2.5,
  TARN_MORE: 3,
} as const;

/** Salts, so the three questions asked of a spring cannot be the same number. */
const OF_A_SPRING = 0x5b9e;
const OF_ITS_RANK = 0x2d17;
const OF_A_TARN = 0x7c4a;

/** Where a river rises: a crossroads, its own name, and how it ranks against its neighbours. */
export interface Spring {
  id: string;
  x: number;
  z: number;
  /** Nought to one, from the name. What decides which of two springs too close together survives. */
  rank: number;
}

/**
 * The ground a river runs down: the country's own slope, with the mountains standing on it.
 *
 * Held rather than asked for per step, because a river takes hundreds of steps and the high country
 * around it does not change while it does.
 */
interface Slope {
  seed: number;
  hills: Highland[];
  ridges: Simplex2D;
}

/** How high the ground is at a point, for the purpose of running water down it. */
function heightOn(slope: Slope, x: number, z: number): number {
  return groundAt(slope.seed, x, z) + highlandAt(slope.hills, slope.ridges, x, z);
}

/**
 * The springs of a patch.
 *
 * A crossroads holds a spring if the ground there is high, its name says so, and nothing better
 * stands within a spring's distance. The last clause is what keeps them apart without a list of
 * where the others went: two springs that are too close both ask the same question of the same
 * pair, and the same one wins whichever of them is asked.
 */
export function springsNear(world: Land, within: Within): Spring[] {
  // Wider than the patch by exactly one spring's distance: a spring at the edge is beaten by
  // neighbours outside it, and a patch that could not see those would keep a spring its neighbour
  // knows was taken. The answer has to be the same from either side, so both sides look.
  const asked = {
    x0: within.x0 - WATER.SPACING, z0: within.z0 - WATER.SPACING,
    x1: within.x1 + WATER.SPACING, z1: within.z1 + WATER.SPACING,
  };
  const slope = slopeOf(world, asked);
  const offered: Spring[] = [];
  for (const junction of junctionsIn(world, asked)) {
    if (!world.land(junction.x, junction.z)) continue;
    if (heightOn(slope, junction.x, junction.z) < WATER.HIGH_ENOUGH) continue;
    const key = hashOfName(junction.id);
    if (rand2(derive(world.seed, OF_A_SPRING), key, 0, OF_A_SPRING) >= WATER.SPRINGS) continue;
    offered.push({
      id: junction.id, x: junction.x, z: junction.z,
      rank: rand2(derive(world.seed, OF_ITS_RANK), key, 0, OF_ITS_RANK),
    });
  }
  return offered
    .filter((spring) => !offered.some((other) => beats(other, spring)))
    .filter((spring) => spring.x >= within.x0 && spring.x <= within.x1
      && spring.z >= within.z0 && spring.z <= within.z1);
}

/** Does one spring take the water another wanted? Only if it is too close, and better. */
function beats(other: Spring, spring: Spring): boolean {
  if (other.id === spring.id) return false;
  if (Math.hypot(other.x - spring.x, other.z - spring.z) >= WATER.SPACING) return false;
  // rank first, name to settle a tie, so the answer cannot depend on which was asked about
  return other.rank > spring.rank || (other.rank === spring.rank && other.id < spring.id);
}

/**
 * One river, from its spring to wherever the ground stops going down.
 *
 * Steepest descent, felt for rather than differentiated: the ground is sampled a few tiles out in
 * eight directions and the lowest wins, which is cheap and does not care that the field is made of
 * noise. A wander is added on top so a river is not a straight line down a hillside, but never
 * enough to turn it uphill — the heading is chosen from the ground, and the meander only leans it.
 *
 * It ends at the sea, or where nothing around it is lower, or when it has run as far as a local
 * river is allowed to. The last two both mean a lake.
 */
export function riverFrom(world: Land, spring: Spring, slope: Slope): RiverNode[] {
  const wander = new Simplex2D(derive(world.seed, SALT.RIVER_MEANDER));
  let x = spring.x, z = spring.z;
  let width: number = WATER.MIN_WIDTH;
  const nodes: RiverNode[] = [{ x, z, level: levelOn(slope, x, z), width }];

  for (let step = 0; step < WATER.MAX_STEPS; step++) {
    const here = heightOn(slope, x, z);
    let bestX = 0, bestZ = 0, lowest = here;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      const there = heightOn(slope, x + dx * WATER.FEEL, z + dz * WATER.FEEL);
      if (there < lowest) { lowest = there; bestX = dx; bestZ = dz; }
    }
    if (lowest >= here) break;                       // nowhere lower to go: this is a lake

    /*
     * The step, leaned by a wander so a river is not a straight line down a hillside.
     *
     * The lean is offered rather than taken. Which way is downhill is felt for a few tiles out,
     * and the step is longer than that, so a leaned step can land on ground higher than the ground
     * it was aimed at — and a river that climbs one step in twenty is not a river. So the leaned
     * step is tried, the straight one is the fallback, and if neither is lower the water has
     * arrived somewhere it cannot leave, which is a lake.
     */
    const lean = wander.noise(x * WATER.MEANDER_SCALE, z * WATER.MEANDER_SCALE) * WATER.MEANDER;
    const cos = Math.cos(lean), sin = Math.sin(lean);
    const leaned = { x: x + (bestX * cos - bestZ * sin) * WATER.STEP, z: z + (bestX * sin + bestZ * cos) * WATER.STEP };
    const straight = { x: x + bestX * WATER.STEP, z: z + bestZ * WATER.STEP };
    const next = downhillOf(slope, world, here, leaned, straight);
    if (!next) break;
    x = next.x;
    z = next.z;

    if (!world.land(x, z)) {
      // the mouth: one node past the coast at sea level, so the estuary meets the sea plane
      nodes.push({ x, z, level: 1, width: Math.min(WATER.MAX_WIDTH, width + 0.4) });
      break;
    }
    width = Math.min(WATER.MAX_WIDTH, width + WATER.WIDENING);
    nodes.push({ x, z, level: levelOn(slope, x, z), width });
  }
  return nodes;
}

/**
 * Whichever of two steps actually goes down, or nothing if neither does.
 *
 * Open water counts as down whatever the field says about it: the field is the shape of the land
 * and says nothing about where the coast is, so a river reaching the sea would otherwise be told it
 * had run out of hill and pool on the beach.
 */
function downhillOf(
  slope: Slope, world: Land, here: number,
  leaned: { x: number; z: number }, straight: { x: number; z: number },
): { x: number; z: number } | null {
  for (const step of [leaned, straight]) {
    if (!world.land(step.x, step.z)) return step;
    if (heightOn(slope, step.x, step.z) < here) return step;
  }
  return null;
}

/** The terrace a river's surface sits on here. Rounded, because a waterfall is a terrace edge. */
function levelOn(slope: Slope, x: number, z: number): number {
  return Math.max(1, Math.round(heightOn(slope, x, z)));
}

/**
 * The water of one patch: every river that reaches into it, and every lake.
 *
 * The gather is the whole shape of this. A river is traced from every spring within a river's reach
 * of the patch, whether or not that spring is in it, because a river three hundred tiles long is
 * water in this patch and its own patch has no way of knowing that matters here. Then the rivers
 * are cut against each other — the lesser of two that meet ends where they meet — and what is left
 * is the patch's water.
 */
export function waterIn(world: Land, within: Within): Hydrology {
  const reach = WATER.MAX_STEPS * WATER.STEP;
  const wide = {
    x0: within.x0 - reach, z0: within.z0 - reach, x1: within.x1 + reach, z1: within.z1 + reach,
  };
  const slope = slopeOf(world, wide);
  const springs = springsNear(world, wide).sort(byRank);

  const rivers: RiverNode[][] = [];
  const lakes: Lake[] = [];
  for (const spring of springs) {
    const course = cutAgainst(riverFrom(world, spring, slope), rivers);
    if (course.length < WATER.MIN_NODES) continue;
    rivers.push(course);
    // a river that did not reach the sea ends in the water it could not get out of
    const last = course[course.length - 1];
    if (last.level > 1) {
      const size = rand2(derive(world.seed, OF_A_SPRING), hashOfName(spring.id), 1, OF_A_SPRING);
      lakes.push({ x: last.x, z: last.z, r: WATER.POOL + size * WATER.POOL_MORE, level: last.level });
    }
  }

  for (const tarn of tarnsNear(world, wide, rivers, lakes)) lakes.push(tarn);
  return { rivers, lakes };
}

/**
 * Springs in the order their rivers are cut against each other.
 *
 * Best first, so that a river is only ever stopped by a better one — which makes the loop's order
 * a consequence of the springs' own names rather than of anything about how the world was walked.
 */
function byRank(a: Spring, b: Spring): number {
  return b.rank - a.rank || (a.id < b.id ? -1 : 1);
}

/** Where a river runs into better water, it ends. */
function cutAgainst(course: RiverNode[], rivers: RiverNode[][]): RiverNode[] {
  const near = WATER.MERGE * WATER.MERGE;
  for (let i = 1; i < course.length; i++) {
    for (const other of rivers) {
      for (const node of other) {
        if ((node.x - course[i].x) ** 2 + (node.z - course[i].z) ** 2 < near) return course.slice(0, i + 1);
      }
    }
  }
  return course;
}

/**
 * The tarns: standing water that is nobody's river.
 *
 * A crossroads with no river near it holds one if its name says so. Rolled on the place rather than
 * counted out per world, so a wide country has more of them and a patch of it has its share.
 */
function tarnsNear(world: Land, within: Within, rivers: RiverNode[][], lakes: Lake[]): Lake[] {
  const out: Lake[] = [];
  for (const junction of junctionsIn(world, within)) {
    if (!world.land(junction.x, junction.z)) continue;
    const key = hashOfName(junction.id);
    const roll = rand2(derive(world.seed, OF_A_TARN), key, 0, OF_A_TARN);
    if (roll >= WATER.TARNS) continue;
    const r = WATER.TARN + rand2(derive(world.seed, OF_A_TARN), key, 1, OF_A_TARN) * WATER.TARN_MORE;
    if (wetNear(junction.x, junction.z, r + 8, rivers, lakes)) continue;
    out.push({ x: junction.x, z: junction.z, r, level: Math.max(1, Math.round(groundAt(world.seed, junction.x, junction.z))) });
  }
  return out;
}

/** Is there water within this far of a point? */
function wetNear(x: number, z: number, dist: number, rivers: RiverNode[][], lakes: Lake[]): boolean {
  const d2 = dist * dist;
  for (const river of rivers) {
    for (const node of river) if ((node.x - x) ** 2 + (node.z - z) ** 2 < d2) return true;
  }
  for (const lake of lakes) if ((lake.x - x) ** 2 + (lake.z - z) ** 2 < (dist + lake.r) ** 2) return true;
  return false;
}

/** The ground of a patch, gathered once: its slope and the high country standing on it. */
export function slopeOf(world: Country, within: Within): Slope {
  return { seed: world.seed, hills: highlandNear(world, within), ridges: highlandRidges(world.seed) };
}
