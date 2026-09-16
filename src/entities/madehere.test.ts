import { describe, expect, it } from 'vitest';
import { TRADES, tradesFor } from './trades';
import type { Post } from './entity';

/**
 * Somebody works in the smithy, which until now nobody did.
 *
 * `structures.ts` has had `ShopType = 'store' | 'smith' | 'inn' | 'apothecary'` for as long as
 * villages have had shops, and it places all four. `TRADES` held fourteen trades and neither smith
 * nor apothecary was one of them — `prosperity.ts` records the same fact from the other side, as
 * the reason its higher wage once reached nobody.
 *
 * So the game sold swords nobody in the world made, out of buildings nobody worked in.
 *
 * The join is the sentence a trade already knows how to say: `seller` needs `market`, `innkeeper`
 * needs `inn`, and a `smith` needing `smith` is the same shape. Item #232, first half; what a smith
 * *does* with a day is the second.
 */

const somewhere: [number, number] = [0, 0];
const posts = (...at: Post[]): Partial<Record<Post, [number, number]>> =>
  Object.fromEntries(at.map((p) => [p, somewhere]));

describe('who works in the shops a village already has', () => {
  it('knows a smith and an apothecary as trades at all', () => {
    const ids = TRADES.map((t) => t.id);
    expect(ids).toContain('smith');
    expect(ids).toContain('apothecary');
  });

  it('staffs a smithy only where there is one', () => {
    expect(tradesFor(posts('square', 'smith')).map((t) => t.id)).toContain('smith');
    expect(tradesFor(posts('square', 'market')).map((t) => t.id)).not.toContain('smith');
  });

  it('staffs an apothecary only where there is one', () => {
    expect(tradesFor(posts('square', 'apothecary')).map((t) => t.id)).toContain('apothecary');
    expect(tradesFor(posts('square', 'smith')).map((t) => t.id)).not.toContain('apothecary');
  });

  it('makes neither of them common, because a village has one of each at most', () => {
    for (const id of ['smith', 'apothecary']) {
      const trade = TRADES.find((t) => t.id === id)!;
      const seller = TRADES.find((t) => t.id === 'seller')!;
      expect(trade.weight, id).toBeLessThan(seller.weight);
    }
  });

  it('gives them something to say, like every other trade', () => {
    for (const id of ['smith', 'apothecary']) {
      const trade = TRADES.find((t) => t.id === id)!;
      expect(trade.lines.length, id).toBeGreaterThan(0);
      expect(trade.label, id).not.toBe('');
    }
  });
});
