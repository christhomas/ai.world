import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { SEASON_LENGTH, Season, isWet, seasonAffects, seasonOf, seasonProgress, seasonTint } from './seasons';

describe('seasons', () => {
  it('turns with the day counter and wraps into years', () => {
    expect(seasonOf(1)).toBe(Season.Spring);
    expect(seasonOf(SEASON_LENGTH)).toBe(Season.Spring);
    expect(seasonOf(SEASON_LENGTH + 1)).toBe(Season.Summer);
    expect(seasonOf(SEASON_LENGTH * 3 + 1)).toBe(Season.Winter);
    expect(seasonOf(SEASON_LENGTH * 4 + 1)).toBe(Season.Spring);   // next year
    expect(seasonProgress(1, 0)).toBe(0);
    expect(seasonProgress(SEASON_LENGTH, 0.99)).toBeLessThan(1);
    expect(seasonTint(Season.Winter).frost).toBeGreaterThan(0);
    expect(seasonTint(Season.Summer).frost).toBe(0);
    expect(seasonAffects(Biome.Desert)).toBe(false);
    expect(seasonAffects(Biome.Forest)).toBe(true);
  });

  it('weather is deterministic per seed, day and biome, and deserts stay dry', () => {
    for (const day of [1, 5, 12, 30]) {
      expect(isWet(99, day, Biome.Plains)).toBe(isWet(99, day, Biome.Plains));
    }
    let desertWet = 0, swampWet = 0;
    for (let day = 1; day <= 120; day++) {
      if (isWet(7, day, Biome.Desert)) desertWet++;
      if (isWet(7, day, Biome.Swamp)) swampWet++;
    }
    expect(desertWet).toBeLessThan(swampWet);
    expect(desertWet).toBeLessThan(20);
    expect(swampWet).toBeGreaterThan(20);
  });
});
