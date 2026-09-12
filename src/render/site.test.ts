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
 *
 * The tests below are mostly about one rule: on every morning before the last, every kind of job
 * has to show something different from what it showed the morning before. That is the whole of why
 * a building takes days rather than arriving, and for three of the four kinds it was not true —
 * a pool and a fountain wore the house's pegs and string the entire time, and a storey drew
 * nothing at all.
 */
const site = (over: Partial<Site> = {}): Site =>
  ({ id: 'a', x: 0, z: 0, stage: 'done', ...over });

/** The three mornings before the last one: the whole of what waiting is for. */
const WAITING = ['marked', 'begun', 'nearly'] as const;

describe('what is standing on a plot', () => {
  it('walks a house through pegs, frame, rafters and a finished cottage', () => {
    expect(propOf(site({ stage: 'marked' }))).toBe(PropKind.HousePegs);
    expect(propOf(site({ stage: 'begun' }))).toBe(PropKind.HouseFrame);
    expect(propOf(site({ stage: 'nearly' }))).toBe(PropKind.HouseRoof);
    expect(propOf(site({ stage: 'done' }))).toBe(PropKind.HouseYours);
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

  it('digs a pool before it fills it', () => {
    // the order a man with a spade would do it in: string on the grass, a hole, a dry stone tank
    expect(propOf(site({ what: BUILDS.POOL, stage: 'marked' }))).toBe(PropKind.PoolMarked);
    expect(propOf(site({ what: BUILDS.POOL, stage: 'begun' }))).toBe(PropKind.PoolDug);
    expect(propOf(site({ what: BUILDS.POOL, stage: 'nearly' }))).toBe(PropKind.PoolLined);
    expect(propOf(site({ what: BUILDS.POOL, stage: 'done' }))).toBe(PropKind.Pool);
  });

  it('stands a fountain up dry and connects the water last', () => {
    expect(propOf(site({ what: BUILDS.FOUNTAIN, stage: 'marked' }))).toBe(PropKind.FountainMarked);
    expect(propOf(site({ what: BUILDS.FOUNTAIN, stage: 'begun' }))).toBe(PropKind.FountainBasin);
    expect(propOf(site({ what: BUILDS.FOUNTAIN, stage: 'nearly' }))).toBe(PropKind.FountainDry);
    expect(propOf(site({ what: BUILDS.FOUNTAIN, stage: 'done' }))).toBe(PropKind.Fountain);
  });

  it('puts a scaffold round a house having a storey added, and nothing inside it', () => {
    /*
     * The one that has no site of its own. A storey is not a thing beside a house, it *is* the
     * house, and both commissions are drawn on the same tile — so whatever goes here is seen
     * around a cottage that is already standing. A frame would be a timber skeleton inside a room
     * a player can walk into; a scaffold goes round the outside, which is what is actually true,
     * and it comes down on the last morning leaving the house a floor taller.
     */
    expect(propOf(site({ what: BUILDS.STOREY, stage: 'marked' }))).toBe(PropKind.StoreyTimber);
    expect(propOf(site({ what: BUILDS.STOREY, stage: 'begun' }))).toBe(PropKind.StoreyScaffold);
    expect(propOf(site({ what: BUILDS.STOREY, stage: 'nearly' }))).toBe(PropKind.StoreyRaised);
  });

  it('draws nothing for a finished storey, because the house itself is what changed', () => {
    expect(propOf(site({ what: BUILDS.STOREY, stage: 'done' }))).toBe(null);
  });

  it('shows something different every morning, for every kind a builder takes on', () => {
    for (const what of [BUILDS.HOUSE, BUILDS.STOREY, BUILDS.POOL, BUILDS.FOUNTAIN]) {
      const seen = WAITING.map((stage) => propOf(site({ what, stage })));
      expect(new Set(seen).size, `a ${what} looks the same on two of the mornings you wait`)
        .toBe(WAITING.length);
      for (const kind of seen) {
        expect(kind, `a ${what} has a morning with nothing to see on it`).not.toBe(null);
      }
    }
  });

  it('has a shape for everything the table names', async () => {
    // the table is written by hand and the prop library is what can actually be drawn, so a stage
    // named here and modelled nowhere would be an empty plot rather than a failing anything
    const { PROPS } = await import('../entities/props');
    const missing: string[] = [];
    for (const what of [BUILDS.HOUSE, BUILDS.STOREY, BUILDS.POOL, BUILDS.FOUNTAIN]) {
      for (const stage of [...WAITING, 'done'] as const) {
        const kind = propOf(site({ what, stage }));
        if (kind !== null && !PROPS.has(kind)) missing.push(`${what} at ${stage}`);
      }
    }
    expect(missing, 'named in the table and modelled nowhere').toEqual([]);
  });
});
