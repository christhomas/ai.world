import { describe, expect, it } from 'vitest';
import { HIRE, Hires, meansOf, quoteFor, wordsFor, type Quote, ORDERS } from './hire';
import type { Person } from '../world/people';
import type { Village } from '../world/structures';

/** As much of a village as the price of a sword arm depends on. */
type Place = Pick<Village, 'houses' | 'stalls' | 'pub'>;

const place = (houses: number, stalls = 0, pub = false): Place => ({
  houses: Array.from({ length: houses }, () => ({} as Village['houses'][number])),
  stalls: Array.from({ length: stalls }, () => [0, 0] as [number, number]),
  pub: pub ? ({} as Village['pub']) : null,
});

const hamlet = place(HIRE.POOREST);
const town = place(HIRE.RICHEST, 2, true);

type Villager = Pick<Person, 'id' | 'name' | 'trade'>;
const soldier = (n: number): Villager => ({ id: `Oakford-${n}`, name: `Soldier ${n}`, trade: 'soldier' });

/** The first soldier in a world who will actually come, since a good many of them will not. */
const willing = (seed: number, where: Place = hamlet): { person: Villager; quote: Quote } => {
  for (let n = 0; n < 200; n++) {
    const person = soldier(n);
    const quote = quoteFor(seed, person, where);
    if (quote) return { person, quote };
  }
  throw new Error('nobody in this world will come');
};

/** What every soldier in a world is asking, for comparing two worlds or two villages. */
const priceList = (seed: number, where: Place): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let n = 0; n < 60; n++) {
    const quote = quoteFor(seed, soldier(n), where);
    if (quote) out[quote.who] = quote.asking;
  }
  return out;
};

describe('what a soldier asks', () => {
  it('is the same figure however often it is asked, and in whichever order', () => {
    const { person } = willing(7);
    expect(quoteFor(7, person, town)).toEqual(quoteFor(7, person, town));

    // a second player walks the same street from the other end: order must change nothing
    const forwards = priceList(7, town);
    const backwards: Record<string, number> = {};
    for (let n = 59; n >= 0; n--) {
      const quote = quoteFor(7, soldier(n), town);
      if (quote) backwards[quote.who] = quote.asking;
    }
    expect(backwards).toEqual(forwards);
    expect(Object.keys(forwards).length).toBeGreaterThan(0);
  });

  it('is a different figure in the next world along', () => {
    const here = priceList(7, town);
    const there = priceList(8, town);
    const same = Object.keys(here).filter((who) => there[who] === here[who]);
    expect(Object.keys(here).length).toBeGreaterThan(10);
    expect(same.length).toBeLessThan(Object.keys(here).length * 0.5);
  });

  it('is less in a village with one street than in a town with a market and a pub', () => {
    const { person } = willing(7);
    const poor = quoteFor(7, person, hamlet)!;
    const rich = quoteFor(7, person, town)!;

    expect(poor.asking).toBeLessThan(rich.asking);
    expect(poor.asking).toBeGreaterThanOrEqual(1);
    expect(meansOf(hamlet)).toBe(0);
    expect(meansOf(town)).toBeCloseTo(1);
    expect(meansOf(place(4, 1, false))).toBeGreaterThan(meansOf(place(4)));
    // and the whole village is cheaper, not merely this one man
    const cheap = Object.values(priceList(7, hamlet));
    const dear = Object.values(priceList(7, town));
    const average = (list: number[]) => list.reduce((sum, n) => sum + n, 0) / list.length;
    expect(average(cheap)).toBeLessThan(average(dear));
  });

  it('buys a bigger cut of the takings the dearer the man is', () => {
    const { person } = willing(7);
    const poor = quoteFor(7, person, hamlet)!;
    const rich = quoteFor(7, person, town)!;
    const cutOf = (quote: Quote) => quote.terms[quote.terms.length - 1].share;

    expect(cutOf(rich)).toBeGreaterThan(cutOf(poor));
    expect(cutOf(poor)).toBeGreaterThanOrEqual(HIRE.SHARE_LEAST);
    expect(cutOf(rich)).toBeLessThanOrEqual(HIRE.SHARE_MOST);
    // every quote offers coin now, a bit of each, or nothing now and a larger cut
    expect(rich.terms.map((t) => t.fee)).toEqual([rich.asking, Math.round(rich.asking * HIRE.EACH_WAY), 0]);
    expect(rich.terms[0].share).toBe(0);
    expect(wordsFor(rich.terms[0])).toBe(`${rich.asking} gold, all of it now`);
    expect(wordsFor(rich.terms[2])).toContain('nothing now');
  });

  it('is asked of soldiers only, and not of every soldier', () => {
    expect(quoteFor(7, { id: 'Oakford-1', name: 'Piet Vos', trade: 'farmer' }, town)).toBeNull();
    expect(quoteFor(7, { id: 'Oakford-1', name: 'Piet Vos', trade: '' }, town)).toBeNull();

    const asked = 60;
    const coming = Object.keys(priceList(7, town)).length;
    expect(coming).toBeGreaterThan(0);
    expect(coming).toBeLessThan(asked);          // somebody has to watch the gate
  });
});

describe('the bargain', () => {
  it('is refused when the purse will not cover the fee, and costs nothing', () => {
    const { quote } = willing(7, town);
    const upFront = quote.terms[0];
    const hires = new Hires();

    expect(hires.strike(quote, upFront, upFront.fee - 1, 'you')).toBeNull();
    expect(hires.all).toEqual([]);
    expect(hires.has(quote.who)).toBe(false);
    expect(hires.divide(100, 'you').paid).toBe(0);

    // and the same man on the same terms with the money in hand is a bargain
    expect(hires.strike(quote, upFront, upFront.fee, 'you')?.fee).toBe(upFront.fee);
  });

  it('cannot be struck twice with the same man', () => {
    const { quote } = willing(7, town);
    const onShares = quote.terms[2];
    const hires = new Hires();

    expect(hires.strike(quote, onShares, 500, 'you')).not.toBeNull();
    expect(hires.strike(quote, onShares, 500, 'you')).toBeNull();
    expect(hires.strike(quote, onShares, 500, 'somebody else')).toBeNull();
    expect(hires.roster('you').length).toBe(1);
    expect(hires.roster('somebody else')).toEqual([]);
  });

  it('takes no more men than anybody will walk with', () => {
    const hires = new Hires();
    const terms = { fee: 0, share: HIRE.SHARE_LEAST };
    for (let n = 0; n < HIRE.MOST; n++) {
      expect(hires.strike({ who: `s${n}`, name: `Soldier ${n}`, asking: 20, terms: [] }, terms, 500, 'you')).not.toBeNull();
    }
    expect(hires.strike({ who: 'one too many', name: 'Rolf Bos', asking: 20, terms: [] }, terms, 500, 'you')).toBeNull();
    expect(hires.roster('you').length).toBe(HIRE.MOST);
    // and the limit is one side's, not the world's
    expect(hires.strike({ who: 'theirs', name: 'Hild Smit', asking: 20, terms: [] }, terms, 500, 'them')).not.toBeNull();
  });

  it('reads back in a line, however many are at your shoulder', () => {
    const hires = new Hires();
    const terms = { fee: 0, share: HIRE.SHARE_LEAST };
    expect(hires.describe('you')).toBe('nobody at your shoulder');
    hires.strike({ who: 's1', name: 'Greta Vos', asking: 20, terms: [] }, terms, 500, 'you');
    expect(hires.describe('you')).toBe('Greta Vos at your shoulder');
    hires.strike({ who: 's2', name: 'Rolf Bos', asking: 20, terms: [] }, terms, 500, 'you');
    expect(hires.describe('you')).toBe('Greta Vos and Rolf Bos at your shoulder');
  });
});

describe('the split', () => {
  const bought = (share: number, side = 'you', who = 's1', name = 'Greta Vos') =>
    ({ quote: { who, name, asking: 20, terms: [] } as Quote, terms: { fee: 0, share }, side });

  it('pays out exactly, and the odd penny stays with whoever won it', () => {
    const hires = new Hires();
    const one = bought(0.15);
    hires.strike(one.quote, one.terms, 500, 'you');

    const payout = hires.divide(10, 'you');
    expect(payout.cuts).toEqual([{ who: 's1', name: 'Greta Vos', gold: 1 }]);   // 1.5 rounds down
    expect(payout.paid).toBe(1);

    const two = bought(0.35, 'you', 's2', 'Rolf Bos');
    hires.strike(two.quote, two.terms, 500, 'you');
    const both = hires.divide(10, 'you');
    expect(both.cuts.map((c) => c.gold)).toEqual([1, 3]);
    expect(both.paid).toBe(4);
    expect(both.cuts.reduce((sum, c) => sum + c.gold, 0)).toBe(both.paid);
  });

  it('never hands out more coin than came in, at any size of purse', () => {
    const hires = new Hires();
    for (let n = 0; n < HIRE.MOST; n++) {
      const man = bought(HIRE.SHARE_MOST, 'you', `s${n}`, `Soldier ${n}`);
      hires.strike(man.quote, man.terms, 500, 'you');
    }
    for (let gold = 0; gold <= 200; gold++) {
      const payout = hires.divide(gold, 'you');
      expect(payout.paid).toBeLessThanOrEqual(gold);
      expect(payout.cuts.reduce((sum, c) => sum + c.gold, 0)).toBe(payout.paid);
    }
    expect(hires.divide(-5, 'you').paid).toBe(0);
  });

  it('pays a man on a fee nothing further', () => {
    const hires = new Hires();
    hires.strike({ who: 's1', name: 'Greta Vos', asking: 30, terms: [] }, { fee: 30, share: 0 }, 500, 'you');
    expect(hires.divide(100, 'you')).toEqual({ cuts: [], paid: 0 });
  });

  it('stops paying a man the moment he is dead', () => {
    const hires = new Hires();
    const alive = bought(0.35, 'you', 's1', 'Greta Vos');
    const dead = bought(0.35, 'you', 's2', 'Rolf Bos');
    hires.strike(alive.quote, alive.terms, 500, 'you');
    hires.strike(dead.quote, dead.terms, 500, 'you');
    expect(hires.divide(100, 'you').paid).toBe(70);

    expect(hires.part('s2')?.name).toBe('Rolf Bos');
    expect(hires.has('s2')).toBe(false);
    expect(hires.divide(100, 'you')).toEqual({ cuts: [{ who: 's1', name: 'Greta Vos', gold: 35 }], paid: 35 });
    expect(hires.part('s2')).toBeNull();         // burying him twice changes nothing
  });

  it('keeps one side of a fight out of the other side of it', () => {
    const hires = new Hires();
    const mine = bought(0.35, 'you', 's1', 'Greta Vos');
    const theirs = bought(0.35, 'them', 's2', 'Rolf Bos');
    hires.strike(mine.quote, mine.terms, 500, 'you');
    hires.strike(theirs.quote, theirs.terms, 500, 'them');

    expect(hires.divide(100, 'you').cuts.map((c) => c.who)).toEqual(['s1']);
    expect(hires.divide(100, 'them').cuts.map((c) => c.who)).toEqual(['s2']);
    expect(hires.fightingFor('s2')).toBe('them');
    expect(hires.fightingFor('nobody')).toBe('');
    expect(hires.all.length).toBe(2);
  });
});

describe('what a hired man does with his day', () => {
  it('follows the hire while the bargain holds, and his own trade before and after', () => {
    const hires = new Hires();
    expect(hires.follows('s1', 'soldier')).toBe('soldier');

    hires.strike({ who: 's1', name: 'Greta Vos', asking: 20, terms: [] }, { fee: 0, share: 0.2 }, 500, 'you');
    expect(hires.follows('s1', 'soldier')).toBe(HIRE.TREE);
    expect(hires.follows('s2', 'farmer')).toBe('farmer');

    hires.part('s1');
    expect(hires.follows('s1', 'soldier')).toBe('soldier');
  });
});

/**
 * A hire is a contract, and a contract has a life.
 *
 * It did not, for the whole life of the game. You paid a man once and he walked with you until a
 * bear got him or you told him to go home, which made the fee a one-off purchase *of a person*
 * rather than a wage. What a term buys is that the money keeps mattering: a sword arm is an
 * expense you carry rather than a thing you own, so a long campaign costs more than a short one and
 * a season of fighting means going back to the table.
 *
 * Asked for in those words on 2026-09-11: the contract has a time limit; while it runs he follows
 * whoever owns it; when it runs out he offers an extension for a price, or he leaves.
 */
describe('the life of a contract', () => {
  const soldier = (who = 'a'): Quote => ({ who, name: `Soldier ${who}`, asking: 20, terms: [{ fee: 20, share: 0 }] });

  it('runs from the day it was struck, for a term', () => {
    const hires = new Hires();
    const bargain = hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10)!;
    expect(bargain.until).toBe(10 + HIRE.TERM);
  });

  it('holds while the days last and does not afterwards', () => {
    const hires = new Hires();
    hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10);
    expect(hires.holds('a', 10)).toBe(true);
    expect(hires.holds('a', 10 + HIRE.TERM - 0.5)).toBe(true);
    expect(hires.holds('a', 10 + HIRE.TERM)).toBe(false);
  });

  it('has him bring it up before the morning he would walk away', () => {
    // the first a player knows about it ending must not be an empty road behind them
    const hires = new Hires();
    hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10);
    expect(hires.nearlyUp('a', 10), 'he asked to be paid again on the first morning').toBe(false);
    expect(hires.nearlyUp('a', 10 + HIRE.TERM - HIRE.ASKS_AT)).toBe(true);
  });

  it('asks more to stay on than it cost to take him, and never less', () => {
    const hires = new Hires();
    const bargain = hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10)!;
    expect(hires.askingAgain(bargain)).toBeGreaterThan(bargain.fee);
  });

  it('runs a fresh term from today when he is kept on, not from the day it lapsed', () => {
    // renewed a week late is a week from now, and not a day and a half of it already gone
    const hires = new Hires();
    hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10);
    hires.extend('a', 20);
    expect(hires.holds('a', 20 + HIRE.TERM - 0.5)).toBe(true);
  });

  it('hands back whoever has served their days, and takes them off the books', () => {
    const hires = new Hires();
    hires.strike(soldier('a'), { fee: 20, share: 0 }, 500, 'you', 10);
    hires.strike(soldier('b'), { fee: 20, share: 0 }, 500, 'you', 40);
    const gone = hires.ranOut(10 + HIRE.TERM);
    expect(gone.map((b) => b.who), 'the wrong man went home').toEqual(['a']);
    expect(hires.has('a')).toBe(false);
    expect(hires.has('b'), 'a man with days left on his contract walked off').toBe(true);
  });

  it('says nobody ran out when nobody has', () => {
    const hires = new Hires();
    hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10);
    expect(hires.ranOut(11)).toEqual([]);
    expect(hires.has('a')).toBe(true);
  });

  it('cannot be kept on once he has gone, because he is not there to ask', () => {
    const hires = new Hires();
    hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 10);
    hires.ranOut(10 + HIRE.TERM);
    expect(hires.extend('a', 30)).toBeNull();
  });
});

/**
 * Telling a man in your pay what to do.
 *
 * The third part of the design, and the one that makes a hireling different in kind from every
 * other creature in the world: everything else acts on what it wants and what it notices, and this
 * one acts on what it has been *told*. That is the whole distinction between a villager and a man
 * in your pay.
 *
 * An order changes which branch of his tree he takes and not how he takes it. Told to hold he
 * still defends himself — the trouble branch is above the order branches on purpose — and told to
 * fight he still walks round a boulder rather than into it. He is not a remote control; the value
 * of him is that he has a tree of his own and goes on using it.
 */
describe('what a hired man has been told', () => {
  const soldier = (who = 'a'): Quote => ({ who, name: `Soldier ${who}`, asking: 20, terms: [{ fee: 20, share: 0 }] });
  const taken = (): Hires => {
    const hires = new Hires();
    hires.strike(soldier(), { fee: 20, share: 0 }, 500, 'you', 1);
    return hires;
  };

  it('is the standing arrangement until somebody says otherwise', () => {
    expect(taken().toldTo('a')).toBe(ORDERS.FOLLOW);
  });

  it('is remembered on the contract, so walking round a corner does not forget it', () => {
    // the body is despawned the moment you walk far enough off and built again later; an order
    // kept on the entity would last as long as the entity
    const hires = taken();
    expect(hires.tell('a', ORDERS.HOLD)).toBe(true);
    expect(hires.toldTo('a')).toBe(ORDERS.HOLD);
  });

  it('goes back to being nothing at all when he is told to follow again', () => {
    // one state for the standing arrangement rather than two: the absence of an instruction
    const hires = taken();
    hires.tell('a', ORDERS.FIGHT);
    hires.tell('a', ORDERS.FOLLOW);
    expect(hires.all[0].told).toBeUndefined();
    expect(hires.toldTo('a')).toBe(ORDERS.FOLLOW);
  });

  it('cannot be given to somebody who is not yours', () => {
    // a man takes instructions because he is being paid, and takes none the moment he is not
    const hires = taken();
    expect(hires.tell('somebody-else', ORDERS.HOLD)).toBe(false);
    expect(hires.toldTo('somebody-else')).toBe(ORDERS.FOLLOW);
  });

  it('is forgotten with the contract when his days are served', () => {
    const hires = taken();
    hires.tell('a', ORDERS.HOLD);
    hires.ranOut(1 + HIRE.TERM);
    expect(hires.tell('a', ORDERS.FIGHT), 'a man who has gone home took an order').toBe(false);
    expect(hires.toldTo('a')).toBe(ORDERS.FOLLOW);
  });
});
