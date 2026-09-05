import { hashString } from '../core/rng';

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
  /**
   * Half-width of the plot, in tiles. One is the 3x3 footprint the village's own cottages sit on,
   * and it has to stay that: the ground check is the world's own, and a house that asked for more
   * ground than a village house would could not be put anywhere a village house could.
   */
  PLOT: 1,
  /** No closer than this to anything else standing, in tiles. */
  CLEAR_OF: 7,
  /** And no further than this from the village that the builder will walk to it. */
  WITHIN: 90,
  /**
   * What a village adds to what it holds against you for every day the balance goes unpaid.
   *
   * It has to beat GRUDGE.FORGIVEN_A_DAY or a debt would be forgiven as fast as it is resented and
   * owing a builder four hundred gold would cost nothing at all. At this rate the net gain is a
   * shade under three a day, so a week of not paying makes a village sour on you and a month makes
   * you unwelcome in it — slow enough that you can be away on a long journey and come back to
   * settle up, sharp enough that ignoring it is a decision.
   */
  UNPAID_A_DAY: 4,
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
  /**
   * The last day the village was charged for a balance still standing. Kept on the commission
   * rather than counted from the finishing day, so that a debt settled and a debt never incurred
   * cost exactly the same afterwards, and so a save reopened after a month charges for that month
   * once instead of once per frame.
   */
  charged?: number;
  /** What is in the strongbox, once there has been anything in it. */
  store?: Store;
  /**
   * Which way the front of it looks, in radians. Taken from the way the hero was facing when they
   * stood on the plot and said there, because that is the only statement of intent anybody made
   * about the house's orientation and it is a better one than always-east.
   */
  rot?: number;
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
 * answer. `clear` is whether anything is growing on it — an oak is not a structure and so is not
 * in `standing`, but a house built round one has a tree through the roof, which was the first
 * thing that looked wrong when this was played. The rest is about not putting one on top of
 * something else, or so far out that nobody would walk to it.
 *
 * `clear` is last and defaults to true because it was added after the rest: everything that only
 * cares about ground and neighbours can go on calling this the way it always did.
 */
export function canBuildAt(
  x: number, z: number, flat: boolean,
  village: { x: number; z: number } | null,
  standing: ReadonlyArray<{ x: number; z: number }>,
  clear = true,
): { ok: true } | { ok: false; why: string } {
  if (!flat) return { ok: false, why: 'The ground here will not take a house.' };
  if (!clear) return { ok: false, why: 'There is something growing on that. Clear it or pick another spot.' };
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

/**
 * Whoever is drinking in the corner with sawdust still on him.
 *
 * A regular of the room rather than somebody on the village register, for the same reason the
 * pub's errand-giver is: a builder who can be carried off by a wolf half way through the job is a
 * house that dangles, and there is nothing the game could sensibly do about it. The name is grown
 * from the village so the same man is in the same pub for everybody playing that world.
 */
const BUILDERS = [
  'Hob the Builder', 'Wick the Carpenter', 'Dann the Mason',
  'Orrin, who puts up roofs', 'Salla the Joiner', 'Bram Longsaw',
];

export function builderIn(village: string, seed: number): string {
  return BUILDERS[Math.abs(hashString(`${village}:builder:${seed}`)) % BUILDERS.length];
}

/** What is in the strongbox of a house: coin, and things by the handful. */
export interface Store {
  gold: number;
  items: Record<string, number>;
}

/** A builder taken on and paid, with nowhere yet to put what he is building. */
export interface Hired {
  village: string;
  price: number;
  /** The deposit, already handed over. It is not refundable and the dialogue says so. */
  paid: number;
}

export interface HouseJson {
  hired?: Hired | null;
  jobs?: Commission[];
}

/**
 * Every house somebody has had built, and the builder they are currently holding.
 *
 * Shaped like `Plots` in farming.ts and for the same reason: the whole thing is derivable from a
 * day and a position, so nothing here ticks. A commission knows the day work started and every
 * question about it — how far along, what is owed, what is standing on the plot — is a
 * subtraction from today. A world reopened after a fortnight finds the house finished, because it
 * was always going to be.
 */
export class Houses {
  private taken: Hired | null = null;
  private readonly jobs: Commission[] = [];

  constructor(json?: HouseJson) {
    this.taken = json?.hired ?? null;
    for (const job of json?.jobs ?? []) this.jobs.push({ ...job, store: job.store ? { gold: job.store.gold, items: { ...job.store.items } } : undefined });
  }

  static from(json?: HouseJson): Houses { return new Houses(json); }

  /** The builder you are holding, waiting to be told where. */
  get hired(): Hired | null { return this.taken; }

  get count(): number { return this.jobs.length; }

  /** Every commission, for drawing and for the pub to count the days down over. */
  entries(): readonly Commission[] { return this.jobs; }

  /** Take a builder on. The deposit has already left the purse by the time this is called. */
  takeOn(village: string, price: number, paid: number): void {
    this.taken = { village, price, paid };
  }

  /**
   * Tell him where. Returns the commission, or null with nobody hired — which the caller should
   * never reach, because the offer to build is only made when a builder is being held.
   */
  place(x: number, z: number, day: number, rot = 0): Commission | null {
    const held = this.taken;
    if (!held) return null;
    this.taken = null;
    const job: Commission = {
      id: `house:${held.village}:${Math.floor(x)},${Math.floor(z)}`,
      x, z, village: held.village, began: day, paid: held.paid, price: held.price, rot,
    };
    this.jobs.push(job);
    return job;
  }

  /** The nearest house within reach, or null. Used by whatever the player is standing next to. */
  nearest(x: number, z: number, within: number): Commission | null {
    let best: Commission | null = null;
    let nearest = within;
    for (const job of this.jobs) {
      const away = Math.hypot(job.x - x, job.z - z);
      if (away <= nearest) { nearest = away; best = job; }
    }
    return best;
  }

  /** Houses that are finished and still owe their builder something, on this day. */
  owing(day: number): Commission[] {
    return this.jobs.filter((job) => owed(job, day) > 0);
  }

  /** Money handed over towards a house. */
  pay(job: Commission, gold: number): void {
    job.paid = Math.min(job.price, job.paid + gold);
  }

  /**
   * What the villages are owed for, since they were last told about it.
   *
   * Worked out on being asked rather than ticked, the way a grudge fades and a crop ripens: a
   * player who leaves a debt standing and sails away for a fortnight owes a fortnight of ill
   * feeling for it whether or not anything was running while they were gone. The first charge runs
   * from the day the house was finished, because that is the day the man asked to be paid.
   */
  charge(day: number): Array<{ village: string; weight: number }> {
    const bills: Array<{ village: string; weight: number }> = [];
    for (const job of this.jobs) {
      if (owed(job, day) <= 0) continue;
      const from = job.charged ?? job.began + BUILD.DAYS;
      job.charged = Math.floor(day);
      const days = Math.floor(day) - Math.floor(from);
      if (days <= 0) continue;
      bills.push({ village: job.village, weight: days * BUILD.UNPAID_A_DAY });
    }
    return bills;
  }

  /** The strongbox in a finished house, made the first time somebody opens it. */
  strongbox(job: Commission): Store {
    return (job.store ??= { gold: 0, items: {} });
  }

  toJSON(): HouseJson {
    return { hired: this.taken, jobs: this.jobs };
  }
}
