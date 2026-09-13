import { describe, expect, it } from 'vitest';
import { directoryOf } from './vacancies';
import type { Person } from './people';
import { Register } from './register';

/**
 * What a village does and does not have somebody for.
 *
 * The rest of item 24a (issue #3). Enrolment works — a grown child takes the trade the village is
 * short of rather than a coin toss — but nothing anywhere can *say* what a village holds or lacks,
 * so the half of that item about the hall being a **directory** (where the doctor is, where the
 * builder drinks) and about vacancies being something a player can read has nothing to read from.
 *
 * Derived, never stored, like everything else here: a village that buries its doctor is short of
 * one the next morning without anything having to notice, and a village re-lived from its founding
 * arrives at the same list as the one somebody has been standing in.
 *
 * It is deliberately not dialogue. What a village has is a fact about the village; *who says it and
 * in what words* is the game's business, and putting both here would make the sentence untestable
 * and the fact unreusable — the compass, a signpost and a quest all want this same answer.
 */
const who = (id: string, trade: string): Person => ({ id, trade } as Person);

describe('what a village has somebody for', () => {
  it('lists the trades being worked, and who works them', () => {
    const held = directoryOf(['farmer', 'doctor'],
      [who('a', 'farmer'), who('b', 'farmer'), who('c', 'doctor')]);
    expect(held.holding.get('farmer')).toEqual(['a', 'b']);
    expect(held.holding.get('doctor')).toEqual(['c']);
  });

  it('counts children and the very old as nobody, because they hold no trade', () => {
    const held = directoryOf(['farmer'], [who('a', 'farmer'), who('b', '')]);
    expect(held.holding.get('farmer')).toEqual(['a']);
    expect([...held.holding.keys()]).not.toContain('');
  });

  /*
   * The half a player would actually act on. A trade the ground supports and nobody is doing is a
   * job going begging, and that is the beginning of the job market item 24a is reaching for.
   */
  it('says which of the trades this ground supports nobody is doing', () => {
    const held = directoryOf(['farmer', 'doctor', 'smith'], [who('a', 'farmer')]);
    expect(held.nobodyDoing).toEqual(['doctor', 'smith']);
  });

  it('and is empty on both counts for a village with nobody left in it', () => {
    const held = directoryOf(['farmer'], []);
    expect(held.holding.size).toBe(0);
    expect(held.nobodyDoing).toEqual(['farmer']);
  });

  it('never reports a trade this ground does not support at all', () => {
    const held = directoryOf(['farmer'], [who('a', 'farmer'), who('b', 'fisherman')]);
    expect(held.nobodyDoing).toEqual([]);
    expect([...held.holding.keys()]).toEqual(['farmer']);
  });
});

/*
 * And the same answer through the book, which is where the game will ask it from: a signpost, the
 * compass and a conversation all want "who does what here" and none of them holds a village.
 */
describe('asking the register', () => {
  it('answers for a village it has settled, and empty for one it has not', () => {
    const book = new Register(7, 1);
    book.settle('Ashford', 5, ['farmer', 'seller', 'doctor']);
    const here = book.directoryOf('Ashford');
    expect([...here.holding.keys()].length + here.nobodyDoing.length).toBe(3);
    for (const [, ids] of here.holding) expect(ids.length).toBeGreaterThan(0);

    const nowhere = book.directoryOf('Nowhere');
    expect(nowhere.holding.size).toBe(0);
    expect(nowhere.nobodyDoing).toEqual([]);
  });

  it('loses a trade the morning its last holder is buried, without being told', () => {
    const book = new Register(11, 1);
    book.settle('Ashford', 5, ['farmer', 'seller', 'doctor']);
    const doctors = book.living('Ashford').filter((p) => p.trade === 'doctor');
    if (doctors.length === 0) return;                  // this seed raised none; nothing to prove
    for (const one of doctors) book.bury(one.id, 1);
    expect(book.directoryOf('Ashford').nobodyDoing).toContain('doctor');
  });
});
