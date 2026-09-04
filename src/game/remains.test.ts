import { describe, expect, it } from 'vitest';
import { REMAINS, Remains } from './remains';

describe('what the dead leave behind', () => {
  it('leaves the purse, the load, and often the tool of the trade', () => {
    const ground = new Remains();
    const pack = ground.leave('Rolf', 'hunter', 4, 9, 23, 'pelt', 7);

    expect(pack.gold).toBe(23);
    expect(pack.items).toContain('pelt');       // what they were carrying to market
    expect(pack.who).toBe('Rolf');
    expect(ground.all).toHaveLength(1);
  });

  it('gives two people in one world the same pack, because the roll is of the place', () => {
    const here = new Remains().leave('Rolf', 'hunter', 4, 9, 10, null, 12345);
    const there = new Remains().leave('Rolf', 'hunter', 4, 9, 10, null, 12345);
    expect(here.items).toEqual(there.items);
  });

  it('is found by standing over it, and not from across the field', () => {
    const ground = new Remains();
    ground.leave('Wren', 'farmer', 10, 10, 4, null, 1);
    expect(ground.nearest(10.5, 10.5)).not.toBeNull();
    expect(ground.nearest(30, 30)).toBeNull();
  });

  it('hands over what is in it, once', () => {
    const ground = new Remains();
    const pack = ground.leave('Wren', 'soldier', 0, 0, 15, 'meat', 3);
    const took = ground.take(pack);

    expect(took.gold).toBe(15);
    expect(took.items).toContain('meat');
    expect(ground.all).toHaveLength(0);
    expect(ground.nearest(0, 0)).toBeNull();
  });

  it('lets the ones nobody came back for go', () => {
    const ground = new Remains();
    ground.leave('Alder', 'sailor', 0, 0, 1, null, 5);
    ground.age(REMAINS.LASTS - 1);
    expect(ground.all).toHaveLength(1);
    ground.age(2);
    expect(ground.all).toHaveLength(0);
  });

  it('does not let a hard winter fill the world with packs', () => {
    const ground = new Remains();
    for (let i = 0; i < REMAINS.KEPT + 10; i++) ground.leave(`Villager ${i}`, 'farmer', i, 0, 1, null, i);
    expect(ground.all).toHaveLength(REMAINS.KEPT);
    // the oldest goes first, so what is still lying about is what fell most recently
    expect(ground.all[0].who).toBe('Villager 10');
  });
});
