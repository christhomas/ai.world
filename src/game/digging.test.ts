import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import { Digging, groundOf, richness, seamAt, type Find, type Ground } from './digging';

const meadow: Ground = { biome: Biome.Plains, rise: 0, soft: true };
const hillside: Ground = { biome: Biome.Plains, rise: 4, soft: true };
const highlands: Ground = { biome: Biome.Mountain, rise: 4, soft: true };
const riverbed: Ground = { biome: Biome.Plains, rise: 0, soft: false };

const SIDE = 80;

/** What a square of country gives up, tile by tile: the only honest way to compare two grounds. */
const sweep = (seed: number, ground: Ground, side = SIDE): Map<string, Find> => {
  const found = new Map<string, Find>();
  for (let x = 0; x < side; x++) {
    for (let z = 0; z < side; z++) {
      const under = seamAt(seed, x, z, ground);
      if (under) found.set(`${x},${z}`, under);
    }
  }
  return found;
};

/** The first tile of this country that holds anything, for the tests that need a lucky spot. */
const luckyTile = (seed: number, ground: Ground): [number, number] => {
  for (let x = 0; x < SIDE; x++) {
    for (let z = 0; z < SIDE; z++) if (seamAt(seed, x, z, ground)) return [x, z];
  }
  throw new Error('nothing at all is buried in this country');
};

/** As much of a sampled tile as a digger looks at. */
const tile = (type: TileType, level = 3, base = 1, biome = Biome.Mountain) => ({ type, level, base, biome });

describe('digging for gold and silver', () => {
  it('buries the same metal on the same hillside for every player, for ever', () => {
    const wanderer = sweep(7, highlands);
    expect(wanderer.size).toBeGreaterThan(0);

    // a stranger walks the same square backwards: order of asking must not change the answers
    const stranger = new Map<string, Find>();
    for (let x = SIDE - 1; x >= 0; x--) {
      for (let z = SIDE - 1; z >= 0; z--) {
        const under = seamAt(7, x, z, highlands);
        if (under) stranger.set(`${x},${z}`, under);
      }
    }
    expect(stranger).toEqual(wanderer);

    const [x, z] = luckyTile(7, highlands);
    expect(seamAt(7, x, z, highlands)).toEqual(seamAt(7, x, z, highlands));
  });

  it('buries it somewhere else in the next world along', () => {
    const here = sweep(1, highlands);
    const there = sweep(2, highlands);
    const shared = [...here.keys()].filter((at) => there.has(at));

    expect(here.size).toBeGreaterThan(0);
    expect(there.size).toBeGreaterThan(0);
    // the two worlds may agree about a tile by luck, but never about most of them
    expect(shared.length).toBeLessThan(here.size * 0.75);
  });

  it('never pays anybody for turning over water', () => {
    expect(sweep(3, riverbed).size).toBe(0);
    expect(richness(riverbed)).toBe(0);
    for (const wet of [TileType.Water, TileType.Seabed, TileType.Skip]) {
      expect(groundOf(tile(wet)).soft).toBe(false);
    }
  });

  it('leaves the roads and the floorboards alone', () => {
    for (const hard of [TileType.Road, TileType.Bridge, TileType.Plaza, TileType.Pier, TileType.Floor]) {
      expect(seamAt(4, 12, 34, groundOf(tile(hard)))).toBeNull();
    }
    expect(groundOf(tile(TileType.Ground)).soft).toBe(true);
    expect(groundOf(tile(TileType.High)).soft).toBe(true);
  });

  it('keeps the metal in the highlands rather than the meadows', () => {
    const flat = sweep(11, meadow).size;
    const hills = sweep(11, hillside).size;
    const mountains = sweep(11, highlands).size;

    expect(flat).toBeGreaterThan(0);                 // a meadow is poor, not barren
    expect(hills).toBeGreaterThan(flat * 1.5);       // the same grass, four terraces higher
    expect(mountains).toBeGreaterThan(flat * 4);
    expect(sweep(11, { biome: Biome.Swamp, rise: 0, soft: true }).size).toBeLessThan(flat);
  });

  it('measures a hill by how far the ground stands above the road below it', () => {
    expect(groundOf(tile(TileType.Ground, 6, 2)).rise).toBe(4);
    expect(groundOf(tile(TileType.Ground, 2, 2)).rise).toBe(0);
    // a tile cut below its road by a valley is flat ground, not a hill owed a refund
    expect(groundOf(tile(TileType.Ground, 1, 3)).rise).toBe(0);
    expect(richness({ ...meadow, rise: 5 })).toBeGreaterThan(richness(meadow));
  });

  it('gives up silver often and gold rarely, and never more gold than silver', () => {
    const finds = [...sweep(5, highlands).values()];
    const gold = finds.filter((f) => f.item === 'nugget');
    const silver = finds.filter((f) => f.item === 'silverore');

    expect(gold.length).toBeGreaterThan(0);
    expect(silver.length).toBeGreaterThan(gold.length * 2);
    expect(gold.every((f) => f.count === 1)).toBe(true);       // a nugget is a nugget
    expect(Math.max(...silver.map((f) => f.count))).toBeGreaterThan(1);
  });

  it('lets a tile be dug once, so nobody grows rich standing still', () => {
    const holes = new Digging();
    const [x, z] = luckyTile(9, highlands);

    expect(holes.dig(9, x, z, highlands)).toEqual(seamAt(9, x, z, highlands));
    expect(holes.turned(x, z)).toBe(true);
    for (let again = 0; again < 20; again++) expect(holes.dig(9, x, z, highlands)).toBeNull();

    // and it is that tile that is spent, not the shovel: the next lucky spot still pays
    const elsewhere = [...sweep(9, highlands).keys()].map((at) => at.split(',').map(Number))
      .find(([ax, az]) => ax !== x || az !== z)!;
    expect(holes.dig(9, elsewhere[0], elsewhere[1], highlands)).not.toBeNull();
  });

  it('does not bother remembering the holes that held nothing', () => {
    const holes = new Digging();
    const empty = (): [number, number] => {
      for (let x = 0; x < SIDE; x++) for (let z = 0; z < SIDE; z++) if (!seamAt(9, x, z, meadow)) return [x, z];
      throw new Error('every tile in the meadow holds something');
    };
    const [x, z] = empty();

    expect(holes.dig(9, x, z, meadow)).toBeNull();
    expect(holes.turned(x, z)).toBe(false);   // barren ground rolls barren again, so there is nothing to record
  });
});
