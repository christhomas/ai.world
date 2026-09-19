import { describe, expect, it } from 'vitest';
import { Register } from './register';

/**
 * A village lived forward day by day, against the same village founded once and re-lived.
 *
 * These are the two ways a village ever comes to exist, and the whole world rests on them agreeing.
 * A page that was there when somebody died lives the village forward a day at a time; a page that
 * learns about that death afterwards throws the village away and lives it again from its founding
 * with the death in its right place. If the two arrive anywhere different, two players are standing
 * in villages that only look alike.
 *
 * ## What this caught
 *
 * Item 88. A village's morning spending is handed a day, and it was handed `today` — the day the
 * *register* has reached — rather than the morning being lived. Live forward and the two are the
 * same number, so nothing was ever wrong on the page that watched it happen. Re-live, and `today`
 * is the far end while the morning walks from day two, so every holding founded during the replay
 * was stamped with the day of the replay.
 *
 * The same village, on seed 7: farms founded on days 83, 86 and 112 when lived forward, and on 120,
 * 120 and 120 when re-lived. Everything else agreed — the people, the works, the hall to the penny
 * — which is what made it invisible. Nothing reads a holding's founding day yet, so it was a
 * divergence waiting for its first reader rather than a fault anybody could see.
 */
const TRADES = ['farmer', 'seller', 'builder', 'hunter', 'woodcutter'];

/** Lived forward a day at a time, which is what a page that was there does. */
function livedForward(seed: number, to: number): Register {
  const book = new Register(seed, 1);
  book.settle('Ashford', 6, TRADES);
  for (let day = 2; day <= to; day++) book.advance(day);
  return book;
}

/** Founded once and lived forward in one go, which is what `relive` does. */
function relived(seed: number, to: number): Register {
  const book = new Register(seed, to);
  book.settle('Ashford', 6, TRADES);
  return book;
}

describe('the two ways a village comes to exist', () => {
  for (const seed of [7, 1234]) {
    it(`agrees about who is alive and what they hold, on seed ${seed}`, () => {
      const there = livedForward(seed, 120);
      const after = relived(seed, 120);

      expect(after.living('Ashford').map((p) => p.id)).toEqual(there.living('Ashford').map((p) => p.id));
      expect(after.worksOf('Ashford')).toEqual(there.worksOf('Ashford'));
      expect(after.hallOf('Ashford')).toEqual(there.hallOf('Ashford'));
      expect(after.herdOf('Ashford')).toBe(there.herdOf('Ashford'));
    });

    it(`agrees about when each holding was founded, on seed ${seed}`, () => {
      const there = livedForward(seed, 120).madeOf('Ashford').holdings ?? [];
      const after = relived(seed, 120).madeOf('Ashford').holdings ?? [];
      expect(after.map((h) => [h.kind, h.founded, h.owner]))
        .toEqual(there.map((h) => [h.kind, h.founded, h.owner]));
    });
  }

  /*
   * And the founding days have to be days the village was actually lived through, not all the same
   * number. An assertion that the two lists match would pass perfectly well if both were wrong in
   * the same way, which is exactly what a replay bug looks like from the inside.
   */
  it('founds holdings across the village\'s life rather than all on one day', () => {
    const holdings = relived(7, 120).madeOf('Ashford').holdings ?? [];
    const days = new Set(holdings.map((h) => h.founded));
    expect(days.size).toBeGreaterThan(1);
    expect(Math.max(...days)).toBeLessThan(120);
  });
});

/**
 * And the books the two ways keep of a morning's posts, which did not agree.
 *
 * #264's fourth line is *"the book replays identically"*, and it was not true of the one-day-deep
 * ledger the register kept. `advance` clears the day book every morning; the catch-up inside
 * `settle` lives a hundred mornings without ever clearing one, and the ledger writes with `set`.
 * So a re-lived village's ledger was not the last morning — it was **the last value ever written
 * for each person**, whatever morning that happened on, standing next to the values that really
 * were today's and indistinguishable from them.
 *
 * Measured on seed 1234 at day 120: lived forward the roll reads
 * `-12` for `Ashford-62-0` and `+12` for `Ashford-74-0` and nothing for anybody else; re-lived it
 * also carried `-24` against `Ashford-61-0` and `+12` for `Ashford-83-0` — two people charged and
 * paid for a morning on which no post of theirs stood. Seed 11 at day 101 and seed 7 at day 101
 * did the same. `records.ts` puts this figure in the roll a player is handed, and `economy.test.ts`
 * adds it into the conservation sum, so a client that learned late about a killing would have read
 * a roll with a wage in it that no purse ever moved for.
 *
 * Both paths now answer out of the same book, which is keyed by the morning — see `holdingbook.ts`
 * — so there is no ledger to clear and nothing stale to leave behind.
 */
describe('what the two ways say a post paid', () => {
  /** Seeds and days scanned for a morning where the two paths actually disagreed. */
  for (const [seed, to] of [[7, 101], [1234, 120], [11, 101]] as const) {
    it(`agrees to the coin on seed ${seed} at day ${to}`, () => {
      const ledger = (book: Register): Array<readonly [string, number]> => book.living('Ashford')
        .map((person) => [person.id, book.postedTo(person.id)] as const)
        .filter(([, much]) => much !== 0);

      const there = ledger(livedForward(seed, to));
      const after = ledger(relived(seed, to));
      // the precondition: a morning where somebody was actually paid, or this proves nothing
      expect(there.length, 'no post was paid on this morning either way').toBeGreaterThan(0);
      expect(after).toEqual(there);
    });
  }
});
