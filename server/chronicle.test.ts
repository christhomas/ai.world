import { describe, expect, it } from 'vitest';
import { Chronicle, KEEPS } from './chronicle';
import type { Change } from '../src/world/register';

/**
 * What changed, which is the half of watching a world the Domesday Book cannot answer.
 *
 * The book says what is true now. `Register.advance` has always handed back every birth, death,
 * emptied village and resettlement as it lives the days — and every caller in the game threw that
 * list away after acting on it, because nothing had a use for a history. This keeps the last while
 * of it so somebody can watch a world happen rather than photograph it.
 */

const died = (name: string, day: number): Change =>
  ({ kind: 'died', id: `id-${name}`, name, village: 'Ashford', day, cause: 'age' });

describe('the chronicle', () => {
  it('keeps what a day turned up, in the order it turned up', () => {
    const book = new Chronicle();
    book.record([died('Hild', 4), died('Roos', 4)]);
    expect(book.since(0).map((e) => e.name)).toEqual(['Hild', 'Roos']);
  });

  it('numbers every entry, so two in one millisecond are two things', () => {
    /*
     * The reason a reader asks by number rather than by time. A world lives a day in a second, so
     * several deaths share a millisecond as a matter of course — and a reader polling on a clock
     * would see one of them and never the other.
     */
    const book = new Chronicle();
    const at = Date.now();
    const kept = book.record([died('Hild', 4), died('Roos', 4)], at);
    expect(kept[0].at).toBe(kept[1].at);
    expect(kept[1].n).toBe(kept[0].n + 1);
  });

  it('hands back only what is newer than the caller last saw', () => {
    const book = new Chronicle();
    book.record([died('Hild', 4)]);
    const seen = book.latest;
    book.record([died('Roos', 5)]);
    expect(book.since(seen).map((e) => e.name)).toEqual(['Roos']);
    expect(book.since(book.latest)).toEqual([]);
  });

  it('gives a first-time reader whatever it still holds', () => {
    // nought is what somebody opening the page has, and the right answer is everything
    const book = new Chronicle();
    book.record([died('Hild', 4), died('Roos', 5)]);
    expect(book.since(0).length).toBe(2);
  });

  it('forgets the oldest rather than growing without bound', () => {
    /*
     * A world that runs for a month has tens of thousands of these in it, and there is no version
     * of "keep them all" that ends well. What somebody watching wants is the last while.
     */
    const book = new Chronicle();
    for (let n = 0; n < KEEPS + 250; n++) book.record([died(`Soul${n}`, n)]);
    expect(book.held).toBe(KEEPS);
    const oldest = book.since(0)[0];
    expect(oldest.name, 'the ring kept the beginning and dropped the end').toBe('Soul250');
  });

  it('never hands back more than it keeps, however far behind the reader is', () => {
    const book = new Chronicle();
    for (let n = 0; n < KEEPS * 2; n++) book.record([died(`Soul${n}`, n)]);
    expect(book.since(0).length).toBeLessThanOrEqual(KEEPS);
    expect(book.since(0, 10).length).toBe(10);
  });

  it('keeps births and resettlements too, not only the deaths', () => {
    // a chronicle that kept only deaths could not answer why a village was emptying, and the day
    // somebody wants births is the day it turns out they were never kept
    const book = new Chronicle();
    book.record([
      { kind: 'born', id: 'a', name: 'Kees', village: 'Ashford', day: 9 },
      { kind: 'lost', id: 'Thornby', name: 'Thornby', village: 'Thornby', day: 9 },
      { kind: 'resettled', id: 'b', name: 'Greta', village: 'Thornby', day: 10 },
    ]);
    expect(book.since(0).map((e) => e.kind)).toEqual(['born', 'lost', 'resettled']);
  });
});
