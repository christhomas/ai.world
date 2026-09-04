import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { TileType } from '../world/terrain';
import { ITEMS } from './items';
import { GameState } from './state';
import {
  BREW, Picking, RECIPE, RECIPES, brew, canBrew, herbAt, missing, patchOf, plenty, type Patch,
} from './brewing';

const meadow: Patch = { biome: Biome.Plains, damp: false, rooted: true };
const bank: Patch = { biome: Biome.Plains, damp: true, rooted: true };
const wood: Patch = { biome: Biome.Forest, damp: false, rooted: true };
const marsh: Patch = { biome: Biome.Swamp, damp: true, rooted: true };
const dunes: Patch = { biome: Biome.Desert, damp: false, rooted: true };
const scree: Patch = { biome: Biome.Mountain, damp: false, rooted: true };
const cobbles: Patch = { biome: Biome.Plains, damp: false, rooted: false };

const SIDE = 80;

/** Every leaf in a square of country, tile by tile: the only honest way to compare two grounds. */
const sweep = (seed: number, patch: Patch, side = SIDE): Map<string, number> => {
  const growing = new Map<string, number>();
  for (let x = 0; x < side; x++) {
    for (let z = 0; z < side; z++) {
      const leaves = herbAt(seed, x, z, patch);
      if (leaves > 0) growing.set(`${x},${z}`, leaves);
    }
  }
  return growing;
};

/** The first tile of this country with something growing on it. */
const green = (seed: number, patch: Patch): [number, number] => {
  for (let x = 0; x < SIDE; x++) {
    for (let z = 0; z < SIDE; z++) if (herbAt(seed, x, z, patch) > 0) return [x, z];
  }
  throw new Error('nothing at all grows in this country');
};

/** As much of a sampled tile as somebody looking for a leaf reads. */
const tile = (type: TileType, bank = false, biome = Biome.Forest) => ({ type, bank, biome });

/** A rucksack with the given things already in it. */
const carrying = (things: Record<string, number>): GameState => {
  const pack = new GameState();
  for (const [id, n] of Object.entries(things)) pack.give(id, n);
  return pack;
};

describe('where herbs grow', () => {
  it('grows the same leaf on the same bank for every player, for ever', () => {
    const wanderer = sweep(7, bank);
    expect(wanderer.size).toBeGreaterThan(0);

    // a stranger walks the same square backwards: the order of asking must not change the answers
    const stranger = new Map<string, number>();
    for (let x = SIDE - 1; x >= 0; x--) {
      for (let z = SIDE - 1; z >= 0; z--) {
        const leaves = herbAt(7, x, z, bank);
        if (leaves > 0) stranger.set(`${x},${z}`, leaves);
      }
    }
    expect(stranger).toEqual(wanderer);

    const [x, z] = green(7, bank);
    expect(herbAt(7, x, z, bank)).toBe(herbAt(7, x, z, bank));
  });

  it('grows it somewhere else entirely in the next world along', () => {
    const here = sweep(1, wood);
    const there = sweep(2, wood);
    const shared = [...here.keys()].filter((at) => there.has(at));

    expect(here.size).toBeGreaterThan(0);
    expect(there.size).toBeGreaterThan(0);
    // two worlds may agree about a tile by luck, but never about most of them
    expect(shared.length).toBeLessThan(here.size * 0.75);
  });

  it('is generous on damp ground and under trees, and mean in the dunes and on the rock', () => {
    const grass = sweep(11, meadow).size;

    expect(grass).toBeGreaterThan(0);                        // a meadow is poor, not barren
    expect(sweep(11, bank).size).toBeGreaterThan(grass * 1.5);
    expect(sweep(11, wood).size).toBeGreaterThan(grass * 1.5);
    expect(sweep(11, marsh).size).toBeGreaterThan(grass * 3);
    expect(sweep(11, dunes).size).toBeLessThan(grass * 0.25);
    expect(sweep(11, scree).size).toBeLessThan(grass * 0.35);
    // and the meanest ground of all still beats the ground that grows nothing whatsoever
    expect(sweep(11, dunes).size).toBeGreaterThan(0);
  });

  it('grows nothing on a road, a deck, a floor or open water', () => {
    expect(sweep(3, cobbles).size).toBe(0);
    expect(plenty(cobbles)).toBe(0);
    for (const bare of [TileType.Road, TileType.Bridge, TileType.Plaza, TileType.Pier, TileType.Floor, TileType.Water, TileType.Seabed, TileType.Skip]) {
      expect(patchOf(tile(bare)).rooted).toBe(false);
      expect(herbAt(3, 12, 34, patchOf(tile(bare)))).toBe(0);
    }
    // nor on the bare rock of a summit, whatever the country around it is like
    expect(patchOf(tile(TileType.High)).rooted).toBe(false);
    expect(patchOf(tile(TileType.Ground)).rooted).toBe(true);
    expect(patchOf(tile(TileType.Sand)).rooted).toBe(true);
  });

  it('reads a river bank off the tile, because damp is most of why a leaf is there', () => {
    expect(patchOf(tile(TileType.Ground, true)).damp).toBe(true);
    expect(patchOf(tile(TileType.Ground, false)).damp).toBe(false);
    expect(plenty(bank)).toBeGreaterThan(plenty(meadow));
  });

  it('gives a handful off some patches and a single leaf off most', () => {
    const leaves = [...sweep(5, marsh).values()];
    const handfuls = leaves.filter((n) => n === 2);

    expect(handfuls.length).toBeGreaterThan(0);
    expect(leaves.filter((n) => n === 1).length).toBeGreaterThan(handfuls.length);
    expect(Math.max(...leaves)).toBe(2);      // nobody strips a bush in one go
  });
});

describe('what a mortar makes of it', () => {
  it('only ever makes things the game actually has, out of things it actually has', () => {
    for (const recipe of RECIPES) {
      expect(ITEMS[recipe.makes], `${recipe.id} makes ${recipe.makes}`).toBeDefined();
      for (const id of Object.keys(recipe.needs)) expect(ITEMS[id], `${recipe.id} needs ${id}`).toBeDefined();
      expect(RECIPE[recipe.id]).toBe(recipe);
    }
  });

  it('grinds a salve out of two leaves, and leaves the rucksack the lighter for it', () => {
    const pack = carrying({ herb: 3 });

    expect(canBrew(RECIPE.salve, pack)).toBe(true);
    expect(brew(RECIPE.salve, pack)).toBe(true);
    expect(pack.count('salve')).toBe(1);
    expect(pack.count('herb')).toBe(1);       // it takes what it asks for and no more
  });

  it('wants everything a recipe asks for, not merely most of it', () => {
    const short = carrying({ herb: 9 });

    expect(canBrew(RECIPE.ward, short)).toBe(false);
    expect(missing(RECIPE.ward, short)).toEqual([{ id: 'silverore', short: 1 }]);
    expect(brew(RECIPE.ward, short)).toBe(false);
    // and a refusal costs nothing: the leaves you were saving are still there
    expect(short.count('herb')).toBe(9);
    expect(short.count('ward')).toBe(0);
  });

  it('names both the things you are short of when you are short of both', () => {
    expect(missing(RECIPE.ward, new GameState())).toEqual([
      { id: 'herb', short: 4 },
      { id: 'silverore', short: 1 },
    ]);
    expect(missing(RECIPE.salve, carrying({ herb: 2 }))).toEqual([]);
  });

  it('asks more for a warding draught than for a salve, because it is worth more', () => {
    const ward = RECIPE.ward.needs;
    const salve = RECIPE.salve.needs;

    expect(ward.herb).toBeGreaterThan(salve.herb);
    expect(Object.keys(ward).length).toBeGreaterThan(Object.keys(salve).length);
    const rich = carrying({ herb: 4, silverore: 1 });
    expect(brew(RECIPE.ward, rich)).toBe(true);
    expect(rich.count('ward')).toBe(1);
    expect(rich.count('herb')).toBe(0);
    expect(rich.count('silverore')).toBe(0);
  });
});

describe('picking what grows', () => {
  it('leaves a picked patch bare for a few days, and then lets it come back', () => {
    const picking = new Picking();
    const [x, z] = green(9, marsh);

    expect(picking.pick(9, x, z, marsh, 4)).toBe(herbAt(9, x, z, marsh));
    expect(picking.bare(x, z, 4)).toBe(true);
    expect(picking.pick(9, x, z, marsh, 4)).toBe(0);
    expect(picking.pick(9, x, z, marsh, 4 + BREW.REGROW - 0.5)).toBe(0);

    expect(picking.bare(x, z, 4 + BREW.REGROW)).toBe(false);
    expect(picking.pick(9, x, z, marsh, 4 + BREW.REGROW)).toBeGreaterThan(0);
  });

  it('spends the patch and not the picker: the next one along still pays', () => {
    const picking = new Picking();
    const [x, z] = green(9, marsh);
    picking.pick(9, x, z, marsh, 1);

    const elsewhere = [...sweep(9, marsh).keys()]
      .map((at) => at.split(',').map(Number))
      .find(([ax, az]) => ax !== x || az !== z)!;
    expect(picking.pick(9, elsewhere[0], elsewhere[1], marsh, 1)).toBeGreaterThan(0);
  });

  it('does not bother remembering the ground that had nothing on it', () => {
    const picking = new Picking();
    const empty = (): [number, number] => {
      for (let x = 0; x < SIDE; x++) for (let z = 0; z < SIDE; z++) if (herbAt(9, x, z, meadow) === 0) return [x, z];
      throw new Error('every tile in the meadow is growing something');
    };
    const [x, z] = empty();

    expect(picking.pick(9, x, z, meadow, 1)).toBe(0);
    expect(picking.bare(x, z, 1)).toBe(false);   // barren rolls barren again, so there is nothing to record
  });

  it('fills a rucksack from a good bank in one walk, which is the whole point of a good bank', () => {
    const picking = new Picking();
    let leaves = 0;
    for (const at of sweep(13, marsh, 20).keys()) {
      const [x, z] = at.split(',').map(Number);
      leaves += picking.pick(13, x, z, marsh, 2);
    }
    expect(leaves).toBeGreaterThanOrEqual(RECIPE.ward.needs.herb);
  });
});
