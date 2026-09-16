import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { CARRY, whatACarrierWouldCarry, type Market } from './carriers';
import { FOOD, cellarCap } from './food';
import { coverOf, priceOfAMeal } from './prices';
import { PROSPER } from './prosperity';
import type { Person } from './people';

/**
 * Two valleys, one of which grows food and one of which cannot, and somebody who walks between them.
 *
 * The bench in one picture. **Barrowgate** has fields, so it grows more than it eats and its cellar
 * sits full from the second week onwards; **Stonerock** has no fields and no woods, so every soul
 * there feeds themselves out of a kitchen garden and not one meal more. Left alone the two of them
 * never touch: Barrowgate throws its glut away every morning at a rate a constant declares, and
 * Stonerock lives for four hundred days on the three days of food it was founded with, paying two
 * and a half gold for a dinner its neighbour sells for sixty-five hundredths.
 *
 * That gap is the whole of what a carrier is for, and the numbers above are read rather than
 * invented: on all three seeds, before item 141, Stonerock's cellar stood at a cover of 0.27 on day
 * eleven and at 0.27 on day forty-one, with nothing in between.
 */

/** The seeds the economy bench asks about, so a fault here can be gone and looked at there. */
const SEEDS = [1, 7, 1234];

/** Long enough for one cellar to fill and the other to have been carried to. */
const DAYS = 41;

/** Somewhere with fields: it grows more than it eats and has nowhere to put the rest. */
const FULL = 'Barrowgate';
/** And somewhere without: a kitchen garden a head, which is exactly what a head eats. */
const BARE = 'Stonerock';

/** The two valleys, founded the way the game founds them and left to get on with it. */
function twoValleys(seed: number): Register {
  const register = new Register(seed);
  register.settle(FULL, 6, ['farmer', 'seller', 'builder', 'innkeeper']);
  register.settle(BARE, 6, ['builder', 'seller', 'innkeeper', 'doctor']);
  return register;
}

/** What a village's people hold between them, which is the only thing a carrier can be paid out of. */
function worthOf(register: Register, village: string): number {
  return register.living(village).reduce((sum, person) => sum + person.purse, 0);
}

describe('a carrier between two valleys', () => {
  /**
   * The headline, said as a measurement: a village that cannot feed itself ends the month fed.
   *
   * Cover rather than meals, because the two villages are not the same size and never stay the
   * same size. A half is well clear of the 0.27 a kitchen garden holds a place at and well under
   * the 0.92 a farming village sits at, so it is a claim that something was carried rather than a
   * claim about how much.
   */
  it('fills the cellar of a village that cannot feed itself, out of one that can', () => {
    for (const seed of SEEDS) {
      const register = twoValleys(seed);
      register.advance(DAYS);
      const here = register.living(BARE);
      const cover = register.larderOf(BARE) / cellarCap(here);
      expect(cover, `${BARE} on seed ${seed} is still living hand to mouth`).toBeGreaterThan(0.5);
    }
  });

  /**
   * And the coin for it went the other way, which is the half that makes it trade rather than alms.
   *
   * Read off the register's own book of what a carrier moved, for the reason the tax is read off
   * the hall: what a carrier actually paid is a fact about the day it walked, and a figure worked
   * out afterwards from a purse that has moved on is a guess.
   */
  it('takes the coin out of the valley that was fed and puts it in the one that fed it', () => {
    for (const seed of SEEDS) {
      const register = twoValleys(seed);
      let paidOut = 0, tookIn = 0;
      for (let day = 2; day <= DAYS; day++) {
        register.advance(day);
        for (const person of register.living(BARE)) paidOut += register.carriedBy(person.id);
        for (const person of register.living(FULL)) tookIn += register.carriedBy(person.id);
      }
      expect(paidOut, `nobody in ${BARE} on seed ${seed} paid for anything`).toBeLessThan(0);
      // a coin leaving one purse arrives in another: what the fed valley paid is what the feeding
      // valley was paid, to the thousandth, and no carrying may mint or burn a coin in between
      expect(tookIn + paidOut, `a carrier made or burnt money on seed ${seed}`).toBeCloseTo(0, 3);
    }
  });

  /**
   * Nothing is grown on the road, and nothing spoils on it either.
   *
   * The food half of the same rule. What leaves one larder arrives in another, so the two valleys
   * hold between them exactly what they would have held with nobody walking — less what they ate,
   * which is the only thing that is allowed to take a meal out of the world.
   */
  it('never mints a meal, and never puts one where a cellar cannot hold it', () => {
    for (const seed of SEEDS) {
      const register = twoValleys(seed);
      register.advance(DAYS);
      for (const village of [FULL, BARE]) {
        const here = register.living(village);
        expect(coverOf(register.larderOf(village), here), `${village} on seed ${seed} is holding food that should have spoiled`)
          .toBeLessThanOrEqual(1);
      }
    }
  });

  /**
   * And the two prices come together, which is the thing a player is meant to be able to see.
   *
   * A glut sells for little and a hungry valley pays: that is `prices.ts`, and it is a reading of
   * one village in isolation. What a carrier adds is the arbitrage — the moment a price in one
   * valley is a fact about the next one. Four and a half times before; within half again after.
   */
  it('closes the gap between what a meal costs in the two places', () => {
    for (const seed of SEEDS) {
      const register = twoValleys(seed);
      register.advance(DAYS);
      const dear = priceOfAMeal(register.larderOf(BARE), register.living(BARE));
      const cheap = priceOfAMeal(register.larderOf(FULL), register.living(FULL));
      expect(dear / cheap, `a meal on seed ${seed} still costs wildly different money either side of the hill`)
        .toBeLessThan(1.5);
    }
  });
});

// --- the cart itself, asked of two markets and nothing else -----------------------------------

let next = 0;

function person(trade: string, purse = 100): Person {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Testing', sex: 'man', trade,
    born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse, hungry: 0,
  };
}

/** A market of so many working souls, as full or as empty or as rich as the test wants it. */
function market(village: string, cover: number, purse = 100, souls = 12): Market {
  const people = Array.from({ length: souls }, () => person('farmer', purse));
  return { village, food: cellarCap(people) * cover, people, shore: false, pressure: 0 };
}

/** What a map of payments comes to, which is most of what these ask. */
const total = (paid: ReadonlyMap<string, number>): number =>
  [...paid.values()].reduce((sum, much) => sum + much, 0);

describe('what a carrier would load', () => {
  it('pays the feeding valley exactly what the fed valley paid, and not a hundredth more', () => {
    const cart = whatACarrierWouldCarry([market('Full', 1), market('Bare', 0.1)])!;
    expect(cart.from).toBe('Full');
    expect(cart.to).toBe('Bare');
    // the one rule the whole economy is checked against, said about the only transaction in this
    // world whose two halves are in two different villages' books
    expect(total(cart.paid) + total(cart.paying)).toBeCloseTo(0, 10);
    expect(total(cart.paid)).toBeCloseTo(cart.meals * cart.price, 10);
  });

  it('walks nowhere at all between two valleys holding the same thing', () => {
    // a threshold rather than a rate: two places that have been carried between until their
    // cellars match are two places nobody has any reason to walk between
    expect(whatACarrierWouldCarry([market('Ashford', 0.8), market('Oakcross', 0.8)])).toBeNull();
  });

  it('never loads more than one cart holds, however wide the gap', () => {
    const cart = whatACarrierWouldCarry([market('Full', 1, 4000), market('Bare', 0, 4000)])!;
    expect(cart.meals).toBeLessThanOrEqual(CARRY.A_CARTLOAD);
  });

  it('never carries a meal the cellar at the other end cannot hold', () => {
    // one soul, so the whole cellar is smaller than a cart: what will not fit stays where it is
    // rather than going on the road and spoiling there
    const hamlet = market('Windle', 0, 4000, 1);
    expect(cellarCap(hamlet.people)).toBeLessThan(CARRY.A_CARTLOAD);
    const cart = whatACarrierWouldCarry([market('Full', 1, 4000), hamlet])!;
    expect(cart.to).toBe('Windle');
    expect(hamlet.food + cart.meals).toBeLessThanOrEqual(cellarCap(hamlet.people));
  });

  it('never carries a meal the sending cellar has not got', () => {
    const thin = market('Thin', 0.02, 4000);
    const cart = whatACarrierWouldCarry([thin, market('Emptier', 0, 4000)]);
    if (cart) expect(cart.meals).toBeLessThanOrEqual(thin.food);
  });

  it('takes nobody down to their last week of dinners to pay for it', () => {
    const bare = market('Bare', 0, PROSPER.KEEPS_BACK + 1);
    const cart = whatACarrierWouldCarry([market('Full', 1), bare])!;
    for (const buyer of bare.people) {
      const took = -(cart.paying.get(buyer.id as never) ?? 0);
      expect(buyer.purse - took).toBeGreaterThanOrEqual(PROSPER.KEEPS_BACK);
    }
  });

  it('will not load a cart for a village with nothing at all to pay with', () => {
    expect(whatACarrierWouldCarry([market('Full', 1), market('Broke', 0, 0)])).toBeNull();
  });

  it('leaves a raided village alone, coming and going', () => {
    const raided = { ...market('Thornby', 0, 4000), pressure: PROSPER.UNTROUBLED + 0.1 };
    expect(whatACarrierWouldCarry([market('Full', 1), raided])).toBeNull();
    const besieged = { ...market('Thornby', 1, 4000), pressure: PROSPER.UNTROUBLED + 0.1 };
    expect(whatACarrierWouldCarry([besieged, market('Bare', 0, 4000)])).toBeNull();
  });

  it('is worth more to the valley that grew it than throwing the glut at the world', () => {
    // the whole reason anybody walks: `FOOD.ABROAD` is what a meal fetches when nobody carries it,
    // and a hungry valley pays several times that for the same meal
    const cart = whatACarrierWouldCarry([market('Full', 1), market('Bare', 0.1)])!;
    expect(cart.price).toBeGreaterThan(FOOD.ABROAD);
  });

  it('goes to the hungriest valley within reach, and fetches from the fullest', () => {
    const cart = whatACarrierWouldCarry([
      market('Fullest', 1), market('Middling', 0.6), market('Hungriest', 0.05),
    ])!;
    expect([cart.from, cart.to]).toEqual(['Fullest', 'Hungriest']);
  });

  it('stays home where the walk is too long, whoever is hungry at the end of it', () => {
    const far = { ...market('Faraway', 0.05), at: { x: CARRY.AS_FAR_AS * 2, z: 0 } };
    expect(whatACarrierWouldCarry([{ ...market('Full', 1), at: { x: 0, z: 0 } }, far])).toBeNull();
  });
});
