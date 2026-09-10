import { describe, expect, it } from 'vitest';
import { FOOD, broughtIn } from './food';
import { PROSPER } from './prosperity';
import {
  LIVELIHOOD, aDayOfCattle, aDaysIncome, aDaysTrade, paidForFood, paidForService, shareOut, whoFed,
} from './livelihoods';
import type { Person } from './people';

/**
 * The four ways to earn, and the one rule that makes them an economy rather than four taps.
 *
 * The rule is that **a coin leaving one purse arrives in another**, and most of what is below is
 * that rule asked of each way in turn: what the village pays for its dinner is exactly what the
 * people who grew it are paid, what everybody spends on their keep is exactly what the innkeeper
 * and the seller and the doctor take, and the only money that appears or disappears is money
 * crossing the parish boundary — out of the mine, off to the next valley with the meat, or away on
 * a pedlar's cart because there was nobody here to buy from.
 *
 * That last one is worth stating as a test rather than as a comment, because a leak nobody
 * measures is how the old economy came to mint and burn a village's whole income every day without
 * anybody noticing.
 */

let next = 0;

function person(trade: string, purse = 100): Person {
  next++;
  return {
    id: `p${next}`, name: `Person ${next}`, village: 'Testing', trade,
    born: 0, lives: 100, mother: '', father: '', knows: [], memories: [], opinions: [],
    purse, hungry: 0,
  };
}

/** What a map of payments comes to, which is the only question most of these tests ask. */
const total = (paid: ReadonlyMap<string, number>): number =>
  [...paid.values()].reduce((sum, much) => sum + much, 0);

describe('sharing a pool out', () => {
  it('hands out every coin of it, and no more', () => {
    const shares = new Map([['a', 1], ['b', 3], ['c', 5]]);
    const paid = shareOut(90, shares);
    expect(total(paid)).toBeCloseTo(90, 10);
    expect(paid.get('b')).toBeCloseTo(30, 10);
  });

  it('gives the odd penny to somebody rather than losing it', () => {
    // a third of ten, three ways: rounded shares would leave a hundredth of a coin unaccounted for
    // every day, which over a hundred villages and a hundred days is money the world invented
    const paid = shareOut(10, new Map([['a', 1], ['b', 1], ['c', 1]]));
    expect(total(paid)).toBeCloseTo(10, 12);
  });

  it('shares nothing when there is nobody to share it among', () => {
    expect(shareOut(50, new Map()).size).toBe(0);
  });
});

describe('keeping cattle', () => {
  it('grows a young herd toward what the paddocks hold, selling nothing', () => {
    const day = aDayOfCattle(2, 1);
    expect(day.herd).toBeGreaterThan(2);
    expect(day.sold).toBe(0);
    expect(day.gold).toBe(0);
  });

  it('sells exactly what was born once the herd is full, and stays that size', () => {
    const farmers = 2;
    const cap = farmers * LIVELIHOOD.HERD_PER_FARMER;
    const day = aDayOfCattle(cap, farmers);
    expect(day.herd).toBeCloseTo(cap, 10);
    expect(day.sold).toBeCloseTo(cap * LIVELIHOOD.CALVES, 10);
    expect(day.gold).toBeGreaterThan(0);
  });

  it('reaches the paddocks from a founding herd inside a season', () => {
    // the whole reason the calving rate is what it is: a village founded today should have a full
    // paddock to come back to, and not in a year
    let herd: number = LIVELIHOOD.FIRST_HERD;
    let days = 0;
    while (herd < LIVELIHOOD.HERD_PER_FARMER - 0.01 && days < 400) { herd = aDayOfCattle(herd, 1).herd; days++; }
    expect(days).toBeGreaterThan(14);
    expect(days).toBeLessThan(90);
  });

  it('loses the herd when the last farmer is buried', () => {
    expect(aDayOfCattle(12, 0)).toEqual({ herd: 0, sold: 0, meals: 0, gold: 0 });
  });
});

describe('what the village paid for its dinner', () => {
  it('goes to the people who grew it, in proportion to what each grew', () => {
    const people = [person('farmer'), person('soldier'), person('hunter')];
    const paid = paidForFood(people, 3);
    expect(total(paid)).toBeCloseTo(3, 10);
    expect(paid.get(people[0].id)!).toBeGreaterThan(paid.get(people[2].id)!);
    expect(paid.get(people[2].id)!).toBeGreaterThan(paid.get(people[1].id)!);
  });

  it('pays the farmers for the meat as well as for the field', () => {
    const people = [person('farmer'), person('soldier')];
    const without = paidForFood(people, 10)?.get(people[0].id)!;
    const with_ = paidForFood(people, 10, 16)?.get(people[0].id)!;
    expect(with_).toBeGreaterThan(without);
  });

  it('pays nobody on the day there was nothing to eat', () => {
    // a famine ruins the farmer too, and this is where that happens: the pool is what came out of
    // purses, so an empty larder is an empty pool
    expect(total(paidForFood([person('farmer'), person('soldier')], 0))).toBe(0);
  });

  it('leaves the children out of it', () => {
    const child = person('');
    expect(whoFed([child, person('farmer')]).has(child.id)).toBe(false);
  });
});

describe('selling a service', () => {
  it('hands everybody\'s keep to the people they bought it from', () => {
    const people = [person('seller'), person('innkeeper'), person('soldier'), person('farmer')];
    const paid = paidForService(people, 6);
    expect(total(paid)).toBeCloseTo(6, 10);
    expect(paid.get(people[2].id)).toBeUndefined();
    expect(paid.get(people[3].id)).toBeUndefined();
  });

  it('lets it leave the valley when there is nobody here to buy from', () => {
    // the one place money leaves this economy, and the reason a village with no market never gets
    // rich however long it is left in peace
    expect(total(paidForService([person('soldier'), person('farmer')], 6))).toBe(0);
  });
});

describe('a village\'s working day', () => {
  const village = (): Person[] => [
    person('farmer'), person('farmer'), person('hunter'), person('seller'),
    person('innkeeper'), person('soldier'), person('miner'), person(''),
  ];

  it('lets nothing appear that did not come from outside the village', () => {
    const people = village();
    const day = aDaysTrade(people, 8, 0);
    // what came in from beyond: the wages of the trades whose customers are elsewhere, and the
    // meat the next valley bought. Everything else in the day is one villager paying another
    const outside = aDayOfCattle(8, 2).gold
      + people.filter((p) => ['seller', 'innkeeper', 'doctor'].includes(p.trade)).length * PROSPER.TRADED
      + people.filter((p) => ['soldier', 'miner', 'sailor', 'climber', 'explorer', 'constable'].includes(p.trade)).length * PROSPER.A_DAY;
    expect(total(day.paid)).toBeCloseTo(outside, 8);
  });

  it('grows what everybody brought in, and the meat on top', () => {
    const people = village();
    const day = aDaysTrade(people, 40, 0);
    const fields = people.reduce((sum, p) => sum + broughtIn(p), 0);
    expect(day.grown).toBeCloseTo(fields + day.meat, 10);
    expect(day.meat).toBeGreaterThan(0);
  });

  it('stops the work while the place is being raided, but not the cost of living', () => {
    const people = village();
    const day = aDaysTrade(people, 12, PROSPER.UNTROUBLED + 0.1);
    expect(day.grown).toBe(0);
    expect(day.herd).toBe(12);            // the cattle are still there; nobody is working them
    // and the keep still goes out, to somebody outside the valley, because the village's own
    // market is shut. It is the only thing a band costs a village once money goes round in a
    // circle: without it a raided village ends the fortnight worth what it started it worth
    const adults = people.filter((p) => p.trade).length;
    expect(total(day.paid)).toBeCloseTo(-adults * PROSPER.UPKEEP, 8);
  });

  it('takes the keep out of the purses that spent it', () => {
    const people = [person('soldier', 500), person('seller', 500)];
    const day = aDaysTrade(people, 0, 0);
    // the soldier's day is his wage less his keep; the seller's is her wage plus both keeps
    expect(day.paid.get(people[0].id)!).toBeCloseTo(PROSPER.A_DAY - PROSPER.UPKEEP, 10);
    expect(day.paid.get(people[1].id)!).toBeCloseTo(PROSPER.TRADED + PROSPER.UPKEEP * 2 - PROSPER.UPKEEP, 10);
  });
});

describe('what the roll quotes against a name', () => {
  it('is more than the wage, because most of a wage is now the neighbours', () => {
    const people = [person('farmer'), person('soldier'), person('seller'), person('hunter')];
    const income = aDaysIncome(people, 12, 0);
    // a farmer earns nothing from beyond the village and everything from inside it: a roll that
    // quoted only the outside wage would have him down as earning nought a day
    expect(income.get(people[0].id)!).toBeGreaterThan(0);
    expect(income.get(people[2].id)!).toBeGreaterThan(PROSPER.TRADED);
  });

  it('never quotes more dinner money than the village could pay for', () => {
    // two people whose whole income is each other's money and neither of whom has any. Nobody
    // buys a meal, so nobody sells one, so the farmer takes nothing for what he grew
    const broke = [person('farmer', 0), person('hunter', 0)];
    const income = aDaysIncome(broke, 0, 0, 0);
    expect(income.get(broke[0].id)!).toBeCloseTo(0, 10);
  });

  it('holds the food pool to what a village of this size actually eats', () => {
    const people = [person('farmer'), person('farmer'), person('soldier'), person('seller')];
    const income = aDaysIncome(people, 0, 0);
    const wages = people.reduce(
      (sum, p) => sum + (['seller'].includes(p.trade) ? PROSPER.TRADED : p.trade === 'soldier' ? PROSPER.A_DAY : 0),
      0,
    );
    const keep = people.length * PROSPER.UPKEEP;
    const dinner = people.filter((p) => p.trade).length * FOOD.MEAL;
    expect(total(income)).toBeCloseTo(wages + keep + dinner, 8);
  });
});

/**
 * A farmer's hundred days, which used to be `prosperity.test.ts`'s question and is now this one's.
 *
 * The question has not changed — is he better off in the spring than he was in the winter — but
 * where the answer comes from has, entirely. It used to be a wage against a meal and a keep, all
 * three of them constants, so one purse on its own could answer it. A farmer's income is now his
 * neighbours' money, so the smallest thing that can be asked is a village: how many mouths there
 * are to sell dinner to, how many other people are growing it, and what is in the paddock.
 *
 * Lived here rather than in `register.ts`'s own tests because nothing else about a village is
 * wanted — no births, no funerals, no warband — and a hundred days of purse arithmetic is exactly
 * what the four livelihoods are for.
 */
describe('a farmer\'s hundred days, in a village with people in it', () => {
  const village = (): Person[] => [
    person('farmer', 0), person('hunter', 0), person('seller', 0),
    person('soldier', 0), person('miner', 0), person('', 0), person('', 0),
  ];

  /** One day in the order the register lives it: the morning's work, then dinner. */
  const aDay = (people: Person[], herd: number): number => {
    const work = aDaysTrade(people, herd, 0);
    for (const [id, much] of work.paid) {
      const who = people.find((p) => p.id === id)!;
      who.purse = Math.max(0, who.purse + much);
    }
    // dinner: everybody who can pay for one buys one, and the money goes to whoever grew it
    let pool = 0;
    for (const one of people) {
      if (one.trade && one.purse >= FOOD.MEAL) { one.purse -= FOOD.MEAL; pool += FOOD.MEAL; }
    }
    for (const [id, much] of paidForFood(people, pool, work.meat)) {
      people.find((p) => p.id === id)!.purse += much;
    }
    return work.herd;
  };

  const lived = (days: number): Person[] => {
    const people = village();
    let herd: number = LIVELIHOOD.FIRST_HERD;
    for (let day = 0; day < days; day++) herd = aDay(people, herd);
    return people;
  };

  it('leaves him better off in the spring than in the winter', () => {
    const fifty = lived(50)[0].purse;
    const hundred = lived(100)[0].purse;
    expect(fifty).toBeGreaterThan(0);
    expect(hundred).toBeGreaterThan(fifty + 10);
  });

  it('leaves everybody in the village better off, and nobody at the reserve', () => {
    // the fixed point this whole economy was rebuilt to avoid: every purse in the world coming to
    // rest on the same number, so that nothing anybody earned ever bought anything
    for (const soul of lived(100).filter((p) => p.trade)) {
      expect(soul.purse, `${soul.trade} ended the hundred days on ${soul.purse}`)
        .toBeGreaterThan(PROSPER.KEEPS_BACK + 10);
    }
  });

  it('makes the hunter and the farmer worth being, against a wage nobody pays them', () => {
    const after = lived(100);
    const farmer = after.find((p) => p.trade === 'farmer')!;
    const hunter = after.find((p) => p.trade === 'hunter')!;
    // neither of them earns a penny from `earnedInADay`; if the market did not pay them they would
    // both have starved somewhere around day seven
    expect(farmer.purse).toBeGreaterThan(0);
    expect(hunter.purse).toBeGreaterThan(0);
  });
});
