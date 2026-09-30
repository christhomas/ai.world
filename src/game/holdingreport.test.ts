import { describe, expect, it } from 'vitest';
import { HoldingBook } from '../world/holdingbook';
import { ownerFromSave, type Holding } from '../world/holdings';
import { holdingReport } from './holdingreport';
import { GameState } from './state';
import { Register } from '../world/register';

const owner = ownerFromSave('Ashford:arrived:Rowan');
const holdings: Holding[] = [
  { id: 'yard-1', kind: 'yard', house: '', owner, worker: '', founded: 2 },
  { id: 'farm-2', kind: 'farm', house: '', owner, worker: '', founded: 3 },
  { id: 'farm-other', kind: 'farm', house: '', owner: ownerFromSave('Other'), worker: '', founded: 3 },
];
const book = () => {
  const held = new HoldingBook();
  held.stood('Ashford', 5, [{ day: 5, holding: 'yard-1', kind: 'crew', who: 'Bob',
    funder: owner, wage: 12, paid: 12 }], new Map());
  held.stood('Ashford', 6, [{ day: 6, holding: 'yard-1', kind: 'crew', who: owner,
    funder: owner, wage: 12, paid: 0 }], new Map());
  held.stood('Ashford', 5, [{ day: 5, holding: 'farm-other', kind: 'guard', who: 'Ada',
    funder: ownerFromSave('Other'), wage: 8, paid: 8 }], new Map());
  return held;
};

describe('the hall report for returning holding owners', () => {
  it('separates multiple holdings, empty work, and wages that did or did not move coin', () => {
    const held = book();
    const before = held.on('yard-1');
    const pages = holdingReport('Ashford', owner, holdings, held, 4, 7, (id) => id);
    expect(pages[0]).toContain('2 holdings');
    expect(pages.join(' ')).toContain('yard-1: 2 mornings of work');
    expect(pages.join(' ')).toContain('24 gold in wages; 12 gold changed hands');
    expect(pages.join(' ')).toContain('Day 6: crew');
    expect(pages.join(' ')).toContain('no coin moved');
    expect(pages.join(' ')).toContain('farm-2: no work was recorded');
    expect(pages.join(' ')).not.toContain('farm-other');
    expect(held.on('yard-1'), 'reading the report changed the daybook').toEqual(before);
  });

  it('shows recorded farm takings beside a quiet yard and does not invent shop income', () => {
    const held = book();
    held.earned('Ashford', [{ type: 'income', day: 5, holding: 'farm-2', owner, cattle: 2.16, crop: 1.24 }]);
    held.earned('Ashford', [{ type: 'income', day: 6, holding: 'farm-2', owner, cattle: 0, crop: 0 }]);
    const pages = holdingReport('Ashford', owner, holdings, held, 4, 7, (id) => id).join(' ');
    expect(pages).toContain('farm-2: no work was recorded');
    expect(pages).toContain('3.4 gold in owner takings');
    expect(pages).toContain('2.16 gold from cattle');
    expect(pages).toContain('1.24 gold from crops');
    expect(pages).toContain('Day 5: farm earned');
    expect(pages).not.toContain('farm-other');
    expect(held.incomeOn('farm-2')).toHaveLength(2);
  });

  it('separates wages from owner takings when the same farm has both', () => {
    const held = book();
    held.stood('Ashford', 5, [{ day: 5, holding: 'farm-2', kind: 'crew', who: 'Hand',
      funder: owner, wage: 8, paid: 8 }], new Map());
    held.earned('Ashford', [{ type: 'income', day: 5, holding: 'farm-2', owner, cattle: 2, crop: 1 }]);
    const pages = holdingReport('Ashford', owner, holdings, held, 4, 5, (id) => id).join(' ');
    expect(pages).toContain('farm-2: 1 morning of work');
    expect(pages).toContain('3 gold in owner takings');
    expect(pages).toContain('Owner takings are listed separately below');
    expect(pages).not.toContain('not crop or shop takings');
  });

  it('shows only unread mornings and keeps a full-history route', () => {
    const held = book();
    const unread = holdingReport('Ashford', owner, holdings, held, 5, 7, (id) => id).join(' ');
    expect(unread).toContain('yard-1: 1 morning of work');
    expect(unread).not.toContain('Day 5:');
    const all = holdingReport('Ashford', owner, holdings, held, 0, 7, (id) => id).join(' ');
    expect(all).toContain('Day 5: crew');
    expect(holdingReport('Ashford', ownerFromSave('Nobody'), holdings, held, 0, 7, (id) => id))
      .toEqual(['The hall of Ashford has no holdings in your name.']);
  });

  it('reports a same-day repeat as no new mornings', () => {
    const held = book();
    const firstVisit = holdingReport('Ashford', owner, holdings, held, 5, 6, (id) => id).join(' ');
    expect(firstVisit).toContain('1 morning of work');
    const secondVisit = holdingReport('Ashford', owner, holdings, held, 6, 6, (id) => id).join(' ');
    expect(secondVisit).toContain('No new mornings have passed since day 6.');
    expect(secondVisit).toContain('yard-1: no new mornings of work');
    expect(secondVisit).not.toContain('from day 7 through day 6');
  });

  it('persists the read day without changing any economic state', () => {
    const state = GameState.fresh();
    state.holdingReadAt.set('Ashford', 7);
    const resumed = GameState.from(state.toJSON());
    expect(resumed.holdingReadAt.get('Ashford')).toBe(7);
    expect(resumed.holdingReadAt.get('Blackby')).toBeUndefined();
    expect(resumed.inventory.gold).toBe(state.inventory.gold);
  });

  /*
   * Everything above hands the report a book written by hand, so none of it can see whether the
   * register ever writes a row the report would find. This is the whole road instead: a hero walks
   * into a village with a vacancy, swears to farming, is founded a farm by the ordinary morning's
   * work, lives a month on it, and asks the hall — with the owner found the way `interact/village.ts`
   * finds him and the holdings and the book read off the register the way it reads them. #484.
   *
   * Seed 11 and these trades are `heroholdings.test.ts`'s, which already holds that the farm is
   * founded and is his: a two-house village naming more trades than it has people to fill.
   */
  it('reads a sworn farmer\'s own farm out of the register that lived it', () => {
    const register = new Register(11, 1);
    register.settle('Ashford', 2, ['farmer', 'seller', 'doctor', 'smith', 'miner', 'sailor', 'builder', 'fisherman']);
    register.arrive('Ashford', 'Rowan', 'man', 40);
    expect(register.swearIn('Ashford', 'farmer', 'Rowan'), 'farming was not vacant').not.toBeNull();
    for (let day = 2; day <= 30; day++) register.advance(day);

    const hero = register.living('Ashford').find((person) => person.name === 'Rowan');
    expect(hero, 'the hero is not on the roll').toBeDefined();
    const holdings = register.madeOf('Ashford').holdings ?? [];
    const farm = holdings.find((one) => one.kind === 'farm' && one.owner === hero!.id);
    expect(farm, 'no farm was founded in the hero\'s name').toBeDefined();
    const takings = register.holdingsBook.incomeOn(farm!.id).filter((row) => row.owner === hero!.id);
    expect(takings.length, 'the register wrote no income for his farm').toBeGreaterThan(0);
    const total = takings.reduce((sum, row) => sum + row.cattle + row.crop, 0);
    expect(total, 'his farm earned him nothing in a month').toBeGreaterThan(0);

    const pages = holdingReport('Ashford', hero!.id, holdings, register.holdingsBook, 0, 30,
      (id) => register.find(id)?.name ?? id).join(' ');
    expect(pages).toContain('1 holding in your name in Ashford');
    expect(pages).toContain(`farm ${farm!.id}: ${Math.round(total * 100) / 100} gold in owner takings`);
    expect(pages).not.toContain(`farm ${farm!.id}: no owner income was recorded`);
  });
});
