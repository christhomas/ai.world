import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { SEASON_LENGTH, SEASON_SNOW, Season, isWet, seasonAffects, seasonLook, seasonOf, seasonTint } from './seasons';

describe('seasons', () => {
  it('turns with the day counter and wraps into years', () => {
    expect(seasonOf(1)).toBe(Season.Spring);
    expect(seasonOf(SEASON_LENGTH)).toBe(Season.Spring);
    expect(seasonOf(SEASON_LENGTH + 1)).toBe(Season.Summer);
    expect(seasonOf(SEASON_LENGTH * 3 + 1)).toBe(Season.Winter);
    expect(seasonOf(SEASON_LENGTH * 4 + 1)).toBe(Season.Spring);   // next year
    expect(seasonTint(Season.Winter).frost).toBeGreaterThan(0);
    expect(seasonTint(Season.Summer).frost).toBe(0);
    expect(seasonAffects(Biome.Desert)).toBe(false);
    expect(seasonAffects(Biome.Forest)).toBe(true);
  });

  it('says how the season looks as a plain intent a frame can carry, and nothing where it does not reach', () => {
    const autumn = seasonLook(Season.Autumn, Biome.Forest);
    expect(autumn).toEqual({ multiply: [1.35, 0.82, 0.42], frost: 0, snow: SEASON_SNOW });
    const winter = seasonLook(Season.Winter, Biome.Plains);
    expect(winter).toEqual({ multiply: [0.88, 0.94, 1.06], frost: 0.5, snow: SEASON_SNOW });
    // summer has warmth and no frost; the untinted world is the desert's and the snowfield's
    expect(seasonLook(Season.Summer, Biome.Plains)?.frost).toBe(0);
    expect(seasonLook(Season.Autumn, Biome.Desert)).toBeNull();
    expect(seasonLook(Season.Winter, Biome.Snow)).toBeNull();
    // a copy, so a frame that is written to cannot repaint every autumn after it
    expect(autumn?.multiply).not.toBe(seasonTint(Season.Autumn).ground);
    expect(JSON.parse(JSON.stringify(winter))).toEqual(winter);
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
