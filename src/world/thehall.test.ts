import { describe, expect, it } from 'vitest';
import { Register } from './register';
import { bodyOfTheHall, whatTheHallKnows } from './hall';
import { homesOf } from './homes';
import { THE_HALL_OWNER } from './holdings';
import { surnameOf } from './people';
import type { Structure } from './structures';

/**
 * What a village hall could tell you, if you walked up and asked it.
 *
 * Item 89 (issue #25): the treasury is an entity, and its first body is the mayor's house. A later
 * vote may move that body to another building (#27), without changing the hall's identity or purse.
 *
 * Everything a treasury knows is already derived and sitting in four different places: what it
 * holds, what it is saving for, who is standing on the tower this morning, who speaks for the
 * village. A conversation that wanted to answer *"what is this village up to"* would have to go and
 * ask each of them and know which to ask. So it is one answer, in one shape, and the words that
 * wrap it are the game's business rather than this file's — the same division `directoryOf` draws.
 *
 * It is what four other issues are waiting on. #3 wants somewhere to read a vacancy from, #24 and
 * #26 want a hall that can be a party to something, #27 wants a hall that exists to be voted for.
 * None of them wants a panel; they want a thing that answers questions.
 */
describe('what the hall knows', () => {
  const settled = (): Register => {
    const book = new Register(7, 1);
    book.settle('Ashford', 6, ['farmer', 'seller', 'builder', 'doctor']);
    for (let day = 2; day <= 120; day++) book.advance(day);
    return book;
  };

  it('says what its entity purse holds', () => {
    const book = settled();
    expect(whatTheHallKnows(book, 'Ashford').holds).toBe(book.hallOf('Ashford')?.purse ?? 0);
  });

  it('says who speaks for the village, and what it has raised', () => {
    const book = settled();
    const known = whatTheHallKnows(book, 'Ashford');
    expect(known.mayor).toBe(book.mayorOf('Ashford')?.id ?? '');
    expect(known.raised).toEqual(book.worksOf('Ashford'));
  });

  it('keeps the directory and its vacancies with the rest of the hall answers', () => {
    const book = settled();
    expect(whatTheHallKnows(book, 'Ashford').directory).toEqual(book.directoryOf('Ashford'));
  });

  it('has an identity, begins in the mayor family home, and outlives its keeper', () => {
    const book = settled();
    const people = book.living('Ashford');
    const houses = Array.from({ length: people.length }, (_, tx) => ({ tx }) as Structure);
    const mayor = book.mayorOf('Ashford');
    const hall = book.hallOf('Ashford');
    if (!mayor || !hall) throw new Error('settled villages have a mayor and hall');
    const mayorHome = homesOf(houses, people)
      .find((home) => home.family === surnameOf(mayor))?.house;

    expect(hall).toMatchObject({ id: THE_HALL_OWNER, body: 'mayor-house' });
    expect(people.some((person) => person.id === hall.id)).toBe(false);
    expect(bodyOfTheHall(hall, houses, people)).toBe(mayorHome);

    hall.purse = 73;
    mayor.purse = 0;
    book.bury(mayor.id);
    expect(book.hallOf('Ashford')).toBe(hall);
    expect(hall.purse).toBe(73);
  });

  it('says what it is saving for, or nothing when it wants nothing', () => {
    const known = whatTheHallKnows(settled(), 'Ashford');
    expect(typeof known.savingFor === 'string' || known.savingFor === null).toBe(true);
  });

  it('says who is on the tower this morning, which is nobody in most villages', () => {
    const known = whatTheHallKnows(settled(), 'Ashford');
    expect(known.watch).toBe(settled().watchOf('Ashford'));
  });

  /*
   * A village nobody has settled has a hall that knows nothing, rather than one that throws. A
   * conversation can be struck up anywhere and the answer to "what is this place saving for" in an
   * empty valley is "nothing", not a crash.
   */
  it('knows nothing at all about a village that does not exist', () => {
    const known = whatTheHallKnows(new Register(7, 1), 'Nowhere');
    expect(known).toMatchObject({
      holds: 0, mayor: '', watch: '', raised: [], savingFor: null,
      directory: { holding: new Map(), nobodyDoing: [] },
    });
  });
});
