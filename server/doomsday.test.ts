import { describe, expect, it } from 'vitest';
import { Register } from '../src/world/register';
import { doomsdayOf, type Surveyed } from './doomsday';
import type { Village } from '../src/world/structures';

/**
 * The survey, and the one thing it has that a page's roster cannot have.
 *
 * A page holds villagers as guests: the world simulates them, so what any of them is presently
 * doing is a field on an entity standing in a street *here* and is not on the wire. That is the
 * whole reason this lives on the server, and it is the first thing tested — a book that could have
 * been compiled on a client would not have been worth writing.
 */

const village = (name: string, x: number, z: number, houses = 9): Village =>
  ({ name, x, z, houses: Array.from({ length: houses }, () => ({})) } as unknown as Village);

/** A world with two villages in it, lived far enough forward to have families and money. */
function surveyed(seed = 4, day = 60): Surveyed {
  const register = new Register(seed, day);
  const villages = [village('Ashford', 0, 0), village('Oakcross', 400, 120)];
  for (const v of villages) {
    register.settle(v.name, v.houses.length, ['farmer', 'hunter', 'seller', 'soldier', 'miner']);
  }
  return { seed, day, villages, register };
}

describe('the survey', () => {
  it('counts every soul in every village, not only the ones near somebody', () => {
    const book = doomsdayOf(surveyed());
    expect(book.parishes.length).toBe(2);
    expect(book.souls).toBe(book.parishes.reduce((n, p) => n + p.souls, 0));
    expect(book.souls).toBeGreaterThan(10);
  });

  it('leaves out a village the world has not founded yet, rather than founding it to look', () => {
    /*
     * A deliberate limit, and the honest one. Founding a village is the register's own act — it
     * lives the place from its first day to today — and doing that for every village in a seed
     * because somebody opened a survey would be a survey with a bill attached. What the book holds
     * is what the world holds; a village comes into it the moment anybody goes there, which is the
     * same moment it comes into existence for everybody else.
     */
    const seed = 11;
    const register = new Register(seed, 40);
    const book = doomsdayOf({ seed, day: 40, villages: [village('Farhaven', 900, 900)], register });
    expect(book.parishes).toEqual([]);
    expect(book.souls).toBe(0);
  });

  it('says what each of them earns and what the day costs them', () => {
    const book = doomsdayOf(surveyed());
    const grown = book.parishes.flatMap((p) => p.people).filter((s) => s.trade !== '');
    expect(grown.length).toBeGreaterThan(0);
    for (const soul of grown) {
      expect(soul.spends, `a working ${soul.trade} pays nothing for anything`).toBeGreaterThan(0);
      expect(soul.earns).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads hunger as hearts, the same number the bar over their head draws', () => {
    const world = surveyed();
    const [hungry] = world.register.living('Ashford');
    hungry.hungry = 20;
    const book = doomsdayOf(world);
    const found = book.parishes.flatMap((p) => p.people).find((s) => s.id === hungry.id)!;
    expect(found.hungry).toBe(20);
    expect(found.hearts).toBeLessThan(60);
    expect(found.starving, 'four hearts down and the book says he is fine').toBe(true);
  });

  it('says what a village holds: its purses, its larder and its cattle', () => {
    const book = doomsdayOf(surveyed());
    const ashford = book.parishes.find((p) => p.name === 'Ashford')!;
    expect(ashford.worth).toBeGreaterThan(0);
    expect(ashford.larder).toBeGreaterThan(0);
    expect(ashford.herd).toBeGreaterThan(0);
    expect(ashford.fortune.length).toBeGreaterThan(0);
  });
});

describe('what only the world can say', () => {
  it('says what somebody is doing, for the people it has on their feet', () => {
    /*
     * The point of the whole exercise. `doing` is written by the branch of a behaviour tree that
     * claimed the last tick and it is not on the wire, so a page can show it for its own hired men
     * and for nobody else. Here it is a field on a body standing in a street.
     */
    const world = surveyed();
    const [first, second] = world.register.living('Ashford');
    const crowd = {
      within: () => [
        { person: first.id, doing: 'with the cattle', x: 3.14, z: -2.71 },
        { person: second.id, doing: 'selling a kill', x: 0, z: 0 },
        { person: '', doing: 'grazing', x: 9, z: 9 },
      ],
    } as unknown as Surveyed['crowd'];

    const book = doomsdayOf({ ...world, crowd });
    const people = book.parishes.flatMap((p) => p.people);
    expect(people.find((s) => s.id === first.id)?.doing).toBe('with the cattle');
    expect(people.find((s) => s.id === first.id)?.at).toEqual({ x: 3.1, z: -2.7 });
    expect(book.standing, 'a creature with no person was counted as a soul').toBe(2);
  });

  it('leaves the rest blank rather than guessing at them', () => {
    // most of a world is nowhere near anybody and has no body at all. Saying nothing is the honest
    // answer; inventing an activity from a trade and the hour would be a second opinion about a
    // branch that never ran
    const book = doomsdayOf(surveyed());
    expect(book.standing).toBe(0);
    for (const soul of book.parishes.flatMap((p) => p.people)) {
      expect(soul.doing).toBe('');
      expect(soul.at).toBeUndefined();
    }
  });
});

describe('the shape of the book', () => {
  it('puts the biggest villages first, and never depends on the order they were listed', () => {
    const book = doomsdayOf(surveyed());
    const sizes = book.parishes.map((p) => p.souls);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it('changes nothing about the world it surveys', () => {
    const world = surveyed();
    const before = world.register.living('Ashford').map((p) => `${p.id}:${p.purse}:${p.hungry}`);
    doomsdayOf(world);
    doomsdayOf(world);
    expect(world.register.living('Ashford').map((p) => `${p.id}:${p.purse}:${p.hungry}`)).toEqual(before);
  });
});
