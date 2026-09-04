import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/rng';
import { KINDS } from '../entities/animals';
import { Biome } from '../world/biomes';
import { FUR, Carcasses, hideOf, isFur, paidFor, priceOf, skin } from './furs';
import { ITEMS } from './items';

const TRIES = 600;

/** How often a hide comes off over a long run of bodies, which is the only way to see luck at work. */
const takings = (kind: string, knife: boolean, seed = 7): number => {
  const roll = mulberry32(seed);
  let taken = 0;
  for (let i = 0; i < TRIES; i++) if (skin(kind, knife, roll)) taken++;
  return taken;
};

describe('taking the fur off what you killed', () => {
  it('makes a pelt certain with a knife where luck alone did not', () => {
    expect(takings('wolf', true)).toBe(TRIES);            // every body, every time
    const barehanded = takings('wolf', false);
    expect(barehanded).toBeGreaterThan(0);                // pulling at it is worth one try
    expect(barehanded).toBeLessThan(TRIES / 2);           // and not worth planning around
    expect(barehanded / TRIES).toBeCloseTo(FUR.TORN, 1);
  });

  it('gives a bear pelt off a bear and a wolf pelt off a wolf', () => {
    const sharp = mulberry32(1);
    expect(skin('bear', true, sharp)).toBe('bearpelt');
    expect(skin('wolf', true, sharp)).toBe('pelt');
    expect(ITEMS.bearpelt.price).toBeGreaterThan(ITEMS.pelt.price);
  });

  it('leaves the creatures nobody skins alone', () => {
    const roll = mulberry32(2);
    // livestock belongs to somebody, the dead have nothing to take, and no one skins a person
    for (const kind of ['skeleton', 'villager', 'chicken', 'cow', 'troll']) {
      expect(hideOf(kind)).toBeNull();
      expect(skin(kind, true, roll)).toBeNull();
    }
  });

  it('gives a beginner something to skin that does not fight back', () => {
    const roll = mulberry32(3);
    // the whole on-ramp: game a new player can take with a stick, and a hide worth carrying in
    for (const kind of ['deer', 'elk', 'hare', 'rabbit', 'goat', 'fox']) {
      expect(KINDS[kind].hp, `${kind} must be killable to be huntable`).toBeGreaterThan(0);
      expect(KINDS[kind].dangerous ?? 0, `${kind} must not fight back`).toBe(0);
      expect(skin(kind, true, roll), `${kind} must give a hide`).not.toBeNull();
    }
  });

  it('takes the hide out of the loot a kill hands over, and leaves the teeth in it', () => {
    // the rule combat asks about: a wolf's pelt is now skinned off the body, a bear's fang is not
    expect(isFur(KINDS.wolf.drop!.id)).toBe(true);
    expect(isFur(KINDS.bear.drop!.id)).toBe(false);
    expect(isFur('bone')).toBe(false);
    expect(isFur('bearpelt')).toBe(true);
  });
});

describe('what a fur is worth, and where', () => {
  it('pays more for a pelt in the desert than in the snow it came from', () => {
    expect(priceOf('pelt', Biome.Desert)).toBeGreaterThan(priceOf('pelt', Biome.Snow));
    expect(priceOf('bearpelt', Biome.Desert)).toBeGreaterThan(priceOf('bearpelt', Biome.Snow) * 2);
    // and the walk has to be worth something: the far end pays over the shop list, the near end under
    expect(priceOf('pelt', Biome.Desert)).toBeGreaterThan(ITEMS.pelt.price);
    expect(priceOf('pelt', Biome.Snow)).toBeLessThan(ITEMS.pelt.price);
  });

  it('hands over less than the fur is worth, because a trader has to live', () => {
    for (const country of [Biome.Desert, Biome.Snow, Biome.Plains]) {
      expect(paidFor('pelt', country)).toBeLessThan(priceOf('pelt', country));
      expect(paidFor('pelt', country)).toBeGreaterThan(0);
    }
    expect(paidFor('bearpelt', Biome.Desert)).toBeGreaterThan(paidFor('bearpelt', Biome.Snow));
  });

  it('prices everything that is not fur the same wherever you carry it', () => {
    for (const id of ['bread', 'sword', 'gem', 'fang']) {
      expect(priceOf(id, Biome.Desert)).toBe(ITEMS[id].price);
      expect(priceOf(id, Biome.Snow)).toBe(ITEMS[id].price);
    }
  });

  it('says the same thing to everybody, for ever', () => {
    for (const country of [Biome.Plains, Biome.Forest, Biome.Desert, Biome.Swamp, Biome.Mountain, Biome.Snow]) {
      expect(priceOf('pelt', country)).toBe(priceOf('pelt', country));
      expect(priceOf('pelt', country)).toBeGreaterThan(0);
    }
  });
});

describe('the bodies left lying about', () => {
  it('leaves a body only where there is a hide on it', () => {
    const ground = new Carcasses();
    expect(ground.fell('wolf', 3, 4)).not.toBeNull();
    expect(ground.fell('bear', 9, 9)).not.toBeNull();
    expect(ground.fell('skeleton', 1, 1)).toBeNull();
    expect(ground.all).toHaveLength(2);
  });

  it('is found by standing over it, and not from across the field', () => {
    const ground = new Carcasses();
    ground.fell('wolf', 10, 10);
    expect(ground.nearest(10.6, 10.4)).not.toBeNull();
    expect(ground.nearest(30, 30)).toBeNull();
  });

  it('gives up its hide once, and is spent even when it comes away in strips', () => {
    const ground = new Carcasses();
    const body = ground.fell('bear', 0, 0)!;
    expect(ground.take(body, true, mulberry32(3))).toBe('bearpelt');
    expect(ground.all).toHaveLength(0);
    expect(ground.nearest(0, 0)).toBeNull();

    const torn = new Carcasses();
    const spoiled = torn.fell('wolf', 0, 0)!;
    // a roll that fails: the hide is ruined, and the body goes with it
    expect(torn.take(spoiled, false, () => 1)).toBeNull();
    expect(torn.all).toHaveLength(0);
  });

  it('lets the ones nobody came back for go', () => {
    const ground = new Carcasses();
    ground.fell('wolf', 0, 0);
    ground.age(FUR.LASTS - 1);
    expect(ground.all).toHaveLength(1);
    ground.age(2);
    expect(ground.all).toHaveLength(0);
  });

  it('does not let a good day of hunting fill the country with bodies', () => {
    const ground = new Carcasses();
    for (let i = 0; i < FUR.KEPT + 5; i++) ground.fell('wolf', i * 10, 0);
    expect(ground.all).toHaveLength(FUR.KEPT);
    expect(ground.all[0].x).toBe(50);          // the oldest went first
  });
});
