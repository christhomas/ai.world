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

/**
 * The things a builder can be told to put up.
 *
 * `build` is a verb that takes an object, and the object has to come from somewhere nameable or the
 * argument is a string anybody can put anything in. The list was one line long for a while and the
 * shortness was the honest part: the geometry for a second thing did not exist, and inventing what
 * an ordered bath house looks like is a worse answer than admitting the catalogue is short.
 *
 * What unstuck it was looking properly. `house()` has taken a number of storeys since villagers
 * started spending an inheritance on one, and there were a bath house and a bathing pool modelled
 * and used by nothing at all. Three of the four entries below are geometry that was already here.
 */
export const BUILDS = {
  HOUSE: 'house',
  STOREY: 'storey',
  POOL: 'pool',
  FOUNTAIN: 'fountain',
} as const;

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
  /**
   * How far out of a house's wall something added to it stands, in tiles.
   *
   * Far enough to be beside the house rather than through it — the house is three tiles across and
   * a pool is another three — and near enough to read as the same property from the road.
   */
  BESIDE_AT: 3.4,
  /**
   * How near your own house you have to stand to have something added to it, in tiles.
   *
   * Wider than the door, because what is being placed is in the yard rather than in the house.
   * Narrow enough that standing between two houses is not ambiguous — which `nearest` settles
   * anyway, by taking whichever is closer.
   */
  BESIDE_WITHIN: 9,
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
  /**
   * How far along a job has to be before a passer-by would call it a frame, and then a roof.
   *
   * Set so each of the three visible stages gets roughly a third of the week the builder takes,
   * which is what makes walking past twice worth doing: at a quarter done there is something
   * standing, and past halfway it has a roof on it.
   */
  FRAME_AT: 0.25,
  ROOF_AT: 0.6,
} as const;

/**
 * What something costs to have built, and what it needs under it.
 *
 * ## Why a price sits in a table
 *
 * One number per thing, the same in every village. A builder who set his own would be the more
 * interesting game — a poor village's man working cheap, a rich one's charging what the traffic
 * bears — and every price in the world would then depend on the village's fortune, which is a day's
 * balancing on top of a day's building. This is the base to start from, and the shape does not
 * change when a village gets an opinion: `price` becomes what a builder quotes from.
 *
 * ## Why `on` exists
 *
 * A house needs a piece of ground and nothing else. A second storey needs a house to go on top of,
 * a pool and a fountain need a yard to stand in — and a yard is a thing that belongs to a house.
 * So half this list is not placed by walking somewhere and saying there: it is placed by standing
 * at a building you already own. That is the whole difference and it is one field.
 */
export interface Buildable {
  id: string;
  /** What the builder calls it, mid-sentence: "I can put you up **a second storey**". */
  name: string;
  price: number;
  days: number;
  /** What has to be under it: open ground, or a house of your own. */
  on: 'land' | 'house';
  /**
   * True when finishing it changes the building it was added to rather than standing beside it.
   *
   * A storey is the only one today. It matters because such a job has no site of its own once it is
   * done — the house is simply taller — where a pool is a thing in the yard for ever after.
   */
  changes?: boolean;
  /** What the builder says when he has finished, for the flash in the corner. */
  done: string;
  /**
   * How far out from the middle it is a wall, in tiles, or null for something you can walk into.
   *
   * A house is the 3x3 it stands on. A fountain is the one tile it is on — you walk round it, not
   * through it. A pool is water in a sunk tank and is nothing to walk into, and a storey adds
   * nothing at all: it is the house's own tiles, which are solid already.
   */
  blocks: number | null;
}

export const CATALOGUE: readonly Buildable[] = [
  {
    id: BUILDS.HOUSE, name: 'a house', price: BUILD.PRICE, days: BUILD.DAYS, on: 'land',
    done: 'The house is yours. There is a strongbox in it.', blocks: BUILD.PLOT,
  },
  {
    id: BUILDS.STOREY, name: 'a second storey', price: 260, days: 4, on: 'house', changes: true,
    done: 'Another floor under the same roof.', blocks: null,
  },
  {
    id: BUILDS.POOL, name: 'a bathing pool', price: 150, days: 3, on: 'house',
    done: 'The pool is filled and the lip is dry enough to sit on.', blocks: null,
  },
  {
    id: BUILDS.FOUNTAIN, name: 'a fountain', price: 90, days: 2, on: 'house',
    done: 'The fountain is running.', blocks: 0,
  },
];

/**
 * What a builder will offer somebody, given what they already own in his village.
 *
 * A rule rather than a line in a dialogue, because it is one, and it belongs to the builder rather
 * than to the room he is drinking in: half the catalogue goes on a house, so listing those to
 * somebody with no house is a menu of things that can only be refused.
 * Finished and paid for, both — a man who is owed for the last job does not take the next one, and
 * a pool beside a frame is a pool beside a building site.
 */
export function onOffer(mine: readonly Commission[], day: number): Buildable[] {
  const standing = mine.some((job) =>
    buildable(job.what).on === 'land' && isFinished(job, day) && owed(job, day) <= 0);
  return CATALOGUE.filter((entry) => entry.on === 'land' || standing);
}

/** One entry by name. Anything unknown is a house, which is what every save older than the list holds. */
export function buildable(what: string | undefined): Buildable {
  return CATALOGUE.find((entry) => entry.id === what) ?? CATALOGUE[0];
}

/** What a thing is being built on, for whoever is deciding where it may go. */
export function needs(what: string | undefined): Buildable['on'] {
  return buildable(what).on;
}

/** A house that has been paid for and is going up. */
export interface Commission {
  id: string;
  /**
   * What was ordered.
   *
   * Every commission in every save before this one was a house, and there was no field because
   * there was no choice. Building is a verb that takes an object — a house, a second storey, a bath
   * house, a paddock — so the commission has to carry which, even while the list is one long.
   * Missing means a house, which is what every old save holds.
   */
  what?: string;
  /**
   * The building this one was added to, when it is an addition rather than a building of its own.
   *
   * A storey, a pool and a fountain are all things you have done to a house you already own, so
   * each carries the id of the house it belongs to. Absent on a house, which belongs to a piece of
   * ground and to nothing else.
   */
  to?: string;
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

/** How long this particular job takes: a fountain is two days and a house is a week. */
export function daysFor(job: Commission): number {
  return buildable(job.what).days;
}

/** How far along a build is, from nought the day it is commissioned to one when it is finished. */
export function progressOf(job: Commission, day: number): number {
  return Math.max(0, Math.min(1, (day - job.began) / daysFor(job)));
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
  if (done >= BUILD.ROOF_AT) return 'roof';
  if (done >= BUILD.FRAME_AT) return 'frame';
  return 'pegs';
}

/** What is owed today: the deposit to begin, the remainder when it is done, nothing between. */
export function owed(job: Commission, day: number): number {
  if (!isFinished(job, day)) return 0;
  return Math.max(0, job.price - job.paid);
}

/** What is paid to start. Typed as a number rather than inferred, or the default pins it to a house. */
export function deposit(price: number = BUILD.PRICE): number {
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

/**
 * Where an addition stands, given the house it belongs to and where its owner was standing.
 *
 * The side of the house you are on is the side it goes, which is the same statement of intent the
 * house's own facing is taken from — you walked round to the side you wanted and pressed Enter.
 * A storey is the exception and sits exactly on the house, because it *is* the house.
 */
export function beside(
  parent: { x: number; z: number }, what: string, fromX: number, fromZ: number,
): { x: number; z: number } {
  if (buildable(what).changes) return { x: parent.x, z: parent.z };
  const dx = fromX - parent.x, dz = fromZ - parent.z;
  const away = Math.hypot(dx, dz);
  // standing in the doorway is not a direction, so the yard goes out the front by default
  if (away < 0.5) return { x: parent.x + BUILD.BESIDE_AT, z: parent.z };
  return {
    x: parent.x + (dx / away) * BUILD.BESIDE_AT,
    z: parent.z + (dz / away) * BUILD.BESIDE_AT,
  };
}

/**
 * Can this be added to that house?
 *
 * Four refusals, and each of them is a sentence somebody would actually say. The building has to
 * be yours and finished — a builder will not start a pool beside a frame — it has to be paid for,
 * because a man owed four hundred gold for the house does not begin the next job on credit, and a
 * house can only have one second storey.
 */
export function canAttachTo(
  parent: Commission | null, what: string, day: number, already: readonly Commission[],
): { ok: true } | { ok: false; why: string } {
  const wants = buildable(what);
  if (!parent) return { ok: false, why: `Stand by a house of your own. ${wants.name} has to go on something.` };
  if (!isFinished(parent, day)) return { ok: false, why: 'That one is not finished. One thing at a time.' };
  if (owed(parent, day) > 0) return { ok: false, why: 'Settle up for that one first. I do not start the next on credit.' };
  if (wants.changes && already.some((job) => job.to === parent.id && job.what === what)) {
    return { ok: false, why: 'It has one of those already.' };
  }
  return { ok: true };
}

/**
 * How many floors a house is standing at today.
 *
 * Counted rather than kept, the way everything else here is: a storey is a commission pointing at
 * the house, and when it is finished the house is taller. Nothing has to be written down when the
 * work ends, so a world reopened after a fortnight finds the storey on it because it always was.
 */
export function storeysOf(house: Commission, jobs: readonly Commission[], day: number): number {
  const added = jobs.filter((job) =>
    job.to === house.id && buildable(job.what).changes && isFinished(job, day)).length;
  return 1 + Math.min(1, added);
}

/** What the builder says about a job in progress. */
export function saidOfJob(job: Commission, day: number): string {
  const left = Math.max(0, daysFor(job) - (day - job.began));
  const what = buildable(job.what).name;
  if (left <= 0) return `Your ${what.replace(/^an? /, '')} is finished. There is the matter of the rest of the money.`;
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
  /** What he was told to build. Missing means a house, which is what every old save holds. */
  what?: string;
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
  takeOn(village: string, price: number, paid: number, what: string = BUILDS.HOUSE): void {
    this.taken = { village, price, paid, what };
  }

  /**
   * Tell him where. Returns the commission, or null with nobody hired — which the caller should
   * never reach, because the offer to build is only made when a builder is being held.
   */
  place(x: number, z: number, day: number, rot = 0, to?: string): Commission | null {
    const held = this.taken;
    if (!held) return null;
    this.taken = null;
    /*
     * What he was told to build, carried onto the plot.
     *
     * It was dropped here for a version: `Commission.what` existed, `takeOn` recorded it, and the
     * one step between the table and the site threw it away and wrote `house:` into the id. A field
     * nothing reads is a field that is not there, whatever the type says.
     *
     * The id names it too, because an id is what a delta log keys a building by — and two different
     * things ordered on the same tile would otherwise be one building that changed its mind.
     */
    const what = held.what ?? BUILDS.HOUSE;
    const job: Commission = {
      id: `${what}:${held.village}:${Math.floor(x)},${Math.floor(z)}`,
      what, x, z, village: held.village, began: day, paid: held.paid, price: held.price, rot,
      // what it was added to, when it is an addition. A storey shares its tile with the house it
      // is on, so the id would collide without the kind in it — which is exactly why the kind is
      // in the id already
      ...(to ? { to } : {}),
    };
    this.jobs.push(job);
    return job;
  }

  /**
   * A house somebody else paid for, as the world describes it.
   *
   * The money is theirs and stays theirs — this is not a commission we are holding, it is a
   * building standing in a village we can both see, and what it looks like is worked out from the
   * day it was begun. Named for what it is: adopting somebody else's house rather than taking one
   * on. Doing nothing when we already know about it, because a delta log may say it twice.
   */
  adopt(built: {
    id: string; village: string; x: number; z: number; rot: number; day: number;
    what?: string; to?: string;
  }): void {
    if (this.jobs.some((job) => job.id === built.id)) return;
    this.jobs.push({
      id: built.id, x: built.x, z: built.z, village: built.village,
      began: built.day, rot: built.rot, what: built.what, to: built.to,
      // paid in full by whoever ordered it: nobody here owes a village anything for it
      paid: 0, price: 0,
    });
  }

  /**
   * The nearest building within reach, or null. Used by whatever the player is standing next to.
   *
   * `is` narrows it to a kind of building, and exists because the plots stopped all being houses:
   * a storey shares its tile with the house it is on and a pool stands three tiles off, so "the
   * nearest thing I have had built" and "my house" are no longer the same question. Pressing Enter
   * at the door wants the second one — a pool has no strongbox in it.
   */
  nearest(x: number, z: number, within: number, is?: (job: Commission) => boolean): Commission | null {
    let best: Commission | null = null;
    let nearest = within;
    for (const job of this.jobs) {
      if (is && !is(job)) continue;
      const away = Math.hypot(job.x - x, job.z - z);
      if (away <= nearest) { nearest = away; best = job; }
    }
    return best;
  }

  /** Whether this commission is a building in its own right rather than something added to one. */
  static isABuilding(job: Commission): boolean {
    return buildable(job.what).on === 'land';
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
      const from = job.charged ?? job.began + daysFor(job);
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
