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

  /*
   * An oath to work a village already has somebody for is spent, rather than standing beside them.
   * This used to read the other way — the traveller was kept in the directory next to the villager
   * doing the same job — and the swearing-in refuses that case anyway, so the only way to reach it
   * is a village that came to have its own afterwards. See `directoryOf`.
   */
  it('is spent where the village already has somebody doing that work', () => {
    const here = directoryOf(['farmer'], [who('a', 'farmer')],
      [{ trade: 'farmer', who: 'Ash', day: 4 }]);
    expect(here.holding.get('farmer'), 'the villager is the one doing it').toEqual(['a']);
    expect(here.sworn).toEqual([]);
  });

  it('is ignored when it names work this ground does not support at all', () => {
    const here = directoryOf(['farmer'], [], [{ trade: 'fisherman', who: 'Ash', day: 4 }]);
    expect(here.nobodyDoing).toEqual(['farmer']);
    expect(here.sworn).toEqual([]);
  });
});

describe('swearing in at the hall', () => {
  /*
   * A village founded on more trades than it has people for, so there is genuinely work going
   * begging. On four trades it fills all four and every case below passes without taking an oath —
   * which is what the first version of this file did, and why the assertion it made was the wrong
   * shape as well as too weak.
   */
  const TRADES = ['farmer', 'seller', 'builder', 'doctor', 'smith', 'climber', 'innkeeper', 'fisherman'];
  const settled = (): Register => {
    const book = new Register(7, 1);
    book.settle('Ashford', 6, TRADES);
    return book;
  };

  it('takes a trade the village has nobody for, and closes the vacancy', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    expect(vacancy, 'the fixture is founded on more trades than it can staff').toBeDefined();
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
    expect(vacancy).toBeDefined();
    expect(book.swearIn('Ashford', vacancy, 'Ash')).not.toBeNull();
    expect(book.swearIn('Ashford', vacancy, 'Rook')).toBeNull();
  });

  /*
   * The reason it is kept rather than derived. A village founded again is lived from its seed, and
   * a traveller who walked in off the road is exactly what a seed cannot predict.
   */
  /*
   * The reason it is kept rather than derived. A village founded again is lived from its seed, and
   * a traveller who walked in off the road is exactly what a seed cannot predict — so the oath has
   * to be on the other side of the re-founding, unless that founding happened to raise somebody
   * into the work, in which case it is spent.
   */
  it('survives the village being founded again', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    expect(vacancy).toBeDefined();
    book.swearIn('Ashford', vacancy, 'Ash');
    book.foundOn('Ashford', 6, [...TRADES, 'sailor']);

    const after = book.directoryOf('Ashford');
    const villagerTookIt = after.holding.has(vacancy);
    expect(villagerTookIt || after.sworn.some((one) => one.who === 'Ash'),
      'either the village has its own now or the oath is still standing').toBe(true);
    expect(after.nobodyDoing, 'and either way nobody is short of it').not.toContain(vacancy);
  });

  /*
   * And what swearing in is actually for. The mayor fills what the village is short of; work a
   * traveller has taken is not short, so the next adult is raised into something else.
   */
  /*
   * And nobody at all takes it afterwards — not by enrolment, not by a roll, not by following a
   * parent. The first version of this asserted `grown.length === 0 || nobodyDoing`, which is two
   * different claims joined by an `or` and is satisfied by either: it passed while children were
   * being raised into the very trade somebody had sworn to. Asked directly now.
   */
  it('stops anybody being raised into work the traveller took, by any of the three ways', () => {
    const book = settled();
    const vacancy = book.directoryOf('Ashford').nobodyDoing[0];
    expect(vacancy, 'this village was chosen because it has a vacancy to take').toBeDefined();
    book.swearIn('Ashford', vacancy, 'Ash');

    // a hundred mornings of children coming of age, which is enrolment, the roll and inheritance
    for (let day = 2; day <= 100; day++) book.advance(day);

    expect(book.living('Ashford').filter((person) => person.trade === vacancy).map((one) => one.name),
      'the oath buys nothing if the village goes on raising its own into the same work').toEqual([]);
    expect(book.directoryOf('Ashford').sworn.map((one) => one.who)).toContain('Ash');
  });

  /*
   * And the one case where a villager does end up with it. A village is re-founded from its seed
   * when somebody walks over the hill and takes on an emptied one, and that founding rolls every
   * trade afresh. Taking the sworn trades out of *that* roll would mean an oath re-rolled the whole
   * population — a stranger thing than the one it fixes — so the villager wins and the oath is
   * spent. The post is not vacant any more, which is the truthful reading of it.
   */
  it('lapses when the village comes to have its own', () => {
    const here = directoryOf(['farmer', 'doctor'], [who('a', 'farmer'), who('b', 'doctor')],
      [{ trade: 'doctor', who: 'Ash', day: 4 }]);
    expect(here.sworn, 'a village with its own doctor is not short of one').toEqual([]);
    expect(here.holding.get('doctor')).toEqual(['b']);
    expect(here.nobodyDoing).toEqual([]);
  });
});
