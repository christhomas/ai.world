import { describe, expect, it } from 'vitest';
import { ITEMS } from '../game/items';
import { FOOD, broughtIn, cellarCap } from './food';
import { PROSPER, spentOnLiving } from './prosperity';
import {
  LIVELIHOOD, aDaysIncome, aDaysTrade, boughtInTheVillage, paidForFood,
  DINNER, aDaysDinner, paidForService, pitchFor, shareOut, soldAtMarket, whoFed,
} from './livelihoods';
import { aDayOfCattle } from './harvest';
import { taxedForTheHall } from './hall';
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
    id: `p${next}`, name: `Person ${next}`, village: 'Testing', sex: 'man', trade,
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

  it('fills the paddocks from a founding herd in about a fortnight', () => {
    /*
     * What the calving rate is actually for. A village founded today has four head and room for
     * six, and the gap between those two numbers is the whole reason to walk back out to the field
     * a week later. Too fast and the herd is full before anybody has left the village; too slow
     * and it is a number that never visibly moves.
     */
    let herd: number = LIVELIHOOD.FIRST_HERD;
    let days = 0;
    while (herd < LIVELIHOOD.HERD_PER_FARMER - 0.01 && days < 400) { herd = aDayOfCattle(herd, 1).herd; days++; }
    expect(days).toBeGreaterThan(5);
    expect(days).toBeLessThan(40);
  });

  it('works a dead farmer\'s beasts off in about a month, not in about a year', () => {
    /*
     * Found by `chore sanity` at four hundred and fifty days: villages running a herd nobody was
     * keeping for a hundred and ninety days at a stretch. The herd grew by a calving and sold a
     * calving on the same morning and the two all but cancelled, so an over-cap herd came down by
     * sixteen hundredths of a percent a day. A full paddock does not calve now.
     */
    const farmers = 1;
    const cap = farmers * LIVELIHOOD.HERD_PER_FARMER;
    let herd = cap * 3;                          // three farmers' worth, two of them just buried
    let days = 0;
    while (herd > cap + 0.01 && days < 400) { herd = aDayOfCattle(herd, farmers).herd; days++; }
    expect(days).toBeGreaterThan(7);             // not the whole surplus at the butcher in one morning
    expect(days).toBeLessThan(45);
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
    const keep = people.reduce((sum, p) => sum + PROSPER.UPKEEP + pitchFor(p), 0);
    const dinner = people.filter((p) => p.trade).length * FOOD.MEAL;
    // the pitch is in there with the keep: the roll quotes what a day takes in on one line and
    // what it costs on another, and both costs belong on the second
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

  /*
   * One day in the order the register lives it: the morning's work, then dinner.
   *
   * Through `aDaysTrade` and `aDaysDinner` rather than a hand-rolled version of the two, because a
   * test harness that is its own copy of the day is a test that goes on passing after the day has
   * changed underneath it. This one did: it kept charging for dinner and paying the growers while
   * knowing nothing about the surplus going to market, so the morning the hunter started paying
   * for a pitch he simply got poorer here and nowhere else.
   */
  const aDay = (people: Person[], herd: number, store: number): [number, number] => {
    const work = aDaysTrade(people, herd, 0);
    for (const [id, much] of work.paid) {
      const who = people.find((p) => p.id === id)!;
      who.purse = Math.max(0, who.purse + much);
    }
    const meal = aDaysDinner(people, store, work);
    for (const [id, much] of meal.paid) people.find((p) => p.id === id)!.purse += much;
    return [work.herd, meal.food];
  };

  const lived = (days: number): Person[] => {
    const people = village();
    let herd: number = LIVELIHOOD.FIRST_HERD;
    let store = people.length * 3;
    for (let day = 0; day < days; day++) [herd, store] = aDay(people, herd, store);
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

/**
 * The seen half and the unseen half of the world, over the same deer.
 *
 * A hunter a player is standing next to sells his catch through `verbs.ts`; a hunter nobody is
 * watching is paid his share of what the village spent on dinner. For as long as the first of those
 * credited him the price of the meat out of nowhere, walking up to a village made it richer — which
 * is the one thing this whole economy is built not to do.
 */
describe('a sale made in front of somebody', () => {
  it('takes the money out of a neighbour rather than out of the air', () => {
    const people = [person('hunter', 10), person('seller', 200), person('soldier', 200)];
    const before = people.reduce((sum, p) => sum + p.purse, 0);
    const paid = soldAtMarket(people, people[0].id, 7);
    expect(paid).toBe(7);
    expect(people[0].purse).toBe(17);
    expect(people.reduce((sum, p) => sum + p.purse, 0)).toBe(before);
  });

  it('is bought by the market seller, whoever else is standing about', () => {
    const people = [person('hunter', 0), person('soldier', 900), person('seller', 100)];
    soldAtMarket(people, people[0].id, 7);
    expect(people[2].purse).toBe(93);
    expect(people[1].purse).toBe(900);
  });

  it('sells for what the village can afford and no more', () => {
    // a poor village cannot buy the whole deer, and nobody buys it out of next week's dinners
    const people = [person('hunter', 0), person('seller', PROSPER.KEEPS_BACK + 2)];
    expect(soldAtMarket(people, people[0].id, 7)).toBe(2);
    expect(people[1].purse).toBe(PROSPER.KEEPS_BACK);
  });

  it('makes no sale at all in a village with nobody left to buy', () => {
    const alone = [person('hunter', 40)];
    expect(soldAtMarket(alone, alone[0].id, 7)).toBe(0);
    expect(alone[0].purse).toBe(40);
  });
});

/**
 * The other half of a market: somebody actually handing over a coin.
 *
 * A village pays its seller, its innkeeper and its doctor every day in the books — that is what
 * `paidForService` is — and until now nobody had ever been seen doing it. The evening at the inn
 * was a man walking to a door, standing there, and a number going down on a body that is destroyed
 * the moment a player walks away.
 */
describe('a purchase made in front of somebody', () => {
  it('puts the money in the keeper\'s purse rather than nowhere', () => {
    const people = [person('farmer', 40), person('innkeeper', 10), person('soldier', 40)];
    const before = people.reduce((sum, p) => sum + p.purse, 0);
    expect(boughtInTheVillage(people, people[0].id, 6, 'innkeeper')).toBe(6);
    expect(people[0].purse).toBe(34);
    expect(people[1].purse).toBe(16);
    expect(people.reduce((sum, p) => sum + p.purse, 0)).toBe(before);
  });

  it('goes to the trade that sells the thing, when there is one', () => {
    const people = [person('hunter', 90), person('innkeeper', 0), person('seller', 0)];
    boughtInTheVillage(people, people[0].id, 40, 'seller');
    expect(people[2].purse, 'gear was bought off the innkeeper').toBe(40);
    expect(people[1].purse).toBe(0);
  });

  it('falls back to whoever here sells anything at all', () => {
    const people = [person('farmer', 40), person('doctor', 0)];
    boughtInTheVillage(people, people[0].id, 6, 'innkeeper');
    expect(people[1].purse).toBe(6);
  });

  it('lets it leave the valley where nobody here sells anything', () => {
    // the same honest leak `paidForService` has, and the reason a village with no market never
    // gets rich however long it is left in peace
    const people = [person('farmer', 40), person('soldier', 40)];
    expect(boughtInTheVillage(people, people[0].id, 6, 'innkeeper')).toBe(6);
    expect(people[0].purse).toBe(34);
    expect(people[1].purse).toBe(40);
  });

  it('buys nothing at all on a purse that will not cover it', () => {
    const people = [person('farmer', 2), person('innkeeper', 0)];
    expect(boughtInTheVillage(people, people[0].id, 6, 'innkeeper')).toBe(0);
    expect(people[0].purse).toBe(2);
  });

  it('never has somebody buy a drink off themselves', () => {
    const people = [person('innkeeper', 40), person('farmer', 0)];
    expect(boughtInTheVillage(people, people[0].id, 6, 'innkeeper')).toBe(6);
    expect(people[0].purse, 'the innkeeper drank at his own bar and paid himself').toBe(34);
  });
});

/**
 * The rule that decides whether any of this is worth doing: **a trade has to clear what it costs.**
 *
 * Asked for in so many words on 2026-09-11 — if a villager pays for a market pitch, they have to
 * make more than the pitch back, or hunting and farming are a way of getting poorer; and if they
 * hunt to eat instead, the food has to be worth more than the day it took. Either way there is a
 * profit in it, or nobody with any sense would do the work.
 *
 * The game failed this outright when it was asked. A hunter cleared **nineteen hundredths of a
 * coin a day** against a soldier's one and a third, while his own behaviour tree had him spend
 * forty gold on gear — two hundred days of hunting to afford kit, in a life of ninety. And the
 * farmer failed it from the other side: he cleared six and a half and was charged nothing at all
 * for turning what he grew into money.
 *
 * The cause was one line. A village grows forty-six meals a day and eats twenty-six, and the
 * cellar capped: twenty meals a day went on the ground, every day, in every village, for the whole
 * life of the game. Hunting did not pay because a hunter's product was free.
 */
describe('every trade clears what a day costs it', () => {
  /** A village big enough to hold one of everything, at a day when its cellar has filled. */
  const working = (): Person[] => [
    person('farmer', 60), person('farmer', 60), person('hunter', 60), person('hunter', 60),
    person('seller', 60), person('innkeeper', 60), person('doctor', 60), person('soldier', 60),
    person('miner', 60), person('constable', 60), person('sailor', 60), person('explorer', 60),
    person('climber', 60), person(''), person(''), person(''), person(''),
  ];

  /** What a day pays each of them, with the cellar full — which is where a village lives. */
  const aDay = (people: Person[]) => {
    const herd = LIVELIHOOD.HERD_PER_FARMER * people.filter((p) => p.trade === 'farmer').length;
    return aDaysIncome(people, herd, 0, cellarCap(people));
  };

  it('leaves nobody in the village worse off for having worked', () => {
    const people = working();
    const income = aDay(people);
    for (const soul of people.filter((p) => p.trade)) {
      const costs = spentOnLiving(soul) + pitchFor(soul) + FOOD.MEAL;
      const takes = income.get(soul.id) ?? 0;
      expect(takes, `a ${soul.trade} takes ${takes.toFixed(2)} and a day costs ${costs.toFixed(2)}`)
        .toBeGreaterThan(costs);
    }
  });

  it('pays the trades that sell for a living more than selling costs them', () => {
    // the user's own arithmetic: a pitch is only worth taking if what you sell off it beats it
    const people = working();
    const income = aDay(people);
    for (const soul of people.filter((p) => pitchFor(p) > 0)) {
      expect(income.get(soul.id) ?? 0).toBeGreaterThan(pitchFor(soul) * 2);
    }
  });

  it('leaves no trade so far ahead of the rest that the others are pointless', () => {
    // the other half of the rule. A spread is the point — a village with a market should be worth
    // walking to — but a trade paying ten times another is a game with one job in it
    const people = working();
    const income = aDay(people);
    const takes = people.filter((p) => p.trade).map((p) => income.get(p.id) ?? 0);
    expect(Math.max(...takes) / Math.min(...takes)).toBeLessThan(8);
  });

  it('feeds a hunter who never sells a thing', () => {
    /*
     * The other way of making a profit, and the one that needs no market at all: hunt to eat.
     * What he carries out of the woods has to beat what the day costs him in food, or a man with
     * an empty purse starves beside a wood full of deer.
     */
    const hunter = person('hunter', 0);
    expect(broughtIn(hunter)).toBeGreaterThan(FOOD.MEAL);
    // and it has to beat what anybody manages without leaving their own garden, or hunting is a
    // long walk for what a few hens would have given him
    expect(broughtIn(hunter)).toBeGreaterThan(broughtIn(person('soldier', 0)));
  });

  it('is why a village grows more than it eats: the surplus is the wage', () => {
    const people = working();
    const grown = aDaysTrade(people, LIVELIHOOD.HERD_PER_FARMER * 2, 0).grown;
    expect(grown, 'a village that grows only what it eats has nothing to sell').toBeGreaterThan(people.length);
    // and it is worth something, which for the whole life of the game it was not
    expect(FOOD.ABROAD).toBeGreaterThan(0);
  });
});

/**
 * A hunter selling to whoever actually wants it.
 *
 * Asked for on 2026-09-11: villagers should buy and sell between each other, so a hunter can sell
 * his meat to anybody, hungry villagers included. The buyer used to be ranked by trade and then by
 * purse, which made every sale in a village a sale to the richest person in it — a hunter walked a
 * deer past somebody who had not eaten in a fortnight and sold it to the man behind the stall.
 */
describe('who buys the deer', () => {
  it('is the hungriest man who can pay, when what is carried is dinner', () => {
    const people = [person('hunter', 0), person('seller', 500), person('farmer', 40)];
    people[2].hungry = 12;
    soldAtMarket(people, people[0].id, 7, 'meat');
    expect(people[2].purse, 'the deer went to the man with the deepest purse').toBeLessThan(40);
    expect(people[1].purse).toBe(500);
  });

  it('feeds him, because that is what he bought it for', () => {
    const people = [person('hunter', 0), person('farmer', 40)];
    people[1].hungry = 12;
    soldAtMarket(people, people[0].id, 7, 'meat');
    expect(people[1].hungry, 'he bought a dinner and stayed hungry').toBe(0);
  });

  it('lets a starving man spend his last coins on it', () => {
    // nobody keeps a week of dinners back against the dinner in front of him
    const people = [person('hunter', 0), person('farmer', 3)];
    people[1].hungry = 20;
    expect(soldAtMarket(people, people[0].id, 7, 'meat')).toBe(3);
    expect(people[1].hungry).toBe(0);
  });

  it('still goes to the trade that deals in it when it is not dinner', () => {
    // a pelt is stock, and stock goes to whoever deals in it however hungry anybody else is
    const people = [person('hunter', 0), person('seller', 500), person('farmer', 400)];
    people[2].hungry = 12;
    soldAtMarket(people, people[0].id, 26, 'pelt');
    expect(people[1].purse).toBe(474);
    expect(people[2].purse).toBe(400);
  });

  it('leaves a well-fed village trading the way it always did', () => {
    const people = [person('hunter', 0), person('seller', 500), person('farmer', 400)];
    soldAtMarket(people, people[0].id, 7, 'meat');
    expect(people[1].purse).toBe(493);
  });
});

/**
 * The list of things that are dinner, held to the catalogue the game actually ships.
 *
 * The same rule `prosperity.test.ts` holds `TRADERS` to, and here for the same reason: a set naming
 * things that are not food, or missing things that are, is exactly how `TRADERS` came to name four
 * jobs nobody in this world can hold.
 */
describe('what counts as dinner', () => {
  it('names only things that exist and would feed somebody', () => {
    for (const id of DINNER) {
      const item = ITEMS[id];
      expect(item, `${id} is called dinner and is not a thing`).toBeDefined();
      expect(item.effect?.type, `${id} is called dinner and does not feed anybody`).toBe('heal');
    }
  });

  it('does not leave out the obvious ones', () => {
    for (const id of ['meat', 'bread']) expect(DINNER.has(id), `${id} is not dinner?`).toBe(true);
  });

  it('leaves out the things that heal but are not a meal', () => {
    // a potion mends you and is not somebody's tea; a hunter carrying one has not brought dinner in
    for (const id of ['potion', 'antidote', 'elixir']) expect(DINNER.has(id)).toBe(false);
  });
});

/**
 * What the hall takes, which is the first money in this world that is nobody's.
 *
 * `inheritance.ts` turned a village treasury down when it went in, and said why: there was nowhere
 * to bank it and nothing that could see or spend it. A hall is somewhere and a vote is something,
 * so there is a pot now — and the rules it has to obey are the rules every other coin here obeys.
 *
 * The one that is new: what the hall holds is not a person's, so nobody inherits it. A mayor who
 * dies leaves it exactly where it was for whoever is elected next. That is the whole difference
 * between a treasury and a rich man, and it is the reason the money sits on the settlement rather
 * than on whoever is holding the chain of office.
 */
describe('the hall\'s share', () => {
  const villager = (id: string, purse: number): Person =>
    ({ id, name: id, trade: 'farmer', purse, born: 1, lives: 60, hungry: 0, knows: [], memories: 0 } as unknown as Person);

  it('takes nothing from anybody who has only their reserve', () => {
    // `KEEPS_BACK` is a week of dinners. A village that taxes its people into starving has
    // mistaken the point of having a village
    const poor = [villager('a', 0), villager('b', PROSPER.KEEPS_BACK), villager('c', PROSPER.KEEPS_BACK - 1)];
    const tax = taxedForTheHall(poor);
    expect(tax.raised).toBe(0);
    expect(tax.owed.size).toBe(0);
  });

  it('takes a share of what is spare, and never dips into the reserve', () => {
    const person = villager('a', PROSPER.KEEPS_BACK + 100);
    const tax = taxedForTheHall([person]);
    expect(tax.raised).toBeCloseTo(100 * LIVELIHOOD.TAX, 2);
    expect(person.purse + (tax.owed.get('a') ?? 0), 'somebody was taxed below their week of dinners')
      .toBeGreaterThanOrEqual(PROSPER.KEEPS_BACK);
  });

  it('adds up: what leaves the purses is what the hall receives', () => {
    /*
     * The rule this whole economy is held to — a coin leaving one purse arrives in another — and
     * the reason a tax is not a new machine at all. It is another entry in the same map of who
     * gains and who loses that a day of trading already produces.
     */
    const people = [villager('a', 40), villager('b', 7), villager('c', 300), villager('d', 2)];
    const tax = taxedForTheHall(people);
    const lost = [...tax.owed.values()].reduce((sum, n) => sum + n, 0);
    expect(-lost).toBeCloseTo(tax.raised, 6);
  });

  it('is the same answer asked twice, because asking is not taking', () => {
    const people = [villager('a', 40)];
    expect(taxedForTheHall(people)).toEqual(taxedForTheHall(people));
    expect(people[0].purse, 'asking what was owed collected it').toBe(40);
  });
});
