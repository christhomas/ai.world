import { mulberry32 } from '../core/rng';
import { SALT, derive } from '../core/salts';
import { DAY_LENGTH } from './state';
import { GRAPH, WORLD } from '../core/config';
import type { TerrainSampler } from '../world/terrain';

/**
 * Whales. They live out where the water is deep and nothing else goes, and on every hour of the
 * world's clock a pod breaches: one after another out of the water, over, and down again.
 *
 * Like the ferries, a whale is a function of the time and the seed rather than a thing being
 * simulated. Two people in one world watch the same pod leave the water on the same beat without
 * a byte crossing between them, and a world reloaded a week later still has its whales in it.
 */

export const WHALE = {
  /** Pods scattered through one world's deep water. */
  PODS: 12,
  /** Whales in a pod, fewest and most. */
  POD_MIN: 2,
  POD_MAX: 4,
  /** How often a pod puts on a display: every hour, on the hour. */
  HOURS_BETWEEN: 1,
  /** How long the whole display lasts, in real seconds. */
  DISPLAY: 9,
  /** How long one whale is out of the water. */
  ARC: 2.4,
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
  /** You are told a display has begun within this many tiles of it. */
  WATCH: 70,
  /** A whale coming down this close to your boat throws you out of it. */
  SPLASH: 2.6,
} as const;

/** Real seconds in one hour of the world's clock. */
export const HOUR_SECONDS = DAY_LENGTH / 24;

export interface Pod {
  x: number;
  z: number;
  /** How many whales, and which hour of the day this pod likes best (it breaches higher then). */
  size: number;
  favourite: number;
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

/**
 * Where the pods live. Deep water only — land in this world grows along the roads, so water far
 * from any road is water far from anything at all.
 */
export function planPods(sampler: TerrainSampler, seed: number): Pod[] {
  const rng = mulberry32(derive(seed, SALT.WHALE));
  const pods: Pod[] = [];
  const reach = GRAPH.RADIUS * 0.95;
  for (let tries = 0; tries < 600 && pods.length < WHALE.PODS; tries++) {
    const angle = rng() * Math.PI * 2;
    const distance = GRAPH.RADIUS * 0.35 + rng() * reach * 0.6;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const here = sampler.probe(x, z);
    if (here.land || here.roadDist < WHALE.DEEP) continue;
    // pods keep their distance from one another, so a crossing does not pass three at once
    if (pods.some((p) => Math.hypot(p.x - x, p.z - z) < WHALE.DEEP * 2)) continue;
    pods.push({
      x, z,
      size: WHALE.POD_MIN + Math.floor(rng() * (WHALE.POD_MAX - WHALE.POD_MIN + 1)),
      favourite: Math.floor(rng() * 24),
      seed: (seed ^ Math.floor(rng() * 0xffffff)) >>> 0,
    });
  }
  return pods;
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

/** Whether a pod is putting on a display at this moment, and how far into it. */
export function displayAt(pod: Pod, seconds: number): { showing: boolean; into: number; hour: number } {
  const { hour, into } = hourAt(seconds);
  const showing = hour % WHALE.HOURS_BETWEEN === 0 && into < WHALE.DISPLAY;
  return { showing, into, hour };
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

  // each whale takes its turn, spaced through the display so they follow one another over
  const turn = (index / Math.max(1, pod.size)) * (WHALE.DISPLAY - WHALE.ARC);
  const t = into - turn;
  if (t < 0 || t > WHALE.ARC) return waiting;

  const through = t / WHALE.ARC;
  // the pod's favourite hour gets the bigger jump: something to arrange an evening around
  const lift = WHALE.HEIGHT * (hour % 24 === pod.favourite ? 1.35 : 1);
  const rise = Math.sin(through * Math.PI);
  const forward = (through - 0.5) * WHALE.REACH;
  return {
    x: x + Math.cos(heading) * forward,
    z: z + Math.sin(heading) * forward,
    y: WORLD.WATER_Y - WHALE.SUBMERGED + rise * lift,
    yaw: heading,
    // nose to the sky on the way up, nose to the water on the way down
    pitch: Math.cos(through * Math.PI) * 1.05,
    airborne: rise > 0.08,
    through,
  };
}

/** Where a whale comes down, for anything that might be underneath it. */
export function landingOf(pod: Pod, index: number, seconds: number): { x: number; z: number } | null {
  const now = whaleAt(pod, index, seconds);
  if (now.through < 0) return null;
  // the frame it re-enters the water: near the end of the arc, and falling
  return now.through > 0.86 ? { x: now.x, z: now.z } : null;
}
