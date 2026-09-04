import { describe, expect, it } from 'vitest';
import { Duel } from './duel';

const presence = (x: number, z: number) =>
  ({ id: 'p2', name: 'Wren', x, z, yaw: 0, walk: 0, gear: [], place: 'surface', riding: 'foot' as const });

describe('a duel', () => {
  it('runs on its own health, and ends when one side is spent', () => {
    const duel = new Duel();
    expect(duel.active).toBe(false);
    duel.begin('p2', 'Wren', 20);
    expect(duel.active).toBe(true);

    expect(duel.struck(8)).toBe(false);
    expect(duel.mine).toBe(12);
    expect(duel.struck(15)).toBe(true);            // more than is left still only takes what is left
    expect(duel.mine).toBe(0);

    duel.landed(5);
    expect(duel.theirs).toBe(15);
    duel.end();
    expect(duel.active).toBe(false);
    expect(duel.struck(5)).toBe(false);            // a bout that is over cannot be fought
  });

  it('only counts blows aimed at somebody standing in front of you', () => {
    const duel = new Duel();
    duel.begin('p2', 'Wren', 20);
    const arc = 1.1;
    expect(duel.inReach(presence(1.5, 0), 0, 0, 0, arc)).toBe(true);      // straight ahead
    expect(duel.inReach(presence(-1.5, 0), 0, 0, 0, arc)).toBe(false);    // behind you
    expect(duel.inReach(presence(9, 0), 0, 0, 0, arc)).toBe(false);       // out of reach
  });

  it('says where the bout stands, and nothing at all when there is none', () => {
    const duel = new Duel();
    expect(duel.readout()).toBe('');
    duel.begin('p2', 'Wren', 20);
    duel.struck(4);
    expect(duel.readout()).toBe('Duel with Wren — you 16/20, them 20/20');
  });
});
