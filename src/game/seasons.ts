import { Biome } from '../world/biomes';

/**
 * Seasons turn with the day counter. They do not change the terrain, only how it is tinted and
 * how much foliage colour survives, so a world stays the same shape all year.
 */
export const enum Season { Spring = 0, Summer = 1, Autumn = 2, Winter = 3 }

/** Days per season. Four seasons make a year. */
export const SEASON_LENGTH = 7;

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

export function seasonOf(day: number): Season {
  return (Math.floor((day - 1) / SEASON_LENGTH) % 4) as Season;
}

/** How far through the current season we are, 0..1. */
export function seasonProgress(day: number, time: number): number {
  return (((day - 1) % SEASON_LENGTH) + time) / SEASON_LENGTH;
}

export interface SeasonTint {
  /** Multiplied into terrain and prop colours. */
  ground: [number, number, number];
  /** How far the world blends toward snow-white in this season. */
  frost: number;
  /** Multiplied into the sky and sun colours. */
  sky: [number, number, number];
  /** Chance that this biome is rained/snowed on today. */
  wetness: number;
}

const SPRING: SeasonTint = { ground: [0.98, 1.12, 0.9], frost: 0, sky: [1, 1, 1], wetness: 0.35 };
const SUMMER: SeasonTint = { ground: [1.08, 1.0, 0.82], frost: 0, sky: [1.03, 1.0, 0.94], wetness: 0.12 };
const AUTUMN: SeasonTint = { ground: [1.35, 0.82, 0.42], frost: 0, sky: [1.04, 0.94, 0.86], wetness: 0.4 };
const WINTER: SeasonTint = { ground: [0.88, 0.94, 1.06], frost: 0.5, sky: [0.92, 0.96, 1.08], wetness: 0.5 };

const TINTS = [SPRING, SUMMER, AUTUMN, WINTER];

export function seasonTint(season: Season): SeasonTint {
  return TINTS[season];
}

/** Biomes that ignore the season: deserts do not go autumn-gold, snow is already white. */
export function seasonAffects(biome: Biome): boolean {
  return biome !== Biome.Desert && biome !== Biome.Snow;
}

/** Deterministic wet/dry for a given day and biome, so weather is part of the world, not a coin flip. */
export function isWet(seed: number, day: number, biome: Biome): boolean {
  const tint = seasonTint(seasonOf(day));
  let base = tint.wetness;
  if (biome === Biome.Desert) base *= 0.15;
  if (biome === Biome.Swamp) base = Math.min(1, base * 1.6);
  let h = (seed ^ (day * 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 < base;
}
