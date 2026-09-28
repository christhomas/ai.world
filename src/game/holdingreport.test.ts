import { describe, expect, it } from 'vitest';
import { HoldingBook } from '../world/holdingbook';
import { ownerFromSave, type Holding } from '../world/holdings';
import { holdingReport } from './holdingreport';
import { GameState } from './state';

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
});
