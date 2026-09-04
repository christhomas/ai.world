import { describe, expect, it } from 'vitest';
import { Biome, PropKind } from '../world/biomes';
import { TileType } from '../world/terrain';
import { ITEMS } from './items';
import {
  Felling, Fire, WOOD, cartBuilt, fellingAt, haulPace, standOf, timberAt, treeName, woodWanted,
  type Cut, type Stand,
} from './woodcraft';

const wood: Stand = { biome: Biome.Forest, rooted: true };
const meadow: Stand = { biome: Biome.Plains, rooted: true };
const dunes: Stand = { biome: Biome.Desert, rooted: true };
const marsh: Stand = { biome: Biome.Swamp, rooted: true };
const riverbank: Stand = { biome: Biome.Forest, rooted: false };

const SIDE = 80;

/** What a square of country gives a feller, tile by tile: the only honest way to compare two woods. */
const sweep = (seed: number, stand: Stand, side = SIDE): Map<string, Cut> => {
  const cut = new Map<string, Cut>();
  for (let x = 0; x < side; x++) {
    for (let z = 0; z < side; z++) {
      const timber = fellingAt(seed, x, z, stand);
      if (timber) cut.set(`${x},${z}`, timber);
    }
  }
  return cut;
};

/** The first tile of this country with a tree on it worth felling. */
const treeTile = (seed: number, stand: Stand): [number, number] => {
  for (let x = 0; x < SIDE; x++) {
    for (let z = 0; z < SIDE; z++) if (fellingAt(seed, x, z, stand)) return [x, z];
  }
  throw new Error('not one tree in the whole wood');
};

/** As much of a sampled tile as somebody carrying a saw looks at. */
const tile = (type: TileType, biome = Biome.Forest, bank = false, roadDist = 40, roadWidth = 3) =>
  ({ type, biome, bank, roadDist, roadWidth });

describe('felling a wood', () => {
  it('stands the same tree on the same tile for every player, for ever', () => {
    const feller = sweep(7, wood);
    expect(feller.size).toBeGreaterThan(0);

    // a stranger walks the same square backwards: the order of asking must not change the answers
    const stranger = new Map<string, Cut>();
    for (let x = SIDE - 1; x >= 0; x--) {
      for (let z = SIDE - 1; z >= 0; z--) {
        const timber = fellingAt(7, x, z, wood);
        if (timber) stranger.set(`${x},${z}`, timber);
      }
    }
    expect(stranger).toEqual(feller);

    const [x, z] = treeTile(7, wood);
    expect(fellingAt(7, x, z, wood)).toEqual(fellingAt(7, x, z, wood));
    expect(timberAt(7, x, z, wood)).toBe(timberAt(7, x, z, wood));
  });

  it('grows the wood somewhere else in the next world along', () => {
    const here = sweep(1, wood);
    const there = sweep(2, wood);
    const shared = [...here.keys()].filter((at) => there.has(at));

    expect(here.size).toBeGreaterThan(0);
    expect(there.size).toBeGreaterThan(0);
    expect(shared.length).toBeLessThan(here.size * 0.6);
  });

  it('gives a saw nothing at all to do in the desert', () => {
    for (const seed of [1, 2, 3]) expect(sweep(seed, dunes).size).toBe(0);
    // the dunes are not empty, they are simply full of the wrong trees
    for (let x = 0; x < SIDE; x++) {
      for (let z = 0; z < SIDE; z++) expect(timberAt(3, x, z, dunes)).toBe(PropKind.None);
    }
    // and every other country does grow something
    for (const country of [wood, meadow, marsh, { biome: Biome.Snow, rooted: true }, { biome: Biome.Mountain, rooted: true }]) {
      expect(sweep(3, country).size).toBeGreaterThan(0);
    }
  });

  it('puts more timber in a wood than in a meadow', () => {
    expect(sweep(11, wood).size).toBeGreaterThan(sweep(11, meadow).size * 4);
    expect(sweep(11, meadow).size).toBeGreaterThan(0);   // a meadow has its oaks, just not many
  });

  it('grows nothing on the road, the riverbank, the sand or the bare rock', () => {
    expect(sweep(4, riverbank).size).toBe(0);

    expect(standOf(tile(TileType.Ground)).rooted).toBe(true);
    expect(standOf(tile(TileType.GroundAlt)).rooted).toBe(true);
    for (const bare of [TileType.Road, TileType.Bridge, TileType.Plaza, TileType.High, TileType.Sand, TileType.Water, TileType.Floor]) {
      expect(standOf(tile(bare)).rooted).toBe(false);
    }
    // a bank has reeds and willows of its own, and the verge belongs to the road
    expect(standOf(tile(TileType.Ground, Biome.Forest, true)).rooted).toBe(false);
    expect(standOf(tile(TileType.Ground, Biome.Forest, false, 3.5, 3)).rooted).toBe(false);
    expect(standOf(tile(TileType.Ground, Biome.Forest, false, 4.5, 3)).rooted).toBe(true);
  });

  it('names the tree that fell, and makes one to three logs of it', () => {
    const cuts = [...sweep(5, wood).values()];
    expect(cuts.every((c) => c.item === 'wood')).toBe(true);
    expect(Math.min(...cuts.map((c) => c.count))).toBe(1);
    expect(Math.max(...cuts.map((c) => c.count))).toBe(WOOD.LOGS);

    const named = new Set([...Array(SIDE).keys()].flatMap((x) => [...Array(SIDE).keys()]
      .map((z) => timberAt(5, x, z, wood)).filter((k) => k !== PropKind.None)));
    expect(named.size).toBeGreaterThan(1);                        // a wood is not all one tree
    expect([...named].every((k) => treeName(k) !== 'tree')).toBe(true);
    expect(named.has(PropKind.DeadTree)).toBe(false);             // deadwood is not timber
  });

  it('leaves whips standing: not every tree in a wood takes the saw', () => {
    let trees = 0, fallen = 0;
    for (let x = 0; x < SIDE; x++) {
      for (let z = 0; z < SIDE; z++) {
        if (timberAt(6, x, z, wood) === PropKind.None) continue;
        trees++;
        if (fellingAt(6, x, z, wood)) fallen++;
      }
    }
    expect(fallen).toBeGreaterThan(0);
    expect(fallen).toBeLessThan(trees);
  });
});

describe('a felled stand', () => {
  it('comes down once, and is a stump until the day it has grown back', () => {
    const cutting = new Felling();
    const [x, z] = treeTile(9, wood);

    expect(cutting.fell(9, x, z, wood, 5)).toEqual(fellingAt(9, x, z, wood));
    expect(cutting.standing(x, z, 5)).toBe(false);
    for (let again = 0; again < 10; again++) expect(cutting.fell(9, x, z, wood, 5)).toBeNull();

    // the day before it is due, it is still a stump
    expect(cutting.standing(x, z, 5 + WOOD.REGROW - 1)).toBe(false);
    expect(cutting.fell(9, x, z, wood, 5 + WOOD.REGROW - 1)).toBeNull();

    expect(cutting.standing(x, z, 5 + WOOD.REGROW)).toBe(true);
    expect(cutting.fell(9, x, z, wood, 5 + WOOD.REGROW)).not.toBeNull();
  });

  it('counts down the days it has left, and says none when it is a tree again', () => {
    const cutting = new Felling();
    const [x, z] = treeTile(9, wood);
    expect(cutting.regrowsIn(x, z, 3)).toBe(0);            // never cut, nothing to wait for

    cutting.fell(9, x, z, wood, 3);
    expect(cutting.regrowsIn(x, z, 3)).toBe(WOOD.REGROW);
    expect(cutting.regrowsIn(x, z, 4)).toBe(WOOD.REGROW - 1);
    expect(cutting.regrowsIn(x, z, 3 + WOOD.REGROW)).toBe(0);
    expect(cutting.regrowsIn(x, z, 99)).toBe(0);
  });

  it('spends the tree and not the saw: the next one along still falls', () => {
    const cutting = new Felling();
    const [x, z] = treeTile(9, wood);
    cutting.fell(9, x, z, wood, 1);

    const elsewhere = [...sweep(9, wood).keys()].map((at) => at.split(',').map(Number))
      .find(([ax, az]) => ax !== x || az !== z)!;
    expect(cutting.fell(9, elsewhere[0], elsewhere[1], wood, 1)).not.toBeNull();
    expect(cutting.standing(x, z, 1)).toBe(false);
  });

  it('is not remembered where there was never a tree', () => {
    const cutting = new Felling();
    expect(cutting.fell(9, 4, 4, dunes, 1)).toBeNull();
    expect(cutting.standing(4, 4, 1)).toBe(true);           // nothing was cut, so nothing is coming back
  });
});

describe('a fire, and what it is for', () => {
  const supplies = { logs: WOOD.FIRE_LOGS, kindling: true };

  it('wants both the wood and the rocks before it will catch', () => {
    const noWood = new Fire();
    expect(noWood.light(0, 0, 1, { logs: 0, kindling: true })).toBe(false);
    expect(noWood.burning(1)).toBe(false);

    const noRocks = new Fire();
    expect(noRocks.light(0, 0, 1, { logs: 9, kindling: false })).toBe(false);
    expect(noRocks.burning(1)).toBe(false);

    const both = new Fire();
    expect(both.light(0, 0, 1, supplies)).toBe(true);
    expect(both.burning(1)).toBe(true);
  });

  it('will not catch in the rain', () => {
    const wet = new Fire();
    expect(wet.light(3, 3, 1, { ...supplies, wet: true })).toBe(false);
    expect(wet.burning(1)).toBe(false);
    expect(wet.where).toBeNull();
    expect(wet.light(3, 3, 1, { ...supplies, wet: false })).toBe(true);
  });

  it('burns a while and then it is ash, on the spot where it was struck', () => {
    const f = new Fire();
    f.light(10, -4, 2, supplies);
    expect(f.where).toEqual([10, -4]);
    expect(f.burning(2 + WOOD.BURN * 0.5)).toBe(true);
    expect(f.burning(2 + WOOD.BURN * 0.99)).toBe(true);
    expect(f.burning(2 + WOOD.BURN * 1.01)).toBe(false);
    expect(f.burning(3)).toBe(false);
    expect(f.near(10, -4)).toBe(true);                     // the ring of stones is still there
  });

  it('is only worth standing at from a step or two away', () => {
    const f = new Fire();
    expect(f.near(0, 0)).toBe(false);                      // no fire has been lit at all
    f.light(20, 20, 1, supplies);
    expect(f.near(20 + WOOD.FIRE_REACH - 0.1, 20)).toBe(true);
    expect(f.near(20 + WOOD.FIRE_REACH + 0.1, 20)).toBe(false);
    expect(f.near(0, 0)).toBe(false);
  });

  it('turns raw meat into a roast, and only while it is alight', () => {
    const f = new Fire();
    expect(f.cook('meat', 1)).toBeNull();                  // nothing has been lit yet

    f.light(0, 0, 1, supplies);
    expect(f.cook('meat', 1)).toBe('roast');
    expect(f.cook('gem', 1)).toBeNull();                   // a fire is not a forge
    expect(f.cook('meat', 1 + WOOD.BURN)).toBeNull();      // burnt down, and the meat is still raw
  });

  it('is why anybody bothers: a roast is worth more than what went on it', () => {
    const raw = ITEMS.meat, done = ITEMS.roast;
    expect(done.price).toBeGreaterThan(raw.price);
    expect(done.effect).toEqual({ type: 'heal', amount: expect.any(Number) });
    expect((done.effect as { amount: number }).amount)
      .toBeGreaterThan((raw.effect as { amount: number }).amount);
  });
});

describe('the cart a market builds', () => {
  it('waits until the market has been sold enough wood', () => {
    expect(cartBuilt(0)).toBe(false);
    expect(cartBuilt(WOOD.CART_WOOD - 1)).toBe(false);
    expect(cartBuilt(WOOD.CART_WOOD)).toBe(true);
    expect(cartBuilt(WOOD.CART_WOOD * 3)).toBe(true);
  });

  it('says how much more wood the wright is waiting on', () => {
    expect(woodWanted(0)).toBe(WOOD.CART_WOOD);
    expect(woodWanted(WOOD.CART_WOOD - 4)).toBe(4);
    expect(woodWanted(WOOD.CART_WOOD)).toBe(0);
    expect(woodWanted(WOOD.CART_WOOD + 50)).toBe(0);       // a market never wants wood back
  });

  it('hauls faster, but only with a horse in the shafts', () => {
    const horse = 2.1;
    expect(haulPace(horse, false, false)).toBe(1);
    expect(haulPace(horse, false, true)).toBe(1);          // a cart you have to push is no help
    expect(haulPace(horse, true, false)).toBe(horse);
    expect(haulPace(horse, true, true)).toBeGreaterThan(horse);
  });
});
