import { describe, expect, it } from 'vitest';
import { KINDS } from '../entities/animals';
import { Biome } from '../world/biomes';
import { CAMP, dangerOf, heartsFrom, huntersOf, nightAt, tilesToVillage, wakes, type Country, type Night } from './camp';
import { ITEMS } from './items';
import { MORNING } from './state';

const wolfWood: Country = { biome: Biome.Snow, toVillage: Infinity };
const bearWood: Country = { biome: Biome.Forest, toVillage: Infinity };
const meadow: Country = { biome: Biome.Plains, toVillage: Infinity };
const beside = (land: Country): Country => ({ ...land, toVillage: 0 });

const SIDE = 60;

/** A season of nights over a square of country: the only honest way to compare two grounds. */
const nights = (seed: number, land: Country, side = SIDE): Night[] => {
  const out: Night[] = [];
  for (let x = 0; x < side; x++) for (let z = 0; z < side; z++) out.push(nightAt(seed, 4, x, z, land));
  return out;
};

const broken = (list: Night[]): Night[] => list.filter((n) => n.visitor !== null);

describe('a night in the open', () => {
  it('goes the same way on the same ground on the same night, for everybody', () => {
    expect(nightAt(11, 6, 40, -12, wolfWood)).toEqual(nightAt(11, 6, 40, -12, wolfWood));

    // a second traveller walks the same square backwards: the order of asking must change nothing
    const forwards: Record<string, string | null> = {};
    for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) forwards[`${x},${z}`] = nightAt(11, 4, x, z, wolfWood).visitor;
    const backwards: Record<string, string | null> = {};
    for (let x = 19; x >= 0; x--) for (let z = 19; z >= 0; z--) backwards[`${x},${z}`] = nightAt(11, 4, x, z, wolfWood).visitor;

    expect(backwards).toEqual(forwards);
    expect(Object.values(forwards).filter(Boolean).length).toBeGreaterThan(0);
  });

  it('is a different night tomorrow, and a different night in the next world along', () => {
    const restless = (seed: number, day: number): Set<string> => {
      const out = new Set<string>();
      for (let x = 0; x < SIDE; x++) for (let z = 0; z < SIDE; z++) {
        if (nightAt(seed, day, x, z, wolfWood).visitor) out.add(`${x},${z}`);
      }
      return out;
    };
    const tonight = restless(11, 4);
    const tomorrow = restless(11, 5);
    const elsewhere = restless(12, 4);

    expect(tonight.size).toBeGreaterThan(0);
    // the same tile may be bad two nights running by luck, but the country cannot repeat itself
    expect([...tonight].filter((at) => tomorrow.has(at)).length).toBeLessThan(tonight.size * 0.6);
    expect([...tonight].filter((at) => elsewhere.has(at)).length).toBeLessThan(tonight.size * 0.6);
  });

  it('is measurably worse in a wolf wood than beside a village', () => {
    const wild = broken(nights(3, wolfWood)).length;
    const sheltered = broken(nights(3, beside(wolfWood))).length;
    const meadowNights = broken(nights(3, meadow)).length;

    expect(wild).toBeGreaterThan(meadowNights * 2);   // the same seed, the same tiles, worse company
    expect(meadowNights).toBeGreaterThan(0);          // sleeping outdoors is never nothing
    expect(sheltered).toBe(0);                        // nothing that hunts alone comes at a street
    expect(dangerOf(beside(wolfWood))).toBe(0);
    expect(dangerOf(wolfWood)).toBeGreaterThan(dangerOf(meadow) * 2);
  });

  it('lets a village lose its hold on the country a walk away from it', () => {
    const near = dangerOf({ ...wolfWood, toVillage: CAMP.LONELY / 4 });
    const far = dangerOf({ ...wolfWood, toVillage: CAMP.LONELY });
    const further = dangerOf({ ...wolfWood, toVillage: CAMP.LONELY * 4 });

    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(further).toBe(far);        // past the last field it is simply open country
    expect(far).toBeLessThanOrEqual(CAMP.WORST);
  });

  it('sends whatever actually lives in that country, and a wolf where nothing does', () => {
    const cameToSnow = new Set(broken(nights(5, wolfWood)).map((n) => n.visitor!));
    const cameToForest = new Set(broken(nights(5, bearWood)).map((n) => n.visitor!));
    const cameToMeadow = new Set(broken(nights(5, meadow)).map((n) => n.visitor!));

    expect(cameToSnow).toEqual(new Set(['wolf']));
    expect(cameToForest).toEqual(new Set(['bear']));
    expect(cameToMeadow).toEqual(new Set([CAMP.STRANGER]));   // nothing hunts the meadow, so it walks in
    for (const country of [Biome.Snow, Biome.Forest, Biome.Mountain]) {
      expect(huntersOf(country).every((s) => (KINDS[s.kind].dangerous ?? 0) > 0)).toBe(true);
    }
    expect(huntersOf(Biome.Plains)).toHaveLength(0);
  });

  it('wakes you on your feet with the thing still coming', () => {
    const bad = broken(nights(3, wolfWood))[0];
    expect(bad.visitor).not.toBeNull();
    expect(bad.slept).toBeLessThan(1);                    // the night was cut short
    expect(bad.away).toBe(CAMP.CLOSE);
    expect(bad.bearing).toBeGreaterThanOrEqual(0);
    expect(bad.bearing).toBeLessThan(Math.PI * 2);
  });
});

describe('what a night under canvas is worth', () => {
  const quiet: Night = { slept: 1, visitor: null, away: 0, bearing: 0 };
  const HEARTS = 10;

  it('mends less than a bed at an inn, and asks nobody for anything', () => {
    expect(heartsFrom(quiet, HEARTS)).toBeGreaterThan(0);
    expect(heartsFrom(quiet, HEARTS)).toBeLessThan(HEARTS);   // a room heals you whole; canvas does not
    expect(ITEMS.room.price).toBeGreaterThan(0);              // and a room costs gold, which this does not
    expect(ITEMS.tent.price).toBeGreaterThan(ITEMS.room.price);  // paid once, for every night after
  });

  it('mends by the hour, so a night that ends in a wolf mends almost nothing', () => {
    const cutShort: Night = { ...quiet, slept: 0.15, visitor: 'wolf' };
    expect(heartsFrom(cutShort, HEARTS)).toBeLessThan(heartsFrom(quiet, HEARTS));
    expect(heartsFrom({ ...quiet, slept: 0 }, HEARTS)).toBe(0);
    expect(heartsFrom(quiet, 20)).toBe(heartsFrom(quiet, 10) * 2);
  });

  it('gets you up at first light, tomorrow', () => {
    const dusk = wakes(quiet, 0.875);
    expect(dusk.time).toBeCloseTo(MORNING, 6);
    expect(dusk.days).toBe(1);                 // lay down before midnight, wake the next day

    const smallHours = wakes(quiet, 0.1);
    expect(smallHours.time).toBeCloseTo(MORNING, 6);
    expect(smallHours.days).toBe(0);           // already past midnight: the date has turned
  });

  it('gets you up in the dark when something came', () => {
    const half = wakes({ ...quiet, slept: 0.5, visitor: 'wolf' }, 0.875);
    expect(half.time).toBeGreaterThan(0);
    expect(half.time).toBeLessThan(MORNING);   // hours of dark still to get through
    expect(half.days).toBe(1);
  });
});

describe('how far the nearest village is', () => {
  const village = { x: 100, z: 0, radius: 20 };

  it('measures to the edge of the place, not to its middle', () => {
    expect(tilesToVillage([village], 130, 0)).toBe(10);
    expect(tilesToVillage([village], 105, 0)).toBe(0);   // standing in it
    expect(tilesToVillage([village], 100, 0)).toBe(0);
  });

  it('takes the nearest one, and gives up where there are none', () => {
    expect(tilesToVillage([village, { x: 0, z: 0, radius: 10 }], 40, 0)).toBe(30);
    expect(tilesToVillage([], 0, 0)).toBe(Infinity);
    expect(dangerOf({ biome: Biome.Snow, toVillage: tilesToVillage([], 0, 0) })).toBeGreaterThan(0);
  });
});
