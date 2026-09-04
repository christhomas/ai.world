import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { StructureKind, type Structure, type Village } from '../world/structures';
import { TileType } from '../world/terrain';
import { BREEDS, STABLE, bestOver, breedOf, goingOf, paceOf, stableAt, type Going } from './stables';

/** A house, in as much detail as a stable cares about: there is one, and it has a roof. */
const house = (n: number): Structure => ({
  kind: StructureKind.House, tx: n, tz: 0, hw: 1, hd: 1, level: 0, rot: 0, biome: Biome.Plains, path: [],
});

/** A village on paper: a name, a country, and however many roofs the test wants it to have. */
const village = (name: string, biome = Biome.Plains, houses = STABLE.HOUSES): Village => ({
  name, board: null, station: null, x: 0, z: 0, radius: 20, level: 0, biome,
  houses: Array.from({ length: houses }, (_, n) => house(n)),
  shops: [], pub: null, church: null, churchDoor: null, stalls: [],
});

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

describe('which villages keep a stable', () => {
  it('answers the same for the same village in the same world, for ever', () => {
    const home = village('Ashwold', Biome.Mountain);
    const first = stableAt(home, 7);
    for (let asked = 0; asked < 20; asked++) expect(stableAt(home, 7)).toEqual(first);
    // and to anybody else's copy of that village, which is the point of deriving it at all
    expect(stableAt(village('Ashwold', Biome.Mountain), 7)).toEqual(first);
  });

  it('keeps some villages and not others, and shuffles them in the next world along', () => {
    const villages = many(300);
    const here = villages.filter((v) => stableAt(v, 1));
    const there = villages.filter((v) => stableAt(v, 2));

    expect(here.length).toBeGreaterThan(villages.length * 0.35);
    expect(here.length).toBeLessThan(villages.length * 0.75);
    // the two worlds agree about plenty of villages by luck, but never about all of them
    const moved = villages.filter((v) => Boolean(stableAt(v, 1)) !== Boolean(stableAt(v, 2)));
    expect(moved.length).toBeGreaterThan(villages.length * 0.1);
    expect(there.length).toBeGreaterThan(0);
  });

  it('never puts one in a hamlet with nowhere to put the animals', () => {
    for (let houses = 0; houses < STABLE.HOUSES; houses++) {
      const hamlet = many(60).map((v) => ({ ...v, houses: v.houses.slice(0, houses) }));
      expect(hamlet.filter((v) => stableAt(v, 5))).toEqual([]);
    }
    // the same names, big enough, do get stables: it is the size that stopped them and not the roll
    expect(many(60).filter((v) => stableAt(v, 5)).length).toBeGreaterThan(0);
  });

  it('stocks whatever the country round it rides', () => {
    const stabled = (biome: Biome) => {
      const found = many(60, biome).map((v) => stableAt(v, 3)).find((s) => s !== null);
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
