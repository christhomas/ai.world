/**
 * Having somebody build you a house.
 *
 * Everything in this world belonged to somebody else. You could sleep in an inn, drink in a pub
 * and sell to a shop, and none of it was ever yours; the village built and you visited. This is
 * the first thing in the game that stays where you put it and is still there when you come back.
 *
 * It is commissioned rather than placed: you find a builder in the pub, walk to where you want it
 * and say there. Choosing by standing somewhere costs no new interface and means the ground has
 * to be somewhere you could actually stand, which is the same check the world already makes when
 * it lays out a village.
 *
 * And it takes days. A house that appears when you pay for it is a purchase; one that is still a
 * frame when you next ride past is a thing being built, which is worth the wait it costs.
 */

export const BUILD = {
  /** What a house costs, all in. */
  PRICE: 420,
  /** Paid up front to start, with the rest owed on the day it is finished. */
  DEPOSIT: 0.4,
  /** How many days a builder takes over one. */
  DAYS: 6,
  /** No closer than this to anything else standing, in tiles. */
  CLEAR_OF: 7,
  /** And no further than this from the village that the builder will walk to it. */
  WITHIN: 90,
} as const;

/** A house that has been paid for and is going up. */
export interface Commission {
  id: string;
  /** Where it is being built. */
  x: number;
  z: number;
  /** The village whose builder took the job, which is whose purse the money goes into. */
  village: string;
  /** The day work started. */
  began: number;
  /** What has been handed over so far, and what the whole job costs. */
  paid: number;
  price: number;
}

/** How far along a build is, from nought the day it is commissioned to one when it is finished. */
export function progressOf(job: Commission, day: number): number {
  return Math.max(0, Math.min(1, (day - job.began) / BUILD.DAYS));
}

export function isFinished(job: Commission, day: number): boolean {
  return progressOf(job, day) >= 1;
}

/** What is standing on the plot right now. */
export type Stage = 'pegs' | 'frame' | 'roof' | 'house';

/**
 * What a passer-by would see. Four stages rather than a smooth grow, because a building site is a
 * sequence of recognisable states and a house that inflates is a worse lie than one that jumps.
 */
export function stageAt(job: Commission, day: number): Stage {
  const done = progressOf(job, day);
  if (done >= 1) return 'house';
  if (done >= 0.6) return 'roof';
  if (done >= 0.25) return 'frame';
  return 'pegs';
}

/** What is owed today: the deposit to begin, the remainder when it is done, nothing between. */
export function owed(job: Commission, day: number): number {
  if (!isFinished(job, day)) return 0;
  return Math.max(0, job.price - job.paid);
}

export function deposit(price = BUILD.PRICE): number {
  return Math.round(price * BUILD.DEPOSIT);
}

/**
 * Is this somewhere a house could go?
 *
 * `flat` is whether the ground itself will take a building, which the world already knows how to
 * answer. The rest is about not putting one on top of something else, or so far out that nobody
 * would walk to it.
 */
export function canBuildAt(
  x: number, z: number, flat: boolean,
  village: { x: number; z: number } | null,
  standing: ReadonlyArray<{ x: number; z: number }>,
): { ok: true } | { ok: false; why: string } {
  if (!flat) return { ok: false, why: 'The ground here will not take a house.' };
  if (!village) return { ok: false, why: 'No village near enough to send a builder.' };
  if (Math.hypot(village.x - x, village.z - z) > BUILD.WITHIN) {
    return { ok: false, why: 'That is too far out. No builder is walking that every morning.' };
  }
  for (const thing of standing) {
    if (Math.hypot(thing.x - x, thing.z - z) < BUILD.CLEAR_OF) {
      return { ok: false, why: 'Too close to what is already standing there.' };
    }
  }
  return { ok: true };
}

/** What the builder says about a job in progress. */
export function saidOfJob(job: Commission, day: number): string {
  const left = Math.max(0, BUILD.DAYS - (day - job.began));
  if (left <= 0) return 'Your house is finished. There is the matter of the rest of the money.';
  if (left === 1) return 'One more day on yours.';
  return `Yours will be ${left} days yet.`;
}
