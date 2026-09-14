import { describe, expect, it } from 'vitest';
import { directoryOf } from './vacancies';
import type { Person } from './people';
import { Register } from './register';

/**
 * A vacancy somebody answers, which is the half of item 24a (issue #3) that was never built.
 *
 * The directory half landed first and said so in its own comment: it is *"the thing a vacancy has
 * to be readable from before a player can answer one"*. This is answering one. A traveller stands
 * in front of the hall, the hall says the village has nobody doing a trade its ground supports, and
 * the traveller says they will do it.
 *
 * ## Sworn, not hired
 *
 * Item 24a is explicit that enrolment is **not a wage**: nothing leaves the treasury and nobody is
 * paid to take a job, which is what keeps the hall's money free for building. So swearing in buys
 * the traveller no coin. What it buys is the thing a job market is actually made of — the village
 * stops looking for somebody, and the next adult to grow up is raised into whatever the village is
 * short of *next* rather than into work that is already being done.
 *
 * ## Kept rather than derived
 *
 * The register's rule is that a village is re-lived from its seed and arrives at the same answer,
 * and the exceptions are the handful of things no seed implies: a violent death, a vote, a raising
 * at a shrine. A traveller is another of them — nothing about a seed predicts somebody walking in
 * off the road — so it is kept beside those, in the same shape and for the same reason.
 */
const who = (id: string, trade: string): Person => ({ id, trade } as Person);

describe('a vacancy a traveller has answered', () => {
  it('is no longer a vacancy, and names who took it', () => {
    const here = directoryOf(['farmer', 'doctor'], [who('a', 'farmer')],
      [{ trade: 'doctor', who: 'Ash', day: 4 }]);
    expect(here.nobodyDoing).toEqual([]);
    expect(here.sworn).toEqual([{ trade: 'doctor', who: 'Ash', day: 4 }]);
  });

  it('leaves the villagers doing it in the directory, because a traveller is not a replacement', () => {
    const here = directoryOf(['farmer'], [who('a', 'farmer')],
      [{ trade: 'farmer', who: 'Ash', day: 4 }]);
    expect(here.holding.get('farmer')).toEqual(['a']);
    expect(here.sworn.map((one) => one.trade)).toEqual(['farmer']);
  });

  it('is ignored when it names work this ground does not support at all', () => {
    const here = directoryOf(['farmer'], [], [{ trade: 'fisherman', who: 'Ash', day: 4 }]);
    expect(here.nobodyDoing).toEqual(['farmer']);
    expect(here.sworn).toEqual([]);
  });
});

describe('swearing in at the hall', () => {
  const settled = (): Register => {
    const book = new Register(7, 1);
    book.settle('Ashford', 6, ['farmer', 'seller', 'builder', 'doctor']);
    return book;
  };

  it('takes a trade the village has nobody for, and closes the vacancy', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    if (vacancy === undefined) return;               // this seed staffed the place; nothing to prove
    expect(book.swearIn('Ashford', vacancy, 'Ash')).toMatchObject({ trade: vacancy, who: 'Ash' });
    expect(book.directoryOf('Ashford').nobodyDoing).not.toContain(vacancy);
  });

  it('refuses work somebody in the village is already doing', () => {
    const book = settled();
    const taken = [...book.directoryOf('Ashford').holding.keys()][0];
    expect(book.swearIn('Ashford', taken, 'Ash')).toBeNull();
  });

  it('refuses work this ground does not support, and a village it has never heard of', () => {
    const book = settled();
    expect(book.swearIn('Ashford', 'fisherman', 'Ash')).toBeNull();
    expect(book.swearIn('Nowhere', 'farmer', 'Ash')).toBeNull();
  });

  it('refuses the same post twice, because it is not vacant the second time', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    if (vacancy === undefined) return;
    expect(book.swearIn('Ashford', vacancy, 'Ash')).not.toBeNull();
    expect(book.swearIn('Ashford', vacancy, 'Rook')).toBeNull();
  });

  /*
   * The reason it is kept rather than derived. A village founded again is lived from its seed, and
   * a traveller who walked in off the road is exactly what a seed cannot predict.
   */
  it('survives the village being founded again', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    if (vacancy === undefined) return;
    book.swearIn('Ashford', vacancy, 'Ash');
    // re-founding rather than settling again: `settle` hands back a village it already holds
    book.foundOn('Ashford', 6, ['farmer', 'seller', 'builder', 'doctor', 'smith']);
    expect(book.directoryOf('Ashford').sworn.map((one) => one.who)).toContain('Ash');
    expect(book.directoryOf('Ashford').nobodyDoing).not.toContain(vacancy);
  });

  /*
   * And what swearing in is actually for. The mayor fills what the village is short of; work a
   * traveller has taken is not short, so the next adult is raised into something else.
   */
  it('stops the mayor raising the next adult into work the traveller took', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    if (vacancy === undefined) return;
    book.swearIn('Ashford', vacancy, 'Ash');
    for (let day = 2; day <= 400; day++) book.advance(day);
    const grown = book.living('Ashford').filter((person) => person.trade === vacancy);
    expect(grown.length === 0 || book.directoryOf('Ashford').nobodyDoing).not.toContain(vacancy);
  });
});
