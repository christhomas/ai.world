import { Claims } from './claims';
import { SEASON_LENGTH, Season, seasonOf } from './seasons';

/**
 * A plot of ground you work. Seeds go in, days pass, a crop comes up. Everything is stored as
 * the day it was planted, so growth is a subtraction rather than a simulation and nothing has to
 * tick while you are away.
 */
export interface Crop {
  id: string;
  name: string;
  emoji: string;
  seedId: string;
  seedPrice: number;
  /** Days from planting to harvest. */
  days: number;
  /** How many of the crop item a ripe plant yields. */
  yield: number;
  /** Seasons it will grow in; planting out of season simply will not take. */
  seasons: Season[];
}

export const CROPS: Record<string, Crop> = {
  wheat: { id: 'wheat', name: 'Wheat', emoji: '🌾', seedId: 'wheatseed', seedPrice: 6, days: 3, yield: 3, seasons: [Season.Spring, Season.Summer] },
  turnip: { id: 'turnip', name: 'Turnip', emoji: '🥔', seedId: 'turnipseed', seedPrice: 4, days: 2, yield: 4, seasons: [Season.Spring, Season.Autumn] },
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', emoji: '🎃', seedId: 'pumpkinseed', seedPrice: 12, days: 5, yield: 2, seasons: [Season.Summer, Season.Autumn] },
};

export const SEED_TO_CROP: Record<string, Crop> = Object.fromEntries(
  Object.values(CROPS).map((c) => [c.seedId, c]),
);

/** One planted square. Tiles are keyed "x,z" in the save. */
export interface Planting {
  crop: string;
  /** Day it went in the ground. */
  planted: number;
}

export type PlotJson = Record<string, Planting>;

/**
 * How far along a planting is, 0 to 1.
 *
 * `day` may carry a fraction — the world's clock does, and a day is an hour of real time, so a
 * crop that only moved at midnight would sit unchanged through most of a sitting.
 */
export function ripeness(planting: Planting, day: number): number {
  const crop = CROPS[planting.crop];
  if (!crop) return 0;
  return Math.max(0, Math.min(1, (day - planting.planted) / crop.days));
}

export function isRipe(planting: Planting, day: number): boolean {
  return ripeness(planting, day) >= 1;
}

/** Will this seed take, planted today? */
export function canPlant(crop: Crop, day: number): boolean {
  return crop.seasons.includes(seasonOf(day));
}

/** Days until the next season this crop will grow in. */
export function daysUntilSeason(crop: Crop, day: number): number {
  for (let ahead = 1; ahead <= SEASON_LENGTH * 4; ahead++) {
    if (crop.seasons.includes(seasonOf(day + ahead))) return ahead;
  }
  return 0;
}

/** The tiles you own, what is in them, and what they are worth when lifted. */
export class Plots {
  private readonly planted = new Map<string, Planting>();
  /**
   * Crops lifted on this page's word but not yet on the world's.
   *
   * Kept with the plots rather than with whoever presses the button, because the answer arrives from
   * the wire long after the field has been walked away from, and this is the thing that still exists
   * when it does.
   */
  readonly claims = new Harvests();
  /** And seeds put in on this page's word, waiting for the same answer from the other direction. */
  readonly sowings = new Sowings();

  constructor(json?: PlotJson) {
    for (const [key, planting] of Object.entries(json ?? {})) {
      if (CROPS[planting.crop]) this.planted.set(key, planting);
    }
  }

  static key(x: number, z: number): string { return `${Math.floor(x)},${Math.floor(z)}`; }

  at(x: number, z: number): Planting | null { return this.planted.get(Plots.key(x, z)) ?? null; }

  get count(): number { return this.planted.size; }

  /** Every planting with its tile, for drawing. */
  entries(): Array<{ x: number; z: number; planting: Planting }> {
    return [...this.planted.entries()].map(([key, planting]) => {
      const [x, z] = key.split(',').map(Number);
      return { x, z, planting };
    });
  }

  /** @param day the world day, fraction and all, so growth starts the moment the seed goes in. */
  plant(x: number, z: number, cropId: string, day: number): boolean {
    const key = Plots.key(x, z);
    if (this.planted.has(key)) return false;
    this.planted.set(key, { crop: cropId, planted: day });
    return true;
  }

  /**
   * Take a plant out of the ground, ripe or not, and say whether one was there.
   *
   * Not a thing the player can do — there is no digging a seed back up in the game. It is the undo
   * for a sowing the world refused: the page put the plant in before it asked, and this is how it
   * comes back out. See `Sowings`.
   */
  clear(x: number, z: number): boolean {
    return this.planted.delete(Plots.key(x, z));
  }

  /** Lift a ripe plant, returning what it yielded. */
  harvest(x: number, z: number, day: number): { crop: Crop; amount: number } | null {
    const key = Plots.key(x, z);
    const planting = this.planted.get(key);
    if (!planting || !isRipe(planting, day)) return null;
    this.planted.delete(key);
    const crop = CROPS[planting.crop];
    return { crop, amount: crop.yield };
  }

  toJSON(): PlotJson {
    return Object.fromEntries(this.planted);
  }
}

/**
 * A crop lifted before the world agreed there was one there.
 *
 * The same bargain a chest makes (`game/opening.ts`), for the same reason: pressing the button on a
 * ripe field should fill the pack now, not after a round trip. What the world settles afterwards is
 * whether anything was sown there, whether it was ripe *by the world's clock* rather than by this
 * page's, and whether somebody else lifted it first — three things a page cannot know on its own in
 * a world with other people in it.
 *
 * A refusal puts the plant back in the ground exactly as it was, which is the honest undo: the tile
 * was never empty, and a page that had simply forgotten the sowing would be a field that vanished.
 */
export interface Lifted {
  tile: string;
  /** What the page thought it lifted, so it can be handed back. */
  crop: string;
  amount: number;
  /** The day it went in, so putting it back does not restart its growing. */
  planted: number;
}

/** What the world said came up. */
export interface Came {
  ok: boolean;
  crop: string;
  amount: number;
}

/** Everything undoing a harvest has to reach. */
export interface PutBackInTheGround {
  /** Crop in or out of the pack, by the sign. */
  carry: (crop: string, by: number) => void;
  /** Put the plant back where it was, still as ripe as it was. */
  resow: (tile: string, crop: string, planted: number) => void;
  flash: (message: string) => void;
}

/** Why the world said no, in the words somebody standing in a field would want. */
export const NOT_YOURS = 'Somebody else had already been through that field.';

export class Harvests {
  /** The keeping and the numbering, which is the same in every one of these. See `claims.ts`. */
  private readonly claims = new Claims<Lifted>();

  /** How many answers are still owed. */
  get pending(): number { return this.claims.pending; }

  ask(lifted: Lifted): number {
    return this.claims.ask(lifted);
  }

  answered(seq: number, told: Came, o: PutBackInTheGround): void {
    const lifted = this.claims.answered(seq);
    if (!lifted) return;

    if (!told.ok) {
      o.carry(lifted.crop, -lifted.amount);
      o.resow(lifted.tile, lifted.crop, lifted.planted);
      o.flash(NOT_YOURS);
      return;
    }
    // the world's numbers win, quietly: nothing the player did was wrong, and a field that says one
    // thing and a pack that says another is worse than a pack that settles
    if (told.crop !== lifted.crop) {
      o.carry(lifted.crop, -lifted.amount);
      o.carry(told.crop, told.amount);
      return;
    }
    if (told.amount !== lifted.amount) o.carry(lifted.crop, told.amount - lifted.amount);
  }
}

/**
 * A seed put in the ground before the world agreed it would take.
 *
 * The other direction of the same bargain, and the shorter one: nothing has to be handed over, so
 * the answer is only yes or no. A refusal lifts the seed back out and puts it in the pack, which is
 * what happens when the ground was not what the page thought it was, when the page's calendar had
 * run ahead of the world's, or when somebody else sowed that tile first.
 */
export interface Put {
  tile: string;
  /** The seed item, so it can go back in the pack — not the crop it would have become. */
  seed: string;
}

/** Everything undoing a sowing has to reach. */
export interface LiftItBackOut {
  /** Take the plant out of the ground again. */
  unplant: (tile: string) => void;
  /** And give the seed back. */
  carry: (seed: string, by: number) => void;
  flash: (message: string) => void;
}

/** Why the world said no, in the words somebody kneeling in a field would want. */
export const WOULD_NOT_TAKE = 'That ground would not take the seed.';

export class Sowings {
  /** The keeping and the numbering, which is the same in every one of these. See `claims.ts`. */
  private readonly claims = new Claims<Put>();

  get pending(): number { return this.claims.pending; }

  ask(put: Put): number {
    return this.claims.ask(put);
  }

  answered(seq: number, ok: boolean, o: LiftItBackOut): void {
    const put = this.claims.answered(seq);
    if (!put) return;
    if (ok) return;
    o.unplant(put.tile);
    o.carry(put.seed, 1);
    o.flash(WOULD_NOT_TAKE);
  }
}