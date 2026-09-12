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
  BOAT: 'boat',
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
   * How far along a job has to be before a passer-by would call it begun, and then nearly there.
   *
   * Fractions of the whole job rather than days, so they mean the same thing to a fountain that
   * takes two days and a house that takes six: each of the three visible stages gets roughly a
   * third of whatever the builder was given, which is what makes walking past twice worth doing.
   * At a quarter done there is something standing on the site, and past halfway it is recognisably
   * the thing that was ordered.
   */
  BEGUN_AT: 0.25,
  NEARLY_AT: 0.6,
  /**
   * How far from open water a keel may be laid, in tiles.
   *
   * A boatyard is a piece of shore, and a piece of shore is ground with the sea at the end of it.
   * Close enough that the hull is launched by sliding it down rather than carted anywhere, and far
   * enough back that the stocks are on dry land at high water — which is also what keeps the
   * `footprintLevel` check honest, because the yard is still a flat patch of ground like any other.
   */
  SHORE_WITHIN: 8,
  /**
   * And how far from a jetty, in tiles.
   *
   * The gate that makes this a coastal village's building rather than every village's. A boat
   * wants somewhere to be tied up when you are not in it, and a beach is not that: the pier is
   * where a hull lives between voyages, and it is also the thing a player had to pay for or find
   * before any of this was available to them. Wide enough to cover a whole small harbour, narrow
   * enough that a yard two headlands away does not count as being at one.
   */
  PIER_WITHIN: 60,
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
 *
 * A boat is the third answer and the one that made the field worth having rather than a boolean.
 * It is not placed against a house and it will not go on any piece of flat ground: it wants a
 * piece of *shore* — water at the end of it, and a jetty within walking distance to tie up at.
 * That is the whole of what makes a coastal village able to build something an inland one cannot,
 * and it is one more word in a union.
 */
export interface Buildable {
  id: string;
  /** What the builder calls it, mid-sentence: "I can put you up **a second storey**". */
  name: string;
  price: number;
  days: number;
  /** What has to be under it: open ground, a house of your own, or a shore with a jetty on it. */
  on: 'land' | 'house' | 'shore';
  /**
   * True when the finished thing leaves the site under its own power.
   *
   * A boat is the only one, and it is the first thing a village can build that does not stay where
   * it was put. Two things follow from it and both are one-liners: the yard is not told to the rest
   * of the world the way a building is — a village is not a landmark bigger for a boat that sails
   * away the same afternoon — and the site stops being drawn once she is in the water, or the shore
   * would keep a hull on it for ever while the same hull is moored at the pier.
   */
  moves?: boolean;
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
  /*
   * A boat, which is cheaper than the one on the pier and takes five days.
   *
   * Both halves of that are the reason to order one rather than buy one. The boatwright at the end
   * of a jetty sells a finished hull for `BOAT.PRICE` and you sail it away that minute; a builder
   * lays a keel on the shore and you come back for it. If a commissioned boat were dearer *and*
   * slower nobody would ever order one, and the entry would be a line in a table that never ran.
   * So the trade is the one a village would actually offer: the same boat, for less, if you can
   * wait — which is what having a builder is for.
   *
   * It blocks nothing. A hull on the stocks is a thing you walk round on a beach, and once it is
   * launched there is nothing on the shore to walk into at all.
   */
  {
    id: BUILDS.BOAT, name: 'a boat', price: 160, days: 5, on: 'shore', moves: true,
    done: 'She is off the stocks and riding at the jetty.', blocks: null,
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
export function onOffer(mine: readonly Commission[], day: number, harbour = false): Buildable[] {
  const standing = mine.some((job) =>
    buildable(job.what).on === 'land' && isFinished(job, day) && owed(job, day) <= 0);
  /*
   * Asked of what a thing goes *on* rather than of what it is: everything but the yard jobs can be
   * ordered by somebody who owns nothing, and a boat needs a shore rather than a house of your own.
   *
   * `harbour` is why this is a menu question and not only a ground question. The deposit is not
   * refundable and the dialogue says so, so offering a boat to a man drinking forty miles inland
   * would be taking sixty-four gold for a job he can never stand anywhere — the refusal would
   * arrive after the money had gone. A builder in a village with no jetty near it does not offer
   * boats, which is what "gated by the ground" has to mean when there is a deposit involved. It
   * defaults to false so that anything asking the old question gets the old answer.
   */
  return CATALOGUE.filter((entry) => (entry.on === 'shore' ? harbour : entry.on !== 'house' || standing));
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
   * The day a boat went into the water, and absent on everything that does not.
   *
   * A date rather than a flag, for the same reason `charged` is one: it is a thing that happened on
   * a particular morning and a date can answer questions a boolean cannot. What reads it today is
   * the drawing — a yard with the boat gone out of it has nothing on it to draw — and the commission
   * is kept rather than thrown away because it is still the record of who built her, in which
   * village, and what was paid for her.
   */
  launched?: number;
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

/**
 * How far on the work is, in the only terms a passer-by has: marked out, begun, nearly, done.
 *
 * The four were called pegs, frame, roof and house while a house was the only thing anybody could
 * order, and the names stopped being true the day the catalogue grew: a fountain has no frame and
 * a bathing pool never had a roof on it. These say how far along rather than what is standing,
 * which is the question every kind of job can answer — and what each kind actually shows at each
 * of them is `render/site.ts`'s business and no longer a word buried in a type.
 */
export type Stage = 'marked' | 'begun' | 'nearly' | 'done';

/**
 * What a passer-by would see. Four stages rather than a smooth grow, because a building site is a
 * sequence of recognisable states and a house that inflates is a worse lie than one that jumps.
 */
export function stageAt(job: Commission, day: number): Stage {
  const done = progressOf(job, day);
  if (done >= 1) return 'done';
  if (done >= BUILD.NEARLY_AT) return 'nearly';
  if (done >= BUILD.BEGUN_AT) return 'begun';
  return 'marked';
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
 * Is this somewhere a keel could be laid?
 *
 * The ground half is `canBuildAt`'s, unchanged and asked first: a yard is a flat, clear patch of
 * ground with nothing standing on it and a village near enough to walk a builder out from, exactly
 * like a house's plot. What a shore adds is the two things that make it a shore rather than a
 * field, and they are handed in as distances rather than as a world, so this stays a function of
 * numbers that a test can ask anything of.
 *
 * The jetty is the gate the worklist asks for and it is worth saying why it is the right one. Water
 * alone would let a hull be laid beside any pond in the country; a jetty is a thing somebody built,
 * which means the coast there is low enough to land at — `piers.ts` refuses a cliff — and it means
 * the boat has somewhere to lie when nobody is aboard. It is also the ordering the worklist names:
 * the harbour is what makes the boat possible, so the boat is what gives the harbour a reason.
 *
 * @param toWater how far the nearest navigable water is, in tiles. Infinity where there is none.
 * @param toPier  and the nearest jetty, measured the same way.
 */
export function canLayAKeel(
  x: number, z: number, flat: boolean,
  village: { x: number; z: number } | null,
  standing: ReadonlyArray<{ x: number; z: number }>,
  clear: boolean,
  toWater: number,
  toPier: number,
): { ok: true } | { ok: false; why: string } {
  const ground = canBuildAt(x, z, flat, village, standing, clear);
  if (!ground.ok) return ground;
  if (toWater > BUILD.SHORE_WITHIN) {
    return { ok: false, why: 'A boat wants building where she can be slid into the water, not carried to it.' };
  }
  if (toPier > BUILD.PIER_WITHIN) {
    return { ok: false, why: 'There is nowhere hereabouts to tie her up. Build her by a jetty or not at all.' };
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

/**
 * Is there still anything standing on this commission's ground?
 *
 * True of everything that was ever built until a boat was, because a house does not go anywhere.
 * A launched boat is the one job whose site is spent: the hull that was on the stocks is riding at
 * the jetty, and drawing it in both places would be two boats where the player paid for one.
 */
export function stillOnItsSite(job: Commission): boolean {
  return !buildable(job.what).moves || job.launched === undefined;
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

  /**
   * She is off the stocks. Records the day, which is what empties the yard.
   *
   * Kept on the commission rather than announced, because everything else about a commission is a
   * subtraction from today and this has to be too: a world reopened a fortnight later must find
   * the shore bare, and it will, because the boat was launched on a day that is written down.
   */
  launch(job: Commission, day: number): void {
    job.launched = Math.floor(day);
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
