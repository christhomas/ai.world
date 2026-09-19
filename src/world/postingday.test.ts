import { describe, expect, it } from 'vitest';
import { POST, theDaysPosts } from './postings';
import { THE_HALL_OWNER } from './holdings';
import type { Person } from './people';
import type { Settlement } from './settlement';
import { Register } from './register';

/**
 * A day's posts, stood and paid in the village's own day — #264.
 *
 * `postsToday` decides who and at what price and moves nothing. This is the half that moves it, and
 * it is here rather than in `tidings.ts` because that was on the page: the wages were handed over
 * inside the loop over the warbands, so a man's holding earned him nothing on any day nobody was
 * looking at it. A hero who closed the tab employed nobody until he opened it again.
 *
 * Built by hand rather than settled from a seed, because a real village turns out to hire in a
 * *ring* — five builders each standing the next one's yard, every purse netting to nought. That is
 * a fine thing for a village to do and a useless thing to test a wage against. One yard, one owner
 * who cannot build and one man who can, is the case where the money has somewhere to go.
 */

/**
 * A morning late enough that somebody born on day nought is grown.
 *
 * `postsToday` filters to `grownUp(person, day)` — a nine-year-old on a gate with a dragon overhead
 * is not a thing a village does — so a test that names an early day is a test in which nobody can
 * stand anything at all. `crewpost.test.ts` sidesteps it by naming no day and taking `Infinity`;
 * this one names a real one, because the day is what the register hands over.
 */
const GROWN_BY = 100;

const who = (id: string, trade: string, purse = 500): Person =>
  ({ id, trade, purse, born: 0 } as Person);

/** A village with one yard in it, and whatever people are named. */
const village = (people: Person[], owner: string): ReadonlyMap<string, Settlement> => new Map([
  ['Ashford', {
    people,
    holdings: [{ id: 'y1', kind: 'yard', house: '', owner, worker: owner, founded: 1 }],
    hall: { id: THE_HALL_OWNER, purse: 1000 },
  } as unknown as Settlement],
]);

/** A book that remembers what it was told, which is all `theDaysPosts` asks of one. */
const aBook = () => {
  const rows = new Map<string, number>();
  return { rows, post: (id: string, much: number) => rows.set(id, (rows.get(id) ?? 0) + much) };
};

describe('the posts a village stands on one morning', () => {
  it('pays the man who stood it out of the purse of the man who owns it', () => {
    const rich = who('rich', 'seller');
    const bob = who('bob', 'builder');
    const book = aBook();

    theDaysPosts(village([rich, bob], 'rich'), () => 0, GROWN_BY, book);

    expect(bob.purse, 'the builder was not paid').toBe(500 + POST.BUILDER);
    expect(rich.purse, 'the yard was built for nothing').toBe(500 - POST.BUILDER);
    expect(book.rows.get('bob')).toBe(POST.BUILDER);
    expect(book.rows.get('rich')).toBe(-POST.BUILDER);
  });

  /*
   * The conservation the economy bench squares against. Nothing is minted and nothing is burnt: a
   * wage is one purse's loss and another's gain, on the same morning, in the same village.
   */
  it('makes no money and loses none', () => {
    const rich = who('rich', 'seller');
    const bob = who('bob', 'builder');
    const book = aBook();
    const before = rich.purse + bob.purse;

    theDaysPosts(village([rich, bob], 'rich'), () => 0, GROWN_BY, book);

    expect(rich.purse + bob.purse).toBe(before);
    expect([...book.rows.values()].reduce((sum, much) => sum + much, 0)).toBe(0);
  });

  /*
   * A man standing his own yard is not paying himself. The old two-purse hand-over did this by
   * arriving at the same purse twice and cancelling; this skips it, so nothing lands in the book
   * that a reader would have to know to ignore.
   */
  it('moves nothing where the man working it is the man who owns it', () => {
    const bob = who('bob', 'builder');
    const book = aBook();

    const stood = theDaysPosts(village([bob], 'bob'), () => 0, GROWN_BY, book);

    expect(stood.get('Ashford')?.map((post) => post.kind), 'he is still working it').toContain('crew');
    expect(bob.purse, 'he paid himself').toBe(500);
    expect(book.rows.size).toBe(0);
  });

  /*
   * And a holding the hall owns pays nobody, exactly as it did not before. `payAndSweep` would
   * happily take the wage out of the hall's purse now that the paying goes through it — which would
   * be a change to *what* happens on the same morning as a change to *where*. Whether the hall
   * should pay for a man on its own farm is a question for its own issue.
   */
  it('leaves a hall-owned holding paying nobody, as it did before', () => {
    const bob = who('bob', 'builder');
    const book = aBook();

    theDaysPosts(village([bob], THE_HALL_OWNER), () => 0, GROWN_BY, book);

    expect(bob.purse).toBe(500);
    expect(book.rows.size).toBe(0);
  });

  /*
   * And the gate, which is the half that *is* about what is overhead. Nought pressure is nought
   * wage, so a village at peace mans no gate and charges no farmer for one.
   */
  it('mans a gate only when something is leaning on the place', () => {
    const farmer = who('giles', 'farmer');
    const idle = who('idle', '');
    const farm = (): ReadonlyMap<string, Settlement> => new Map([
      ['Ashford', {
        people: [farmer, idle],
        holdings: [{ id: 'f1', kind: 'farm', house: '', owner: 'giles', worker: 'giles', founded: 1 }],
        hall: { id: THE_HALL_OWNER, purse: 1000 },
      } as unknown as Settlement],
    ]);

    const atPeace = theDaysPosts(farm(), () => 0, GROWN_BY, aBook());
    expect(atPeace.get('Ashford')?.map((post) => post.kind)).not.toContain('guard');

    const underADragon = theDaysPosts(farm(), () => 1, GROWN_BY, aBook());
    expect(underADragon.get('Ashford')?.map((post) => post.kind)).toContain('guard');
  });
});

/**
 * And the whole of why it moved: a day away pays what a day present would have paid.
 *
 * Nothing in this describe touches `tidings.ts`, a frame, a band or a page. A register is settled
 * and told to catch up, which is exactly what happens when somebody opens a save that has been shut
 * for a fortnight — and what used to happen on those mornings was nothing at all, because the only
 * thing that ever called `postsToday` was the page's own loop over the warbands.
 */
describe('a village left to itself', () => {
  const settled = (): Register => {
    const book = new Register(7);
    book.settle('Stonedale', 6, ['farmer', 'hunter', 'seller', 'builder']);
    for (let day = 2; day <= 20; day++) book.advance(day);
    // enough to lay out a wage: `LAYS_OUT` is a fifth of a purse against a twelve-gold day
    for (const person of book.living('Stonedale')) person.purse = 500;
    return book;
  };

  it('stands its posts on a day nobody was watching', () => {
    const book = settled();
    expect(book.postsOn('Stonedale'), 'it had posts before it could afford any').toEqual([]);

    book.advance(21);

    const hired = book.postsOn('Stonedale').filter((post) => post.who !== post.funder);
    expect(hired.length, 'nobody was employed on a day nobody saw').toBeGreaterThan(0);
  });

  /*
   * What this village cannot show, and where it is shown instead.
   *
   * Its builders hire each other — five yards in a ring, each man both a payer and a payee — so
   * every purse nets to nought and the book, which keeps a net per person, reads nought for all of
   * them. The wages really did move; the ring is what hides it. That a wage lands in the right
   * purse is held above, on a village built to have exactly one hiring in it.
   *
   * What a ring *can* show is the thing the economy bench cares about: that a morning of it makes
   * no money.
   */
  it('makes none doing it', () => {
    const book = settled();
    book.advance(21);
    const net = book.living('Stonedale')
      .reduce((sum, person) => sum + book.postedTo(person.id), 0);
    expect(net, 'a wage was minted or burnt').toBeCloseTo(0, 6);
  });

  it('makes no money doing it, however many days go by unwatched', () => {
    const book = settled();
    const before = book.living('Stonedale').reduce((sum, person) => sum + (person.purse ?? 0), 0);
    for (let day = 21; day <= 30; day++) book.advance(day);
    const after = book.living('Stonedale').reduce((sum, person) => sum + (person.purse ?? 0), 0);
    /*
     * Not equal — a village lives while it is left alone, and its people earn, eat and pay tax. What
     * is held is that it is still a village and not a mint: the roll has not run away to the cap,
     * which is what an unbalanced wage paid every morning for ten mornings would do.
     */
    expect(Number.isFinite(after)).toBe(true);
    expect(after, 'ten unwatched days minted a fortune').toBeLessThan(before * 4);
  });
});

/**
 * And a village that came to exist the other way still says what it stood.
 *
 * `standPostsIn` is called from two places — `advance`, which walks a village forward a day at a
 * time, and the catch-up inside `settle`, which founds one and lives it to today in one go. Both
 * pay. Only the first used to *publish*, and `posted` is a map keyed by village name, so the gap
 * had two shapes: a village founded late answered `[]` to `postsOn` until the next morning, and a
 * village re-lived kept the entry belonging to the village it replaced.
 *
 * The second is the one with teeth. `tidings.ts` asks `postsOn` what the men on the gates turned
 * back, so a dragon could be counted against posts belonging to a village that no longer exists.
 */
describe('a village founded into a world that is already old', () => {
  const settledAt = (day: number): Register => {
    const book = new Register(7, day);
    book.settle('Ashford', 6, ['farmer', 'hunter', 'seller', 'builder']);
    return book;
  };

  it('says what it stood on the morning it caught up to', () => {
    const book = settledAt(120);
    expect(book.postsOn('Ashford'), 'it lived a hundred and twenty days and admits to nothing')
      .not.toEqual([]);
  });

  it('stands the same posts either way it came to exist', () => {
    const forward = new Register(7, 1);
    forward.settle('Ashford', 6, ['farmer', 'hunter', 'seller', 'builder']);
    for (let day = 2; day <= 120; day++) forward.advance(day);

    const atOnce = settledAt(120);

    expect(atOnce.postsOn('Ashford').map((post) => `${post.kind}:${post.holding}:${post.who}`))
      .toEqual(forward.postsOn('Ashford').map((post) => `${post.kind}:${post.holding}:${post.who}`));
  });
});

/**
 * Who is already spoken for, asked about the morning being worked — #360.
 *
 * `halljobs.ts` must not offer a day of the hall's work to a man already standing somebody's gate.
 * The page used to be handed the posts of the morning *before*: it read them off the register and
 * then told it to live the day, and every morning of a catch-up but the last got nothing at all. A
 * death or a change in pressure moves a post between days, so the advice was about the wrong one.
 *
 * Safe to ask because `postsToday` decides who and at what price and **moves nothing** — the
 * paying still happens once, where the day is lived.
 */
describe('who a village has already spoken for', () => {
  const settled = (): Register => {
    const book = new Register(7);
    book.settle('Stonedale', 6, ['farmer', 'hunter', 'seller', 'builder']);
    for (let day = 2; day <= 20; day++) book.advance(day);
    for (const person of book.living('Stonedale')) person.purse = 500;
    return book;
  };

  it('answers for a morning that has not been lived yet', () => {
    const book = settled();
    const ahead = book.whoIsSpokenFor(21).get('Stonedale') ?? [];
    expect(ahead.length, 'nobody was named for a morning the village can afford').toBeGreaterThan(0);
  });

  /*
   * The whole point of it being safe to ask: it is a reading, not an act. Asking a hundred times
   * must leave every purse exactly where asking once did.
   */
  it('moves no money, however often it is asked', () => {
    const book = settled();
    const before = book.living('Stonedale').map((person) => person.purse ?? 0);
    for (let i = 0; i < 100; i++) book.whoIsSpokenFor(21);
    expect(book.living('Stonedale').map((person) => person.purse ?? 0)).toEqual(before);
    expect(book.living('Stonedale').every((person) => book.postedTo(person.id) === 0),
      'a reading wrote into the day book').toBe(true);
  });

  /*
   * And it is about the morning it names, which needs a world that differs between two mornings to
   * say anything at all. A man who dies is that difference: he can be posted on the morning he is
   * alive and cannot be on the one after.
   */
  it('names a man on the morning he is alive and not on the one after', () => {
    const book = settled();
    const posted = (day: number) => new Set(
      (book.whoIsSpokenFor(day).get('Stonedale') ?? []).map((post) => post.who),
    );

    const doomed = [...posted(21)][0];
    expect(doomed, 'nobody was posted to begin with').toBeDefined();
    expect(posted(21).has(doomed)).toBe(true);

    book.bury(doomed, 21);

    expect(posted(22).has(doomed), 'a buried man was still named for a later morning').toBe(false);
  });

  /*
   * And the day itself is read, not merely passed along.
   *
   * Most of the answer comes from the state of the village at the moment of asking, so a burial
   * shows up whatever day is named. The one thing the *day argument* decides on its own is the
   * pressing: `pressure.on` is `told + 1 === day`, so a band reported on the twentieth is felt on
   * the twenty-first and on no other morning. A gate manned on the right morning and bare on the
   * next is the day being read.
   */
  it('reads the day it was given, which is what decides whether a gate is manned', () => {
    const book = settled();
    // somebody to stand it: a guard is taken from the soldiers and the untraded
    book.living('Stonedale')[0].trade = '';
    book.leanedOn('Stonedale', 1);    // told on the twentieth, felt on the twenty-first

    const kinds = (day: number) =>
      (book.whoIsSpokenFor(day).get('Stonedale') ?? []).map((post) => post.kind);

    expect(kinds(21), 'nothing was manned on the morning the band was overhead').toContain('guard');
    expect(kinds(22), 'the gate was still manned a day after the band was reported')
      .not.toContain('guard');
  });
});
