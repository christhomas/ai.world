import { describe, expect, it } from 'vitest';
import { POSTINGS, postsToday } from './postings';
import type { Person } from './people';

/**
 * A yard with work on its books has somebody doing it.
 *
 * The rest of item 37 (issue #7). `POSTINGS` has declared two sorts of post since the day it was
 * written and only ever honoured one: `postsToday` walks the holdings looking for `farm` in as many
 * words and posts a guard, so the `crew` row — a yard, wanting `can_build`, *a day of building* —
 * sat in the table describing something that never happened.
 *
 * That is the same shape as everything else found today by asking what nothing calls: the row
 * exists, it is documented, it is the thing another item is waiting on, and no code path reaches it.
 *
 * **What it deliberately is not** is escrow. The issue this comes from says the money is handed over
 * when the thing is standing, and the argument that won says otherwise: a fee held for a dead man
 * dangles, so a day of building is bought each morning from whoever turns up. A builder who dies on
 * the fourth day has been paid for four days, and his replacement is paid for the two that are
 * left — which is what escrow gets wrong, because there the dead man's four days go to his
 * successor.
 */
const who = (id: string, trade: string, purse = 500, born = 0): Person =>
  ({ id, trade, purse, born } as Person);

const held = (id: string, kind: string, owner: string) => ({ id, kind, owner } as never);

describe('a day of building, bought each morning', () => {
  it('is a sort of post the table has always declared', () => {
    expect(POSTINGS.find((p) => p.kind === 'crew')).toMatchObject({ on: 'yard', wants: 'can_build' });
  });

  it('goes to somebody who can build, when a yard has an owner who can pay', () => {
    const posts = postsToday(
      [who('rich', 'seller'), who('bob', 'builder')],
      [held('y1', 'yard', 'rich')],
      0,
    );
    expect(posts.map((p) => p.kind)).toContain('crew');
    expect(posts.find((p) => p.kind === 'crew')).toMatchObject({ holding: 'y1', who: 'bob', funder: 'rich' });
  });

  it('goes to nobody where the village has no builder in it', () => {
    const posts = postsToday([who('rich', 'seller')], [held('y1', 'yard', 'rich')], 0);
    expect(posts.filter((p) => p.kind === 'crew')).toEqual([]);
  });

  /*
   * The same rule the guard runs on, and for the same reason: a poor yard cannot keep a builder on,
   * which is what makes this a decision rather than a subscription.
   */
  it('goes to nobody where the owner cannot lay out the wage', () => {
    const posts = postsToday(
      [who('broke', 'seller', 1), who('bob', 'builder')],
      [held('y1', 'yard', 'broke')],
      0,
    );
    expect(posts.filter((p) => p.kind === 'crew')).toEqual([]);
  });

  it('leaves the guard exactly as it was', () => {
    const posts = postsToday(
      [who('rich', 'farmer'), who('sam', 'soldier')],
      [held('f1', 'farm', 'rich')],
      0.5,
    );
    expect(posts.map((p) => p.kind)).toEqual(['guard']);
  });
});
