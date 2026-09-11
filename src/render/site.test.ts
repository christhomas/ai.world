import { describe, expect, it } from 'vitest';
import { PropKind } from '../world/biomes';
import { propOf, type Site } from './site';
import { BUILDS } from '../game/building';

/**
 * What stands on a plot, which is the one thing the drawing side of building decides for itself.
 *
 * Everything else about a commission is a subtraction from today done in `building.ts` — how far
 * along, what is owed, how many floors — and handed down. This is the table that turns "a bathing
 * pool, three days in" into a thing with sides, and it was one line long while a house was the only
 * thing anybody could order.
 */
const site = (over: Partial<Site> = {}): Site =>
  ({ id: 'a', x: 0, z: 0, stage: 'house', ...over });

describe('what is standing on a plot', () => {
  it('walks a house through pegs, frame, rafters and a finished cottage', () => {
    expect(propOf(site({ stage: 'pegs' }))).toBe(PropKind.HousePegs);
    expect(propOf(site({ stage: 'frame' }))).toBe(PropKind.HouseFrame);
    expect(propOf(site({ stage: 'roof' }))).toBe(PropKind.HouseRoof);
    expect(propOf(site({ stage: 'house' }))).toBe(PropKind.HouseYours);
  });

  it('reads a plot with nothing written on it as a house', () => {
    // every commission in every save before the catalogue existed, and a house is what they were
    expect(propOf(site({ what: undefined }))).toBe(PropKind.HouseYours);
    expect(propOf(site({ what: 'a summer palace' }))).toBe(PropKind.HouseYours);
  });

  it('draws a house that has had a storey put on it a floor taller', () => {
    expect(propOf(site({ storeys: 2 }))).toBe(PropKind.HouseYoursTwo);
    expect(propOf(site({ storeys: 1 }))).toBe(PropKind.HouseYours);
  });

  it('marks out a pool with pegs and string until the day it is finished', () => {
    for (const stage of ['pegs', 'frame', 'roof'] as const) {
      expect(propOf(site({ what: BUILDS.POOL, stage }))).toBe(PropKind.HousePegs);
    }
    expect(propOf(site({ what: BUILDS.POOL, stage: 'house' }))).toBe(PropKind.Pool);
    expect(propOf(site({ what: BUILDS.FOUNTAIN, stage: 'house' }))).toBe(PropKind.Fountain);
  });

  it('draws nothing at all for a storey, at any stage', () => {
    /*
     * The one that has no site of its own. A storey is not a thing beside a house, it *is* the
     * house — so while it goes up the house looks as it did, and on the last day it is taller.
     * A frame drawn for it would put a timber skeleton inside a finished cottage that a player can
     * walk through, which is a worse lie than nothing.
     */
    for (const stage of ['pegs', 'frame', 'roof', 'house'] as const) {
      expect(propOf(site({ what: BUILDS.STOREY, stage })), `a storey drew something at ${stage}`).toBe(null);
    }
  });
});
