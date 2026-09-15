import { describe, expect, it } from 'vitest';
import { cleanDelta, deltaKey, mayReport, type WorldDelta } from './protocol';
import { Register } from '../src/world/register';

/**
 * An oath as the world's to accept, rather than a page's to announce.
 *
 * The data model landed first and the path did not: a page wrote the oath into its own register
 * and told nobody, the wire had no idea what the shape was, no client applied an incoming one, and
 * the welcome replay skipped them. Five gaps between "it is written down" and "it is true".
 */
/*
 * Cast on the way in, the way a delta off a socket arrives: `cleanDelta` is the thing that decides
 * whether it is well formed, so a test that could not hand it a malformed one would be testing
 * nothing.
 */
const oath = (over: Record<string, unknown> = {}): WorldDelta =>
  ({ kind: 'sworn', village: 'Ashford', trade: 'doctor', who: 'Ash', day: 4, ...over } as WorldDelta);

describe('an oath off the wire', () => {
  it('is read, which it was not', () => {
    expect(cleanDelta(oath())).toEqual({
      kind: 'sworn', village: 'Ashford', trade: 'doctor', who: 'Ash', day: 4,
    });
  });

  /*
   * Without a case here it was read as a delta nobody had heard of and dropped — the shape existed,
   * travelled, and stopped at the door.
   */
  it('is refused when the morning it names is not a number', () => {
    expect(cleanDelta(oath({ day: 'soon' }))).toBeNull();
    expect(cleanDelta(oath({ day: NaN }))).toBeNull();
    expect(cleanDelta(oath({ day: undefined }))).toBeNull();
  });

  /*
   * A missing day is nought rather than nothing, and clamps to the first — which is what `died`,
   * `voted` and `sow` all do with one. An oath is not the place to invent a second rule about it.
   */
  it('reads a missing morning the way every other delta on this wire does', () => {
    expect((cleanDelta(oath({ day: null })) as { day: number }).day).toBe(1);
  });

  /*
   * A nameless traveller is somebody rather than nobody. `cleanName` answers 'Traveller' for an
   * empty name everywhere else on this wire, and an oath is not the place to invent a second rule —
   * the name in the book is the player's own anyway, taken from the roster by the server rather
   * than from the message.
   */
  it('gives a nameless traveller the name everything else on this wire gives them', () => {
    expect((cleanDelta(oath({ who: '' })) as { who: string }).who).toBe('Traveller');
    expect((cleanDelta(oath({ who: '  ' })) as { who: string }).who).toBe('Traveller');
  });

  it('is never earlier than the first day', () => {
    expect((cleanDelta(oath({ day: -5 })) as { day: number }).day).toBe(1);
  });

  /*
   * The world announces this one. A client that could report it would be writing its own facts into
   * somebody else's village, which is the rule the civic vote already runs on.
   */
  it('is the world\'s to announce, not a page\'s to report', () => {
    expect(mayReport({ kind: 'sworn', village: 'Ashford', trade: 'doctor', who: 'Ash', day: 4 }))
      .toBe(false);
  });

  it('is one entry per trade in a village, so a post cannot be held twice', () => {
    const key = (trade: string, who: string): string =>
      deltaKey({ kind: 'sworn', village: 'Ashford', trade, who, day: 4 });
    expect(key('doctor', 'Ash')).toBe(key('doctor', 'Rook'));
    expect(key('doctor', 'Ash')).not.toBe(key('smith', 'Ash'));
  });
});

/**
 * And an oath that arrives after the mornings it should have covered.
 *
 * A sworn trade changes what the next child is raised into, so one learned late leaves a village
 * full of people in jobs the oath would have stopped — and two clients, one that heard it on time
 * and one that heard it late, end up with two different villages. Deaths and votes re-live the
 * village for exactly this reason.
 */
describe('an oath that arrives late', () => {
  const TRADES = ['farmer', 'seller', 'builder', 'doctor', 'smith', 'climber', 'innkeeper', 'fisherman'];
  const settled = (days: number): Register => {
    const book = new Register(7, 1);
    book.settle('Ashford', 6, TRADES);
    for (let day = 2; day <= days; day++) book.advance(day);
    return book;
  };

  it('leaves the same village as one that arrived on time', () => {
    const vacancy = settled(1).directoryOf('Ashford').nobodyDoing[0];
    expect(vacancy, 'the fixture is founded on more trades than it can staff').toBeDefined();

    const onTime = settled(1);
    onTime.apply({ kind: 'sworn', village: 'Ashford', trade: vacancy, who: 'Ash', day: 1 });
    for (let day = 2; day <= 60; day++) onTime.advance(day);

    const late = settled(60);
    late.apply({ kind: 'sworn', village: 'Ashford', trade: vacancy, who: 'Ash', day: 1 });

    const said = (book: Register): string => book.living('Ashford')
      .map((one) => `${one.id}:${one.trade}`).sort().join('|');
    expect(said(late), 'a village that heard it late must be the village that heard it on time')
      .toBe(said(onTime));
  });

  it('is refused for a morning that has not happened', () => {
    const book = settled(10);
    expect(book.apply({ kind: 'sworn', village: 'Ashford', trade: 'smith', who: 'Ash', day: 99 }))
      .toBe(false);
  });

  it('is written once however many times it is told', () => {
    const book = settled(10);
    const told = { kind: 'sworn' as const, village: 'Ashford', trade: 'smith', who: 'Ash', day: 5 };
    expect(book.apply(told)).toBe(true);
    expect(book.apply(told), 'the same telling twice is one oath').toBe(false);
    expect(book.directoryOf('Ashford').sworn.filter((one) => one.trade === 'smith')).toHaveLength(1);
  });

  it('is kept for a village nobody has settled yet', () => {
    const book = new Register(7, 1);
    expect(book.apply({ kind: 'sworn', village: 'Nowhere', trade: 'smith', who: 'Ash', day: 1 }))
      .toBe(true);
  });
});
