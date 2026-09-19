import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { isTheHall } from './holdings';

/**
 * The hero holds a farm, a yard, a boat — #263.
 *
 * The issue expected this to be wiring: all three sorts already existed in `holdings.ts`,
 * `foundAHolding` already took an owner, and *"the only thing missing is that the hero is not a
 * `Person` — which #260 fixes."*
 *
 * It turned out not even to be wiring. `whatTheVillageHolds` walks `village.people` and founds a
 * holding for anybody who can work one and is not already working one; once #260 put the hero on
 * the roll he was simply one of those people, and he has been holding farms ever since without
 * anything being written to make him. `shareTheTake` reads `living` off the same roll, so he is
 * paid out of the same pool by the same line.
 *
 * Which is the best possible outcome and the worst possible position to leave it in: **nothing in
 * the suite said so.** A holding for the hero is the load-bearing edge between a player and this
 * economy — #264 hangs its postings off it — and it was resting entirely on a `for` loop not
 * happening to exclude him. Any reasonable-looking guard added to that loop would have taken it
 * away, silently, and the only thing that would have noticed is a player wondering where his farm
 * went.
 *
 * So this file is the issue's own "done when", written down as tests rather than as a change.
 */

/** Trades a village names but has too few people to fill, so there is work to swear to. */
const TRADES = ['farmer', 'seller', 'doctor', 'smith', 'miner', 'sailor', 'builder', 'fisherman'];

/** A village with vacancies in it, and no hero yet. */
const village = (houses = 2): Register => {
  const book = new Register(11, 1);
  book.settle('Ashford', houses, TRADES);
  return book;
};

/** The hero, walked in and sworn to a trade that holds something. */
const heroSworn = (trade: string, houses = 2): Register => {
  const book = village(houses);
  book.arrive('Ashford', 'Rowan', 'man', 40);
  expect(book.swearIn('Ashford', trade, 'Rowan'), `${trade} was not vacant`).not.toBeNull();
  return book;
};

const hero = (book: Register) => book.living('Ashford').find((person) => person.name === 'Rowan');
const holdingsOf = (book: Register) => book.madeOf('Ashford').holdings ?? [];
/*
 * What one person works, which is this file's own question and now nobody else's.
 *
 * `holdings.ts` used to export a `workedBy` reader for exactly this, and nothing in the game ever
 * called it — so this test wrote the filter out longhand rather than import it, because importing
 * it would have been the one thing that made `reachable.test.ts` notice the dead export. #372
 * deleted it: no panel, clerk, record or survey in this game asks a person what he works, and the
 * nearest thing that does — `whoFoundsAnother` — wants the first one and a `find`, not a list.
 *
 * So this is no longer a copy of anything. It is four holdings and a village, filtered where it is
 * read.
 */
const worked = (book: Register, who: string) => holdingsOf(book).filter((one) => one.worker === who);
const live = (book: Register, to: number): void => { for (let day = 2; day <= to; day++) book.advance(day); };

describe('a hero who has sworn to a trade that holds something', () => {
  it('holds one, and it is in what the village holds', () => {
    const book = heroSworn('farmer');
    live(book, 30);
    const mine = worked(book, hero(book)!.id);
    expect(mine.map((one) => one.kind)).toEqual(['farm']);
  });

  it('owns it rather than merely working it, so it is his and not the hall\'s', () => {
    const book = heroSworn('farmer');
    live(book, 30);
    const farm = worked(book, hero(book)!.id)[0];
    expect(isTheHall(farm.owner), 'the hall is holding the hero\'s farm for him').toBe(false);
    expect(farm.owner).toBe(hero(book)!.id);
  });

  it('holds a yard when what he swore to was building', () => {
    const book = heroSworn('builder');
    live(book, 30);
    expect(worked(book, hero(book)!.id).map((one) => one.kind)).toEqual(['yard']);
  });

  /*
   * The limit the issue named, and it is a rule rather than a gap: `possibleHere` asks the village
   * what it has built, and a boat wants a jetty. A hero cannot hold one in a village that has no
   * water works, however faithfully he swore to fish.
   */
  it('holds no boat in a village with no jetty, which is the rule and not a gap', () => {
    const book = heroSworn('fisherman');
    live(book, 30);
    expect(book.worksOf('Ashford'), 'this village was not supposed to have a jetty').not.toContain('jetty');
    expect(worked(book, hero(book)!.id)).toEqual([]);
  });
});

/**
 * And that the money reaches him by the ordinary door.
 *
 * *"his holding pays him through `livelihoods.ts`, not through a special case"* is the middle line
 * of the issue's "done when", and the only way to hold it is to pay somebody else the same way and
 * compare. `shareTheTake` treats an owner who is not on the roll as the hall, so a hero who did not
 * count as living would quietly hand his day's take to the village and keep the wage — which is a
 * failure that looks exactly like a farm that is not very profitable.
 */
describe('what a hero\'s holding pays him', () => {
  const overSixtyDays = (book: Register): number => {
    const before = new Map(book.living('Ashford').map((person) => [person.id, person.purse ?? 0]));
    live(book, 60);
    const holder = book.living('Ashford').find(
      (person) => worked(book, person.id).some((one) => one.kind === 'farm'),
    );
    expect(holder, 'nobody in this village ended up holding a farm').toBeDefined();
    return (holder!.purse ?? 0) - (before.get(holder!.id) ?? 0);
  };

  it('is what the same farm pays a villager, rather than nothing or a wage', () => {
    /*
     * Both villages are the same seed and the same trades; they differ in who ends up farming.
     * A villager's farm made 6.2 to 6.3 over these days and the hero's made 7.0 — the difference
     * being that his is his village's only farm, where theirs is one of four sharing a pool. Held
     * loosely on purpose: what is being defended is that he is paid *by the same rule*, and pinning
     * the coin would make this a test of the farming constants instead.
     */
    const villagers = overSixtyDays(village(6));
    const player = overSixtyDays(heroSworn('farmer'));
    expect(villagers, 'a villager\'s farm should make him something').toBeGreaterThan(0);
    expect(player, 'the hero\'s farm pays him nothing').toBeGreaterThan(0);
    expect(player).toBeGreaterThan(villagers / 4);
    expect(player).toBeLessThan(villagers * 4);
  });

  it('does not fall to the hall, because he counts as living', () => {
    const book = heroSworn('farmer');
    live(book, 30);
    const farm = worked(book, hero(book)!.id)[0];
    // `shareTheTake` reads the roll: an owner it cannot find there is the hall, and the day's take
    // goes to the village with the worker left on a hired man's wage.
    expect(book.living('Ashford').map((person) => person.id)).toContain(farm.owner);
  });
});

/**
 * And across a re-living, which is the third line and the one with teeth.
 *
 * `relive` deletes the village and founds it again from the seed, carrying over only memories,
 * opinions and hurt — so anything not implied by the seed has to be *told* back or it stops
 * existing. The hero is not implied by any seed. His arrival and his oath are replayed, and his
 * holding is not replayed at all: it is founded again, from the roll, by the same morning's work
 * that founded it the first time. Which is the right answer, and is only the right answer because
 * he is on the roll to be found.
 */
describe('a hero\'s holding across a re-living', () => {
  it('comes back to the same owner after the village lives a day again', () => {
    const book = heroSworn('farmer');
    live(book, 30);
    const was = worked(book, hero(book)!.id);
    expect(was.map((one) => one.kind)).toEqual(['farm']);

    (book as unknown as { relive: (village: string) => void }).relive('Ashford');
    expect(hero(book), 'the hero did not survive the re-living').toBeDefined();
    expect(hero(book)!.trade, 'his oath did not survive it either').toBe('farmer');

    book.advance(31);
    const now = worked(book, hero(book)!.id);
    expect(now.map((one) => one.kind), 'his farm did not come back').toEqual(['farm']);
    expect(now[0].owner).toBe(was[0].owner);
  });

  /*
   * The id is deliberately not held. Holdings are numbered in the order they are founded, and a
   * re-lived village founds them in whatever order that morning's people come up — so pinning
   * `Ashford-farm-1` would be pinning the order rather than the ownership, and it would fail for a
   * reason nobody playing could see. What matters is that the same man owns the same sort of thing.
   */
  it('is the same sort in the same village, whatever number it is given', () => {
    const book = heroSworn('farmer');
    live(book, 30);
    (book as unknown as { relive: (village: string) => void }).relive('Ashford');
    book.advance(31);
    const farm = worked(book, hero(book)!.id)[0];
    expect(farm.kind).toBe('farm');
    expect(farm.worker).toBe(hero(book)!.id);
  });
});
