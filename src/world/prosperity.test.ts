import { describe, expect, it } from 'vitest';
import { TRADES } from '../entities/trades';
import { FOOD } from './food';
import { PROSPER, TRADERS, earnedInADay, feeFor, luxuryFor, saidOfWealth, spentOnLiving, storeysFor } from './prosperity';
import type { Person } from './people';

const person = (trade: string): Person => ({
  id: 'x', name: 'Maren', village: 'Ashford', trade, born: -30, lives: 70,
  mother: '', father: '', knows: [], memories: [], opinions: [], purse: 0, hungry: 0,
});

/**
 * Money went into the economy and nothing ever came of it: a villager's purse lived on the entity
 * in the street and emptied the moment the player walked away. These pin the rules that make a
 * village's wealth something that accumulates, that the player can protect, and that shows.
 */
describe('what a village is worth', () => {
  it('pays the trades that handle everybody else money best', () => {
    expect(earnedInADay(person('seller'), 0)).toBeGreaterThan(earnedInADay(person('soldier'), 0));
  });

  /**
   * The better-paid trades have to be trades somebody can actually be.
   *
   * This is here because they were not. The set read shopkeeper, innkeeper, smith, apothecary and
   * merchant — the names of a village's *shops* — and four of those five are not jobs the game
   * hands anybody, so the higher wage reached one innkeeper per village and ten of the eleven
   * trades in the world were paid the same floor. Nothing failed, nothing looked wrong, and the
   * wage table had no shape for as long as it took a bench to add the money up.
   */
  it('names trades a villager can actually be given, and not the names of shops', () => {
    const real = TRADES.map((trade) => trade.id);
    expect(TRADERS.filter((trade) => !real.includes(trade))).toEqual([]);
    expect(TRADERS.length).toBeGreaterThan(1);
  });

  it('pays a child nothing, because a trade is what starts a purse', () => {
    expect(earnedInADay(person(''), 0)).toBe(0);
  });

  it('stops the money entirely while the place is being raided', () => {
    expect(earnedInADay(person('innkeeper'), 0.9)).toBe(0);
    expect(earnedInADay(person('innkeeper'), 0)).toBeGreaterThan(0);
  });

  it('puts a second storey on a house once its owner can afford one', () => {
    expect(storeysFor(0)).toBe(1);
    expect(storeysFor(PROSPER.STOREY - 1)).toBe(1);
    expect(storeysFor(PROSPER.STOREY)).toBe(2);
  });

  it('builds nothing grand until the whole village can afford it between them', () => {
    expect(luxuryFor(PROSPER.STOREY, 1)).toBe('none');
    expect(luxuryFor(PROSPER.LUXURY, 0)).not.toBe('none');
  });

  it('charges a visitor for the luxury and nothing for a village without one', () => {
    expect(feeFor('none')).toBe(0);
    expect(feeFor('sauna')).toBeGreaterThan(0);
  });

  it('describes a village rather than quoting a number at anybody', () => {
    expect(saidOfWealth(0, 10)).toContain('poor');
    expect(saidOfWealth(PROSPER.STOREY * 20, 10)).toContain('very well');
  });

  it('takes a real stretch of quiet days to build anything', () => {
    // a fortnight of peace should not turn a farmer into a landlord — and this is his whole wage,
    // before he has eaten anything out of it
    expect(storeysFor(earnedInADay(person('farmer'), 0) * 14)).toBe(1);
  });
});

/**
 * A working purse climbs, and it never comes to rest.
 *
 * The bug this pins was arithmetic and invisible: upkeep was eight tenths of a coin against a wage
 * of one and a half, so an ordinary day cost three tenths more than it paid, and the only thing
 * standing between a village and starvation was `KEEPS_BACK` — which stops the spending as the
 * purse runs down and so hands the day back exactly the difference. Every working purse in the
 * world converged on 6.5 and held it: the bench measured the middle villager of three untroubled
 * villages sitting on exactly that for the last 87 days of a hundred, on all three seeds. Nothing
 * a villager earned ever bought anything, because nothing a villager earned ever stayed.
 *
 * So this lives a purse forward the way `register.ts` does — earn, then upkeep, then dinner — and
 * asks the one question the shape of the thing turns on: is he better off in the spring than he
 * was in the winter.
 *
 * The purse followed here is a soldier's, and it used to be a farmer's. That is not a tidy-up: a
 * farmer's income stopped being this file's business the day the four livelihoods went in. What he
 * takes is his neighbours' money — his share of what the village paid for the dinner he grew — and
 * `earnedInADay` is now only the part of a wage that arrives from beyond the valley. A soldier is
 * the trade this question is still about, because his pay off the road is the whole of what he
 * gets. The same hundred days asked of a farmer, in a village with people in it to sell to, is in
 * `livelihoods.test.ts`, which is where it now belongs.
 */
describe('a hundred quiet days in one purse', () => {
  /** One day in the order the register lives it: what he takes, what he spends, then what he eats. */
  const aDay = (soul: Person): void => {
    soul.purse = Math.max(0, soul.purse + earnedInADay(soul, 0) - spentOnLiving(soul));
    if (soul.purse >= FOOD.MEAL) soul.purse -= FOOD.MEAL;
  };
  const lived = (trade: string, days: number, from = 0): number => {
    const soul = { ...person(trade), purse: from };
    for (let day = 0; day < days; day++) aDay(soul);
    return soul.purse;
  };

  it('leaves an ordinary working day worth having', () => {
    expect(PROSPER.A_DAY - FOOD.MEAL - PROSPER.UPKEEP).toBeGreaterThan(0);
  });

  it('is worth more to a soldier at a hundred days than at fifty', () => {
    expect(lived('soldier', 100)).toBeGreaterThan(lived('soldier', 50) + 10);
  });

  it('does not settle at the reserve, from below it or from above it', () => {
    for (const from of [0, PROSPER.KEEPS_BACK, PROSPER.KEEPS_BACK + PROSPER.UPKEEP * 2, 200]) {
      expect(lived('soldier', 60, from)).toBeGreaterThan(PROSPER.KEEPS_BACK + 20);
    }
  });

  it('rewards the trades that serve everybody else several times over, not half again', () => {
    // the wage is half again; what is left after a day has cost what it costs is far more than that
    expect(lived('seller', 60)).toBeGreaterThan(lived('soldier', 60) * 2);
  });
});

/**
 * A purse that only ever fills is a savings account, not a circulation — and a village of people
 * who never spend anything cannot get poorer for any reason except being killed.
 */
describe('what a life costs beyond dinner', () => {
  const withPurse = (purse: number, trade = 'farmer') => ({ ...person(trade), purse });

  it('takes something out of a working purse every day', () => {
    expect(spentOnLiving(withPurse(200))).toBeGreaterThan(0);
  });

  it('never spends somebody down to nothing', () => {
    // going hungry to buy a new hat is not a thing people do, and a village that did it would
    // starve itself the first quiet week
    const poor = withPurse(PROSPER.KEEPS_BACK);
    expect(spentOnLiving(poor)).toBe(0);
    const nearly = withPurse(PROSPER.KEEPS_BACK + 0.3);
    expect(spentOnLiving(nearly)).toBeLessThanOrEqual(0.3);
  });

  it('asks nothing of a child', () => {
    expect(spentOnLiving(withPurse(500, ''))).toBe(0);
  });

  it('costs less than a working day earns, or nobody could ever get ahead', () => {
    // asked of a soldier for the same reason as above: what a farmer earns is his neighbours'
    // money and is settled in `livelihoods.ts`, so `earnedInADay` is nought for him by design
    expect(spentOnLiving(withPurse(500))).toBeLessThan(earnedInADay(person('soldier'), 0));
  });
});
