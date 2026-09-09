import { hashString, mulberry32, rand2 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { DAY_LENGTH } from './state';
import { WORLD } from '../core/config';
import type { TerrainSampler } from '../world/terrain';
import type { Within } from '../world/window';

/**
 * Whales. They live out where the water is deep and nothing else goes, and on every hour of the
 * world's clock a pod breaches: one after another out of the water, over, and down again.
 *
 * Like the ferries, a whale is a function of the time and the seed rather than a thing being
 * simulated. Two people in one world watch the same pod leave the water on the same beat without
 * a byte crossing between them, and a world reloaded a week later still has its whales in it.
 */

export const WHALE = {
  /**
   * How far apart the whaling grounds lie, in tiles: the country is cut into squares this wide and
   * each of them offers one family, which stands if the water where it fell is deep.
   *
   * It replaces a count. There were eighteen pods in a world, which is a number only a world with
   * an edge can have — and rejection sampling for eighteen spots in deep water is a search over
   * all the water there is. This says the same thing as a density instead, and a density is a
   * local fact: a hundred and ten tiles puts twenty-odd families in a world the size of the old
   * one, where the ring put eighteen, and puts the same again in open ocean a thousand tiles from
   * anywhere. Smaller and the sea is a whale farm; larger and a player can cross an ocean without
   * meeting one.
   */
  GROUNDS: 110,
  /** Whales in a pod, fewest and most. */
  POD_MIN: 2,
  POD_MAX: 4,
  /**
   * Every family breaches every hour, but each keeps to its own mark within it rather than to the
   * stroke — so where two pods are in sight you get two displays at different moments instead of
   * one doubled.
   */
  HOURS_BETWEEN: 1,
  /**
   * How long a display lasts, in real seconds. An hour of the world is five minutes, so a family
   * is up for a good two of them — long enough to row over and watch, short enough that the sea
   * is not permanently full of whales.
   */
  DISPLAY: 120,
  /** How long one whale is out of the water. */
  ARC: 2.4,
  /** How often one whale takes its turn again. The pod spreads itself through this. */
  PERIOD: 5.6,
  /** How high a breach carries it above the waves, in tiles. */
  HEIGHT: 3.2,
  /** How far it travels forward while it is up there. */
  REACH: 4.5,
  /** How far a pod drifts from its centre while it waits, and how fast it circles. */
  DRIFT: 5,
  CIRCLE_SPEED: 0.06,
  /** How deep the backs sit between displays. */
  SUBMERGED: 0.4,
  /** Water this far from the nearest road is deep enough for whales. */
  DEEP: 30,
  /** How close two pods may live. Near enough that a good spot can have more than one in sight. */
  APART: 34,
  /** You are told a display has begun within this many tiles of it. */
  WATCH: 70,
  /** A whale coming down this close to your boat throws you out of it. */
  SPLASH: 2.6,
  /** How much higher the pod's favourite hour goes than the rest: something to be there for. */
  SHOWING_OFF: 1.35,
  /** How far the nose comes up at the top of the arc, in radians — a shade over sixty degrees. */
  PITCH: 1.05,
  /**
   * How far out of the water the arc has to have carried it before it counts as airborne, as a
   * share of the height. Anything less is a back breaking the surface, which is not a breach and
   * should not be drawn as one.
   */
  CLEAR_OF_WATER: 0.08,
  /**
   * How far through the arc a whale is when it hits the water again, out of one. Not the very end
   * of it: whatever is underneath needs to be thrown clear on the way down rather than after the
   * splash, and this is the frame the spray belongs to.
   */
  SPLASHDOWN: 0.86,
} as const;

/** Real seconds in one hour of the world's clock. */
export const HOUR_SECONDS = DAY_LENGTH / 24;

export interface Pod {
  /**
   * The square of sea it was thrown in, which is its name for ever.
   *
   * Whatever has to remember something about a family — that it has already been announced this
   * hour, say — remembers it by this rather than by holding on to the object, because the pods
   * around the hero are gathered afresh as he sails and the same family comes back as a new one.
   */
  id: string;
  x: number;
  z: number;
  /** How many whales, and which hour of the day this pod likes best (it breaches higher then). */
  size: number;
  favourite: number;
  /** Seconds into each hour when this family begins, which is its own and nobody else's. */
  at: number;
  /** Its own stream, so each whale in it moves differently from its neighbours. */
  seed: number;
}

export interface WhaleState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Nose up as it leaves the water, nose down as it comes back. */
  pitch: number;
  /** True while it is clear of the water. */
  airborne: boolean;
  /** How far through its arc, 0 to 1, or -1 when it is not jumping at all. */
  through: number;
}

/** Salts, so where a family is thrown and which of two keeps the water are different questions. */
const OF_THE_GROUND = 0x6bd1;
const OF_ITS_RANK = 0x2f47;

/**
 * The families in a patch of sea.
 *
 * Deep water only, which is a local test: land grows along the roads, so water far from any road
 * is water far from anything at all, and how far the nearest road is is a question about the
 * ground here rather than about the world.
 *
 * Where they are is the part that had to change. Whales used to be thrown at a ring of the
 * world's radius — a third of the way out to two thirds — and kept if they landed in deep water,
 * eighteen of them, tried for six hundred times. Every clause of that is a fact about a world with
 * a middle and an edge: the ring, the count, and the search that stops when it has found enough.
 * So the sea is cut into squares instead. Each square offers one family, thrown where its own
 * name says, standing if the water there is deep and if no better family wants the same stretch of
 * sea. Nothing counts anything and nothing is searched for; a patch of ocean has the whales it has
 * whether it is asked about on its own, as a corner of somewhere bigger, or after a week's sailing.
 */
export function podsIn(sampler: TerrainSampler, seed: number, within: Within): Pod[] {
  // Wider than the patch by the room a family keeps, for the same reason the springs are: a pod at
  // the edge can be turned away by one just outside, and a patch that did not look would keep
  // whales its neighbour knows are not there. Both sides ask the same question and get one answer.
  const of = derive(seed, SALT.WHALE);
  const cell = WHALE.GROUNDS;
  const lowI = Math.floor((within.x0 - WHALE.APART) / cell), highI = Math.floor((within.x1 + WHALE.APART) / cell);
  const lowJ = Math.floor((within.z0 - WHALE.APART) / cell), highJ = Math.floor((within.z1 + WHALE.APART) / cell);

  const offered: Array<{ pod: Pod; rank: number }> = [];
  for (let cj = lowJ; cj <= highJ; cj++) {
    for (let ci = lowI; ci <= highI; ci++) {
      const x = (ci + rand2(of, ci, cj, OF_THE_GROUND)) * cell;
      const z = (cj + rand2(of, ci, cj, OF_THE_GROUND ^ 0x1f)) * cell;
      const here = sampler.probe(x, z);
      if (here.land || here.roadDist < WHALE.DEEP) continue;
      offered.push({ pod: habitsOf(seed, `pod:${ci}:${cj}`, x, z), rank: rand2(of, ci, cj, OF_ITS_RANK) });
    }
  }
  return offered
    .filter((one) => !offered.some((other) => beats(other, one)))
    .filter(({ pod }) => pod.x >= within.x0 && pod.x <= within.x1 && pod.z >= within.z0 && pod.z <= within.z1)
    .map(({ pod }) => pod);
}

/** The families in the country round a point, which is what anybody watching the sea wants. */
export function podsNear(sampler: TerrainSampler, seed: number, x: number, z: number, reach: number): Pod[] {
  return podsIn(sampler, seed, { x0: x - reach, z0: z - reach, x1: x + reach, z1: z + reach });
}

/**
 * Does one family take the stretch of sea another wanted? Only if it is too close, and better.
 *
 * Pods keep their distance so that a crossing does not pass three at once. Rank first and the name
 * to settle a tie, so the answer cannot depend on which of the two was asked about.
 */
function beats(other: { pod: Pod; rank: number }, one: { pod: Pod; rank: number }): boolean {
  if (other.pod.id === one.pod.id) return false;
  if (Math.hypot(other.pod.x - one.pod.x, other.pod.z - one.pod.z) >= WHALE.APART) return false;
  return other.rank > one.rank || (other.rank === one.rank && other.pod.id < one.pod.id);
}

/**
 * What one family is like: how many, which hour it likes best, when in the hour it goes, and its
 * own stream of numbers.
 *
 * Drawn from its own name rather than from one stream walked in order, which is what makes a pod
 * the same pod whoever asks and in whatever company. Rolled from the same stream in sequence, the
 * fifth family in a patch was a different animal from the same family found first from the east.
 */
function habitsOf(seed: number, id: string, x: number, z: number): Pod {
  const rng = mulberry32(derive(seed, SALT.WHALE) ^ hashString(id));
  return {
    id, x, z,
    size: WHALE.POD_MIN + Math.floor(rng() * (WHALE.POD_MAX - WHALE.POD_MIN + 1)),
    favourite: Math.floor(rng() * 24),
    at: rng() * (HOUR_SECONDS - WHALE.DISPLAY),
    seed: (seed ^ Math.floor(rng() * 0xffffff)) >>> 0,
  };
}

/** The pods close enough to be worth drawing. */
export function podsWithin(pods: Pod[], x: number, z: number, range: number): Pod[] {
  return pods.filter((p) => Math.hypot(p.x - x, p.z - z) <= range);
}

/** Which hour of the world it is, and how far into it. */
export function hourAt(seconds: number): { hour: number; into: number } {
  const hour = Math.floor(seconds / HOUR_SECONDS);
  return { hour, into: seconds - hour * HOUR_SECONDS };
}

/**
 * Whether a pod is putting on a display at this moment, and how far into it. Each family has its
 * own mark within the hour, so two pods in sight of one another do not go at the same instant.
 */
export function displayAt(pod: Pod, seconds: number): { showing: boolean; into: number; hour: number } {
  const { hour, into } = hourAt(seconds);
  const mine = into - pod.at;
  const showing = hour % WHALE.HOURS_BETWEEN === 0 && mine >= 0 && mine < WHALE.DISPLAY;
  return { showing, into: mine, hour };
}

/**
 * One whale, at one moment. Between displays it circles its pod's patch of sea with its back
 * just under the surface; on the hour it takes its turn to leave the water.
 */
export function whaleAt(pod: Pod, index: number, seconds: number): WhaleState {
  const rng = mulberry32(pod.seed ^ (index * 0x9e37));
  const phase = rng() * Math.PI * 2;
  const radius = WHALE.DRIFT * (0.4 + rng() * 0.6);
  const around = phase + seconds * WHALE.CIRCLE_SPEED;
  const x = pod.x + Math.cos(around) * radius;
  const z = pod.z + Math.sin(around) * radius;
  const heading = around + Math.PI / 2;
  const waiting: WhaleState = {
    x, z, y: WORLD.WATER_Y - WHALE.SUBMERGED, yaw: heading, pitch: 0, airborne: false, through: -1,
  };

  const { showing, into, hour } = displayAt(pod, seconds);
  if (!showing) return waiting;

  // the pod spreads itself through the cycle, so while the display lasts one of them is always up
  const turn = (index / Math.max(1, pod.size)) * WHALE.PERIOD;
  const mine = into - turn;
  if (mine < 0) return waiting;
  const t = mine % WHALE.PERIOD;
  if (t > WHALE.ARC) return waiting;

  const through = t / WHALE.ARC;
  // the pod's favourite hour gets the bigger jump: something to arrange an evening around
  const lift = WHALE.HEIGHT * (hour % 24 === pod.favourite ? WHALE.SHOWING_OFF : 1);
  const rise = Math.sin(through * Math.PI);
  const forward = (through - 0.5) * WHALE.REACH;
  return {
    x: x + Math.cos(heading) * forward,
    z: z + Math.sin(heading) * forward,
    y: WORLD.WATER_Y - WHALE.SUBMERGED + rise * lift,
    yaw: heading,
    // nose to the sky on the way up, nose to the water on the way down
    pitch: Math.cos(through * Math.PI) * WHALE.PITCH,
    airborne: rise > WHALE.CLEAR_OF_WATER,
    through,
  };
}

/** Where a whale comes down, for anything that might be underneath it. */
export function landingOf(pod: Pod, index: number, seconds: number): { x: number; z: number } | null {
  const now = whaleAt(pod, index, seconds);
  if (now.through < 0) return null;
  // the frame it re-enters the water: near the end of the arc, and falling
  return now.through > WHALE.SPLASHDOWN ? { x: now.x, z: now.z } : null;
}
