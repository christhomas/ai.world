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
