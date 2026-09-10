import { mulberry32 } from '../core/rng';

/**
 * Which way the wind is blowing, and how hard.
 *
 * A pure function of the seed and the clock, like everything else about this world's weather: two
 * players standing in the same field on the same morning are leaning into the same wind, and
 * neither of them had to be told about it. Nothing is stored and nothing is sent.
 *
 * It turns slowly. A wind that swung about would make a glider a lottery — you would set off for a
 * headland and arrive at the sea — and one that never turned would make the whole country a
 * one-way street. Two slow waves of different lengths, laid over each other, wander round the
 * compass over a couple of days without ever repeating on a scale anybody would notice.
 */

/** How long a full turn of the slower wave takes, in days. */
const SLOW = 3.1;
/** And the quicker one, which is what stops it being a clock hand. */
const QUICK = 0.41;

/** How hard it can blow, in world units a second, at the two ends of its own swell. */
const STRENGTH = { least: 0.55, most: 2.4 };

export interface Wind {
  /** A unit vector: which way it is going, not which way it is coming from. */
  x: number;
  z: number;
  /** How hard, in world units a second. */
  hard: number;
}

/**
 * The wind over a world, on a given day at a given hour.
 *
 * `time` is the fraction of the day the game keeps everywhere else, so a caller hands over what it
 * already has. The seed only sets where the two waves start, which is what makes one seed's weather
 * its own without making any of it unpredictable.
 */
export function windAt(seed: number, day: number, time: number): Wind {
  const rng = mulberry32(seed ^ 0x5f1d);
  const offSlow = rng() * Math.PI * 2, offQuick = rng() * Math.PI * 2;
  const clock = day + time;
  const angle = offSlow + (clock / SLOW) * Math.PI * 2 + Math.sin(offQuick + (clock / QUICK) * Math.PI * 2) * 0.7;
  // and how hard, on a swell of its own so that a still morning is a thing that happens
  const swell = 0.5 + 0.5 * Math.sin(offQuick + (clock / (SLOW * 0.7)) * Math.PI * 2);
  return {
    x: Math.cos(angle),
    z: Math.sin(angle),
    hard: STRENGTH.least + swell * (STRENGTH.most - STRENGTH.least),
  };
}

/** Which way the wind is going, as somebody would say it: "out of the north-west". */
export function windSaid(wind: Wind): string {
  const from = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  // the compass runs clockwise from north, and a wind is named for where it comes *from*
  const angle = Math.atan2(-wind.x, wind.z);
  const at = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return from[at];
}
