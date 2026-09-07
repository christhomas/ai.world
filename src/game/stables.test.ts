import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { StructureKind, type Structure, type Village } from '../world/structures';
import { TileType } from '../world/terrain';
import { BREEDS, STABLE, bestOver, breedOf, goingOf, paceOf, stableAt, type Going } from './stables';

/** A house, in as much detail as a stable cares about: there is one, and it has a roof. */
const house = (n: number): Structure => ({
  kind: StructureKind.House, tx: n, tz: 0, hw: 1, hd: 1, level: 0, rot: 0, biome: Biome.Plains, path: [],
});

/**
 * A village on paper: a name, a country, however many roofs, and whether one of them is a stable.
 *
 * Which villages keep one is no longer a roll made in this file — it is decided where the village
 * is laid out, and it is a paddock standing in the world. `structures.test.ts` is where that is
 * checked. What is left here is what a stable is once there is one.
 */
const village = (name: string, biome = Biome.Plains, houses = ROOFS, keeps = true): Village => ({
  name, board: null, station: null, x: 0, z: 0, radius: 20, level: 0, biome,
  houses: Array.from({ length: houses }, (_, n) => house(n)),
  shops: [], pub: null, church: null, churchDoor: null, stalls: [],
  stable: keeps
    ? { house: house(0), doorX: 0, doorZ: 2, x: 8, z: 0, half: 3, gate: [5, 0], stock: KEEPS[biome] }
    : null,
});

/** What each country keeps, as the world lays it out. Read here so the two cannot drift apart. */
const KEEPS: Record<Biome, string[]> = {
  [Biome.Plains]: ['horse', 'goat'],
  [Biome.Forest]: ['horse', 'goat'],
  [Biome.Desert]: ['camel', 'horse'],
  [Biome.Swamp]: ['goat', 'horse'],
  [Biome.Mountain]: ['goat', 'horse'],
  [Biome.Snow]: ['goat', 'horse'],
};

/** Roofs enough that a village could keep a stable, which the world decides and this file does not. */
const ROOFS = 5;

/** As much of a sampled tile as a rider looks at. */
const tile = (type: TileType, level = 0, base = 0) => ({ type, level, base });

/** Villages enough to see the shape of a rule that only fires on some of them. */
const many = (count: number, biome = Biome.Plains): Village[] =>
  Array.from({ length: count }, (_, n) => village(`Village ${n}`, biome));

const GOINGS: Going[] = ['road', 'open', 'sand', 'rough'];

describe('the three animals a stable will sell you', () => {
  it('gives the camel the sand and takes the road off it again', () => {
    expect(paceOf(BREEDS.camel, 'sand')).toBeGreaterThan(paceOf(BREEDS.horse, 'sand'));
    expect(paceOf(BREEDS.camel, 'road')).toBeLessThan(paceOf(BREEDS.horse, 'road'));
    expect(bestOver('sand')).toBe(BREEDS.camel);
    expect(bestOver('road')).toBe(BREEDS.horse);
    // and it is not simply the dearer animal winning everywhere it goes
    expect(BREEDS.camel.price).toBeGreaterThan(BREEDS.horse.price);
  });

  it('leaves the broken ground and the heights to the goat', () => {
    expect(bestOver('rough')).toBe(BREEDS.goat);
    expect(paceOf(BREEDS.goat, 'rough')).toBeGreaterThan(paceOf(BREEDS.horse, 'rough'));
    expect(paceOf(BREEDS.goat, 'rough')).toBeGreaterThan(paceOf(BREEDS.camel, 'rough'));
    // the cheapest of the three, and the only one that is never quickest on flat country
    expect(BREEDS.goat.price).toBeLessThan(BREEDS.horse.price);
    for (const going of ['road', 'open', 'sand'] as Going[]) {
      expect(bestOver(going)).not.toBe(BREEDS.goat);
    }
  });

  it('makes every one of them worth the money over your own two feet', () => {
    for (const going of GOINGS) {
      expect(paceOf(null, going)).toBe(STABLE.ON_FOOT);
      for (const breed of Object.values(BREEDS)) {
        expect(paceOf(breed, going)).toBeGreaterThan(STABLE.ON_FOOT);
      }
    }
    // no breed is best everywhere, which is the whole reason there are three of them
    expect(new Set(GOINGS.map((going) => bestOver(going).id)).size).toBeGreaterThan(1);
  });

  it('reads the going off the tile underfoot', () => {
    for (const made of [TileType.Road, TileType.Bridge, TileType.Plaza, TileType.Pier]) {
      expect(goingOf(tile(made))).toBe('road');
    }
    expect(goingOf(tile(TileType.Sand))).toBe('sand');
    expect(goingOf(tile(TileType.High))).toBe('rough');
    expect(goingOf(tile(TileType.Ground))).toBe('open');
    // ordinary grass standing well above its road is a scramble, whatever colour it is
    expect(goingOf(tile(TileType.Ground, STABLE.ROUGH_RISE, 0))).toBe('rough');
    expect(goingOf(tile(TileType.Ground, STABLE.ROUGH_RISE - 1, 0))).toBe('open');
    expect(goingOf(tile(TileType.GroundAlt, 5, 5))).toBe('open');
  });

  it('takes a save that names no animal to have meant a horse', () => {
    expect(breedOf(undefined)).toBe(BREEDS.horse);
    expect(breedOf(null)).toBe(BREEDS.horse);
    expect(breedOf('camel')).toBe(BREEDS.camel);
    expect(breedOf('wyvern')).toBe(BREEDS.horse);
  });
});

describe('what a stable is, once a village has one', () => {
  it('is nothing at all where the village has no paddock', () => {
    expect(stableAt(village('Ashwold', Biome.Plains, ROOFS, false))).toBeNull();
  });

  it('answers the same every time it is asked, because it is reading rather than rolling', () => {
    const home = village('Ashwold', Biome.Mountain);
    const first = stableAt(home);
    for (let asked = 0; asked < 20; asked++) expect(stableAt(home)).toEqual(first);
    // and to anybody else's copy of that village, which is the point of it being a fact and not a roll
    expect(stableAt(village('Ashwold', Biome.Mountain))).toEqual(first);
  });

  it('names the village and the country it stands in', () => {
    const stable = stableAt(village('Ashwold', Biome.Snow))!;
    expect(stable.village).toBe('Ashwold');
    expect(stable.biome).toBe(Biome.Snow);
  });

  it('drops a breed the game does not have rather than selling a hole', () => {
    const odd = village('Ashwold');
    odd.stable!.stock = ['horse', 'wyvern'];
    expect(stableAt(odd)!.stock).toEqual([BREEDS.horse]);
  });

  it('stocks whatever the country round it rides', () => {
    const stabled = (biome: Biome) => {
      const found = many(60, biome).map((v) => stableAt(v)).find((s) => s !== null);
      if (!found) throw new Error('no village in this country keeps a stable');
      return found;
    };

    const desert = stabled(Biome.Desert);
    expect(desert.stock[0]).toBe(BREEDS.camel);
    expect(desert.biome).toBe(Biome.Desert);

    const mountain = stabled(Biome.Mountain);
    expect(mountain.stock[0]).toBe(BREEDS.goat);
    expect(mountain.stock).not.toContain(BREEDS.camel);

    // a camel is a thing you travel for: no meadow village has one standing in the yard
    expect(stabled(Biome.Plains).stock[0]).toBe(BREEDS.horse);
    expect(stabled(Biome.Plains).stock).not.toContain(BREEDS.camel);
    expect(stabled(Biome.Forest).stock).not.toContain(BREEDS.camel);
  });
});
