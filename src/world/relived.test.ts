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
describe('the two ways a village comes to exist', () => {
  const TRADES = ['farmer', 'seller', 'builder', 'hunter', 'logger'];

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

  for (const seed of [7, 1234]) {
    it(`agrees about who is alive and what they hold, on seed ${seed}`, () => {
      const there = livedForward(seed, 120);
      const after = relived(seed, 120);

      expect(after.living('Ashford').map((p) => p.id)).toEqual(there.living('Ashford').map((p) => p.id));
      expect(after.worksOf('Ashford')).toEqual(there.worksOf('Ashford'));
      expect(after.hallOf('Ashford')).toBe(there.hallOf('Ashford'));
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
