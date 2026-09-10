import { describe, expect, it } from 'vitest';
import { GONE, boxOf, carriedBy, handOver, handOverAll, packOf } from './goods';

/**
 * Things changing hands, held to the same rule the money is: what leaves one pack arrives in
 * another, and anything that genuinely disappears has to say so.
 *
 * Goods are easier to lose than coins. A `take` that comes back with two when three were asked
 * for, followed by a `give` of three, mints a thing out of nothing and leaves no trace — which is
 * exactly the shape of bug twelve hand-written copies of "take from here, add to there" are for.
 */

describe('somewhere things are kept', () => {
  it('reads a pack, a box and a shoulder the same way', () => {
    expect(packOf(new Map([['pelt', 3]])).count('pelt')).toBe(3);
    expect(boxOf({ pelt: 3 }).count('pelt')).toBe(3);
    expect(carriedBy({ carrying: { id: 'pelt', count: 3 } }).count('pelt')).toBe(3);
  });

  it('never gives out more than is there, and says what it actually gave', () => {
    for (const pack of [packOf(new Map([['bread', 2]])), boxOf({ bread: 2 })]) {
      expect(pack.take('bread', 5)).toBe(2);
      expect(pack.count('bread')).toBe(0);
    }
  });

  it('forgets a kind it has run out of rather than keeping a nought', () => {
    // a menu lists what is in a pack, and a row reading "Bread (0)" is a bug you can see
    const items = new Map([['bread', 1]]);
    packOf(items).take('bread', 1);
    expect(items.has('bread')).toBe(false);
    const box: Record<string, number> = { bread: 1 };
    boxOf(box).take('bread', 1);
    expect(box.bread).toBeUndefined();
  });

  it('takes nothing at all for a nonsense number', () => {
    const pack = packOf(new Map([['bread', 4]]));
    expect(pack.take('bread', -2)).toBe(0);
    pack.give('bread', -2);
    expect(pack.count('bread')).toBe(4);
  });

  it('lists what is in it and leaves out what is not', () => {
    expect(packOf(new Map([['a', 2], ['b', 0]])).everything()).toEqual([['a', 2]]);
    expect(boxOf({ a: 2, b: 0 }).everything()).toEqual([['a', 2]]);
  });
});

describe('a shoulder, which holds one thing', () => {
  it('drops what it had when given something else, because a man has two hands', () => {
    const hunter = { carrying: { id: 'meat', count: 1 } as { id: string; count: number } | null };
    carriedBy(hunter).give('pelt', 2);
    expect(hunter.carrying).toEqual({ id: 'pelt', count: 2 });
  });

  it('stacks more of the same thing', () => {
    const hunter = { carrying: { id: 'meat', count: 1 } as { id: string; count: number } | null };
    carriedBy(hunter).give('meat', 2);
    expect(hunter.carrying).toEqual({ id: 'meat', count: 3 });
  });

  it('is empty rather than carrying nought of something', () => {
    const hunter = { carrying: { id: 'meat', count: 1 } as { id: string; count: number } | null };
    expect(carriedBy(hunter).take('meat', 1)).toBe(1);
    expect(hunter.carrying).toBeNull();
  });

  it('will not give up something it is not carrying', () => {
    const hunter = { carrying: { id: 'meat', count: 4 } as { id: string; count: number } | null };
    expect(carriedBy(hunter).take('pelt', 1)).toBe(0);
    expect(hunter.carrying).toEqual({ id: 'meat', count: 4 });
  });
});

describe('handing things over', () => {
  it('moves what was actually taken, never what was asked for', () => {
    // the whole reason this is one function: a take of two and a give of three mints a thing
    const from = packOf(new Map([['pelt', 2]]));
    const to = packOf(new Map());
    expect(handOver(from, to, 'pelt', 5)).toBe(2);
    expect(to.count('pelt')).toBe(2);
    expect(from.count('pelt')).toBe(0);
  });

  it('moves between any two shapes of pack', () => {
    const shoulder = { carrying: { id: 'meat', count: 3 } as { id: string; count: number } | null };
    const box: Record<string, number> = {};
    expect(handOver(carriedBy(shoulder), boxOf(box), 'meat', 2)).toBe(2);
    expect(box.meat).toBe(2);
    expect(shoulder.carrying).toEqual({ id: 'meat', count: 1 });
  });

  it('empties a pack into another without leaving the last one behind', () => {
    // walking a pack while emptying it is how the last one or two get missed
    const from = packOf(new Map([['a', 1], ['b', 2], ['c', 3]]));
    const to = packOf(new Map());
    expect(handOverAll(from, to)).toBe(6);
    expect(from.everything()).toEqual([]);
    expect(to.everything().sort()).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  it('lets a thing leave the world only where that is written down', () => {
    const from = packOf(new Map([['log', 4]]));
    expect(handOver(from, GONE, 'log', 4)).toBe(4);
    expect(from.count('log')).toBe(0);
    expect(GONE.count('log'), 'the fire kept the logs').toBe(0);
  });
});
