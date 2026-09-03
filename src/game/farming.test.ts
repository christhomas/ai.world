import { describe, expect, it } from 'vitest';
import { Season } from './seasons';
import { CROPS, Plots, SEED_TO_CROP, canPlant, daysUntilSeason, isRipe, ripeness } from './farming';
import { ITEMS } from './items';

describe('farming', () => {
  it('grows from seed to harvest over the days it says', () => {
    const plots = new Plots();
    expect(plots.plant(4, 9, 'wheat', 10)).toBe(true);
    expect(plots.plant(4, 9, 'turnip', 10)).toBe(false);   // the square is taken
    const planting = plots.at(4, 9)!;
    expect(ripeness(planting, 10)).toBe(0);
    expect(ripeness(planting, 11.5)).toBeCloseTo(0.5);
    expect(isRipe(planting, 12)).toBe(false);
    expect(isRipe(planting, 13)).toBe(true);
    expect(plots.harvest(4, 9, 11)).toBeNull();            // not yet
    const lifted = plots.harvest(4, 9, 13)!;
    expect(lifted.crop.id).toBe('wheat');
    expect(lifted.amount).toBe(CROPS.wheat.yield);
    expect(plots.at(4, 9)).toBeNull();                     // the square is free again
  });

  it('respects the season, and says how long until the right one', () => {
    // day 1 is spring, day 8 summer, day 15 autumn, day 22 winter
    expect(canPlant(CROPS.wheat, 1)).toBe(true);
    expect(canPlant(CROPS.pumpkin, 1)).toBe(false);
    expect(canPlant(CROPS.pumpkin, 8)).toBe(true);
    expect(canPlant(CROPS.turnip, 22)).toBe(false);
    expect(daysUntilSeason(CROPS.pumpkin, 1)).toBeGreaterThan(0);
    expect(canPlant(CROPS.pumpkin, 1 + daysUntilSeason(CROPS.pumpkin, 1))).toBe(true);
    expect(CROPS.turnip.seasons).toContain(Season.Autumn);
  });

  it('round-trips through the save and drops crops it no longer knows', () => {
    const plots = new Plots();
    plots.plant(1, 1, 'turnip', 3);
    plots.plant(2, 2, 'pumpkin', 4);
    const back = new Plots(JSON.parse(JSON.stringify(plots.toJSON())));
    expect(back.count).toBe(2);
    expect(back.at(2, 2)!.crop).toBe('pumpkin');
    const patched = new Plots({ '9,9': { crop: 'moonfruit', planted: 1 } });
    expect(patched.count).toBe(0);
  });

  it('every crop has a seed and a harvest the shops can trade', () => {
    for (const crop of Object.values(CROPS)) {
      expect(ITEMS[crop.seedId].price).toBe(crop.seedPrice);
      expect(ITEMS[crop.id].price).toBeGreaterThan(crop.seedPrice);
      expect(SEED_TO_CROP[crop.seedId].id).toBe(crop.id);
    }
  });
});
