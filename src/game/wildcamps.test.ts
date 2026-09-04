import { describe, expect, it } from 'vitest';
import { TRADES } from '../entities/trades';
import { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import { CAMP, type Country } from './camp';
import { ITEMS } from './items';
import {
  CAMPS, campAt, campsIn, clearingOf, comfort, nearestCamp, ruinChanceOf, takingFrom,
  type Clearing, type WildCamp,
} from './wildcamps';

/** Roadside ground a day's walk from anywhere: the country most of a world is made of. */
const roadside = (over: Partial<Clearing> = {}): Clearing => ({
  biome: Biome.Plains, rise: 0, offRoad: 5, toVillage: Infinity, pegged: true, ...over,
});

const wolfWood = roadside({ biome: Biome.Snow });
const wood = roadside({ biome: Biome.Forest });
const meadow = roadside();

/** Big enough that a country holding one camp in a thousand tiles still holds a hundred of them. */
const SIDE = 360;

/** Every camp in a square of one country, which is the only honest way to compare two countries. */
const sweep = (seed: number, clearing: Clearing, side = SIDE): WildCamp[] => {
  const pitched: WildCamp[] = [];
  for (let x = 0; x < side; x++) {
    for (let z = 0; z < side; z++) {
      const camp = campAt(seed, x, z, clearing);
      if (camp) pitched.push(camp);
    }
  }
  return pitched;
};

const torn = (camps: WildCamp[]): number => camps.filter((c) => c.ruined).length / camps.length;

/** As much of a sampled tile as somebody looking for a pitch reads. */
const tile = (type: TileType, over: Partial<{ level: number; base: number; roadDist: number; roadWidth: number }> = {}) =>
  ({ type, biome: Biome.Plains, level: 2, base: 2, roadDist: 8, roadWidth: 3, ...over });

describe('camps out in the country', () => {
  it('pitches the same camp in the same clearing for every player, for ever', () => {
    const wanderer = sweep(7, wood);
    expect(wanderer.length).toBeGreaterThan(0);

    // a stranger walks the same square backwards: the order of asking must not change the answers
    const stranger: WildCamp[] = [];
    for (let x = SIDE - 1; x >= 0; x--) {
      for (let z = SIDE - 1; z >= 0; z--) {
        const camp = campAt(7, x, z, wood);
        if (camp) stranger.push(camp);
      }
    }
    expect(new Map(stranger.map((c) => [c.id, c]))).toEqual(new Map(wanderer.map((c) => [c.id, c])));

    const one = wanderer[0];
    const [x, z] = one.id.slice('camp:'.length).split(',').map(Number);
    expect(campAt(7, x, z, wood)).toEqual(one);            // whose it is, and what is in it, and all
  });

  it('pitches somewhere else entirely in the next world along', () => {
    const here = new Set(sweep(1, wood).map((c) => c.id));
    const there = new Set(sweep(2, wood).map((c) => c.id));

    expect(here.size).toBeGreaterThan(0);
    expect(there.size).toBeGreaterThan(0);
    // two worlds may agree about a clearing by luck, but never about most of them
    expect([...here].filter((id) => there.has(id)).length).toBeLessThan(here.size * 0.25);
  });

  it('never pitches in the water, on the road, or inside a village', () => {
    for (const wet of [TileType.Water, TileType.Seabed, TileType.Skip, TileType.High]) {
      expect(clearingOf(tile(wet), Infinity).pegged).toBe(false);
      expect(sweep(3, roadside({ pegged: false }), 40)).toHaveLength(0);
    }
    for (const made of [TileType.Road, TileType.Bridge, TileType.Plaza, TileType.Pier, TileType.Floor]) {
      expect(campAt(3, 12, 34, clearingOf(tile(made), Infinity))).toBeNull();
    }
    expect(clearingOf(tile(TileType.Ground), Infinity).pegged).toBe(true);
    expect(clearingOf(tile(TileType.Sand), Infinity).pegged).toBe(true);

    // in the ruts, and out past the last place anybody walks: nobody pitches in either
    expect(comfort(roadside({ offRoad: 0 }))).toBe(0);
    expect(comfort(roadside({ offRoad: CAMPS.OFF_ROAD - 0.01 }))).toBe(0);
    expect(comfort(roadside({ offRoad: CAMPS.WITHIN + 1 }))).toBe(0);
    expect(comfort(roadside({ offRoad: Infinity }))).toBe(0);
    expect(sweep(3, roadside({ offRoad: 0 }), 60)).toHaveLength(0);

    // and never in somebody's village, however kind the ground there looks
    for (const near of [0, CAMPS.APART / 2, CAMPS.APART - 0.01]) {
      expect(comfort(roadside({ toVillage: near }))).toBe(0);
      expect(sweep(3, roadside({ toVillage: near }), 60)).toHaveLength(0);
    }
    expect(comfort(roadside({ toVillage: CAMPS.APART }))).toBeGreaterThan(0);
  });

  it('reads a tile the way somebody looking for somewhere to sleep reads it', () => {
    expect(clearingOf(tile(TileType.Ground, { level: 6, base: 2 }), 30).rise).toBe(4);
    // a tile cut below its road by a valley is flat ground, not a hill owed a refund
    expect(clearingOf(tile(TileType.Ground, { level: 1, base: 3 }), 30).rise).toBe(0);
    expect(clearingOf(tile(TileType.Ground, { roadDist: 9, roadWidth: 3 }), 30).offRoad).toBe(6);
    expect(clearingOf(tile(TileType.Ground, { roadDist: 1, roadWidth: 3 }), 30).offRoad).toBe(0);
    expect(clearingOf(tile(TileType.Ground, { roadDist: Infinity, roadWidth: 0 }), 30).offRoad).toBe(Infinity);
    expect(clearingOf(tile(TileType.Ground), 12).toVillage).toBe(12);
  });

  it('keeps to the sheltered country and off the windy ridges', () => {
    const inTheWood = sweep(11, wood).length;
    const inTheOpen = sweep(11, meadow).length;
    const inTheMarsh = sweep(11, roadside({ biome: Biome.Swamp })).length;
    const onARidge = sweep(11, roadside({ rise: 4 })).length;

    expect(inTheOpen).toBeGreaterThan(0);                  // a meadow is plain, not forbidden
    expect(inTheWood).toBeGreaterThan(inTheOpen * 1.4);    // the wood breaks the wind and hides the fire
    expect(inTheMarsh).toBeLessThan(inTheOpen * 0.5);      // there is nowhere dry to lie down in a marsh
    expect(onARidge).toBeLessThan(inTheOpen * 0.6);
    expect(comfort(roadside({ rise: 8 }))).toBeLessThan(comfort(meadow));
    // and camps stay rare enough to be worth walking to when you see one
    expect(inTheWood).toBeLessThan(SIDE * SIDE * CAMPS.MOST);
  });

  it('is the camp in the wolf wood that you find torn open', () => {
    const inWolfCountry = sweep(5, wolfWood);
    const onThePlains = sweep(5, meadow);

    expect(inWolfCountry.length).toBeGreaterThan(50);      // a sample worth drawing a conclusion from
    expect(onThePlains.length).toBeGreaterThan(50);
    expect(torn(inWolfCountry)).toBeGreaterThan(torn(onThePlains) * 3);
    expect(torn(onThePlains)).toBeGreaterThan(0);          // sleeping outdoors is never nothing
    expect(torn(inWolfCountry)).toBeLessThan(1);           // and never certain either

    const country = (biome: Biome): Country => ({ biome, toVillage: Infinity });
    expect(ruinChanceOf(country(Biome.Snow))).toBeGreaterThan(ruinChanceOf(country(Biome.Plains)) * 3);
    expect(ruinChanceOf(country(Biome.Forest))).toBeGreaterThan(ruinChanceOf(country(Biome.Plains)));
    // the same wolf country in the last fields before a village, where the lamps still reach
    const inSightOfHome = sweep(5, roadside({ biome: Biome.Snow, toVillage: CAMPS.APART }));
    expect(inSightOfHome.length).toBeGreaterThan(50);
    expect(torn(inSightOfHome)).toBeLessThan(torn(inWolfCountry) / 2);
    expect(ruinChanceOf({ biome: Biome.Snow, toVillage: 0 })).toBe(0);
    expect(ruinChanceOf({ biome: Biome.Snow, toVillage: CAMP.LONELY })).toBeGreaterThan(0);
  });

  it('leaves everything a camp had, whether or not its owner is coming back', () => {
    const camps = sweep(13, wood);
    expect(camps.length).toBeGreaterThan(50);
    expect(camps.some((c) => c.ruined)).toBe(true);
    expect(camps.some((c) => !c.ruined)).toBe(true);

    for (const camp of camps) {
      expect(camp.items.length).toBeGreaterThan(0);        // the tool of the trade is always there
      expect(camp.gold).toBeGreaterThanOrEqual(CAMPS.PURSE_LEAST);
      expect(camp.gold).toBeLessThan(CAMPS.PURSE_LEAST + CAMPS.PURSE);
    }
    // and now and then, the thing they came all this way out here to find
    expect(camps.some((c) => c.items.length > 2)).toBe(true);
  });

  it('leaves only things the game actually has, belonging to people it could have made', () => {
    const camps = sweep(13, wood);
    const tradeIds = new Set(TRADES.map((t) => t.id));

    for (const camp of camps) {
      for (const id of camp.items) expect(ITEMS[id], `${id} is not an item`).toBeDefined();
      expect(tradeIds.has(camp.trade), `${camp.trade} is nobody's trade`).toBe(true);
      expect(camp.who).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
    // the names come off the same two lists a village founds its families from, and no other
    expect(new Set(camps.map((c) => c.who.split(' ')[0])).size).toBeLessThanOrEqual(20);
    expect(new Set(camps.map((c) => c.who.split(' ')[1])).size).toBeLessThanOrEqual(24);
    expect(new Set(camps.map((c) => c.trade)).size).toBeGreaterThan(1);
  });

  it('makes going through a camp somebody is still using theft, and says so', () => {
    const camps = sweep(13, wolfWood);
    const standing = camps.filter((c) => !c.ruined);
    const wrecked = camps.filter((c) => c.ruined);

    expect(standing.length).toBeGreaterThan(0);
    expect(wrecked.length).toBeGreaterThan(0);
    for (const camp of standing) {
      expect(takingFrom(camp)).toBe('theft');
      expect(camp.items.length).toBeGreaterThan(0);        // there is something to take: that is the point
    }
    for (const camp of wrecked) expect(takingFrom(camp)).toBe('salvage');
  });

  it('finds the camps on a square of ground, and the one you are standing in', () => {
    const found = campsIn(21, 0, 0, 199, 199, () => wood);
    const byHand = sweep(21, wood, 200);
    expect(found).toEqual(byHand);
    expect(found.length).toBeGreaterThan(0);
    expect(campsIn(21, 0, 0, 199, 199, () => roadside({ pegged: false }))).toHaveLength(0);

    const camp = found[0];
    expect(nearestCamp(found, camp.x, camp.z)).toBe(camp);
    expect(nearestCamp(found, camp.x + CAMPS.REACH - 0.1, camp.z)).toBe(camp);
    expect(nearestCamp(found, camp.x + CAMPS.REACH + 0.1, camp.z)).toBeNull();
    expect(nearestCamp([], 0, 0)).toBeNull();
  });
});
