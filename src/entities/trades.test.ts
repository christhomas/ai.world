import { describe, expect, it } from 'vitest';
import { Memory } from '../core/behaviour';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, type TileWorld } from './entity';
import { CREATURE_VERBS, type Mind } from './verbs';
import { TRADES, pickTrade, tradeNamed, tradesFor } from './trades';

/** Flat, walkable, endless: a test wants a village green, not a landscape. */
const green: TileWorld = {
  heightAt: () => 0.5,
  waterAt: () => null,
  blocked: () => false,
  isRoad: () => false,
};

const villager = (x = 0, z = 0) => {
  const herd = new Herd(KINDS.villager, x, z, x, z, 10);
  const e = new Entity(KINDS.villager, x, z, herd, 'k', mulberry32(3));
  e.y = 0.5;
  herd.members.push(e);
  return e;
};

/** Run one verb, with everything it might ask about stubbed to something harmless. */
const runVerb = (
  name: keyof typeof CREATURE_VERBS.actions,
  params: Record<string, number | string | boolean>,
  self: Entity,
  over: Partial<Mind> = {},
  ticks = 1,
  dt = 0.5,
) => {
  const node = CREATURE_VERBS.actions[name](params);
  const memory = new Memory();
  const world: Mind = {
    self, ground: green, playerX: 999, playerZ: 999, playerAfloat: false, playerArmed: false,
    rng: mulberry32(9), bite: () => {}, time: 0.5,
    quarry: () => null, remove: () => {}, nearestPerson: () => null, nearestTrouble: () => null,
    strike: () => {}, worth: (id) => (id === 'pelt' ? 26 : 4),
    wanted: false, arrest: () => {},
    ...over,
  };
  // stop at the first answer that is not "still going", the way a tree above it would: a verb
  // that has finished starts afresh on the next tick, so running it past the end tells you nothing
  for (let i = 0; i < ticks; i++) {
    const status = node({ world, dt, memory });
    if (status !== 'running') return status;
  }
  return 'running' as const;
};

describe('who does what in a village', () => {
  it('only offers a trade the village can actually support', () => {
    const inland = tradesFor({ square: [0, 0], field: [1, 1], market: [2, 2], woods: [3, 3] });
    expect(inland.map((t) => t.id)).toContain('farmer');
    expect(inland.map((t) => t.id)).not.toContain('sailor');     // no water, no sailors
    expect(inland.map((t) => t.id)).not.toContain('climber');    // no heights, no climbers

    const port = tradesFor({ square: [0, 0], shore: [9, 9] });
    expect(port.map((t) => t.id)).toContain('sailor');
  });

  it('always gives somebody a job when there is one to be had', () => {
    const rng = mulberry32(11);
    const posts = { square: [0, 0] as [number, number], field: [1, 1] as [number, number], market: [2, 2] as [number, number], woods: [3, 3] as [number, number] };
    const picked = new Set(Array.from({ length: 40 }, () => pickTrade(posts, rng)));
    expect(picked.size).toBeGreaterThan(1);                      // not everybody does the same thing
    for (const id of picked) expect(tradeNamed(id)).toBeDefined();
  });

  it('leaves only the trade that needs nothing where a village offers nothing', () => {
    // an explorer needs no field, no shore and no market: boots are the whole of the job
    expect(pickTrade({}, mulberry32(1))).toBe('explorer');
    expect(tradesFor({}).map((t) => t.id)).toEqual(['explorer']);
  });

  it('gives every trade something to say', () => {
    for (const trade of TRADES) {
      expect(trade.lines.length, `${trade.id} has nothing to say`).toBeGreaterThan(0);
      expect(trade.label).toMatch(/[A-Z]/);
    }
  });
});

describe('the verbs a working day is written in', () => {
  it('walks to a post, and fails when the village has no such place', () => {
    const e = villager(0, 0);
    e.posts = { market: [6, 0] };
    expect(runVerb('goTo', { post: 'market' }, e)).toBe('running');
    expect(e.tx).toBe(6);
    expect([e.herd.ax, e.herd.az]).toEqual([6, 0]);               // the whole day moves with them

    e.x = 5.5;
    expect(runVerb('goTo', { post: 'market' }, e)).toBe('success');
    expect(runVerb('goTo', { post: 'shore' }, e)).toBe('failure'); // no shore in this village
  });

  it('puts somebody through their own door, and takes them off the street', () => {
    const e = villager(10, 10);
    e.posts = { home: [10, 10] };
    expect(runVerb('goTo', { post: 'home', enter: true }, e)).toBe('success');
    expect(e.indoors).toBe(true);
    expect(e.state).toBe('idle');

    // and any errand outdoors brings them back out
    e.posts.market = [40, 40];
    runVerb('goTo', { post: 'market' }, e);
    expect(e.indoors).toBe(false);
  });

  it('sells what is carried at what the game says it is worth', () => {
    const e = villager();
    e.carrying = { id: 'pelt', count: 2 };
    expect(runVerb('sell', {}, e)).toBe('success');
    expect(e.purse).toBe(52);                                     // two pelts at twenty-six
    expect(e.carrying).toBeNull();
    expect(runVerb('sell', {}, e)).toBe('failure');               // nothing left to sell
  });

  it('spends only what is in the purse', () => {
    const e = villager();
    e.purse = 10;
    expect(runVerb('spend', { cost: 40 }, e)).toBe('failure');
    expect(e.purse).toBe(10);
    expect(runVerb('spend', { cost: 6 }, e)).toBe('success');
    expect(e.purse).toBe(4);
  });

  it('mends the paying quickly and the penniless slowly, but mends them both', () => {
    const paying = villager();
    paying.purse = 20;
    paying.hp = 1;
    // six seconds of care at half a second a tick, and the fee comes out at the end
    expect(runVerb('beHealed', { fee: 8, seconds: 6 }, paying, {}, 12)).toBe('success');
    expect(paying.hp).toBe(KINDS.villager.hp);
    expect(paying.purse).toBe(12);

    const penniless = villager();
    penniless.hp = 1;
    expect(runVerb('beHealed', { fee: 8, seconds: 6 }, penniless, {}, 12)).toBe('running');
    expect(penniless.hp).toBe(1);                                 // still being seen to
    expect(runVerb('beHealed', { fee: 8, seconds: 6 }, penniless, {}, 40)).toBe('success');
    expect(penniless.purse).toBe(0);                              // and it cost them nothing
  });

  it('marks the nearer of a passing villager and the hero', () => {
    const wolf = villager(0, 0);
    const farmer = villager(3, 0);
    expect(runVerb('markPrey', { within: 10 }, wolf, { nearestPerson: () => farmer, playerX: 8, playerZ: 0 })).toBe('success');
    expect(wolf.target).toBe(farmer);

    // the hero standing closer than anybody else is the hero's own problem
    expect(runVerb('markPrey', { within: 10 }, wolf, { nearestPerson: () => farmer, playerX: 1, playerZ: 0 })).toBe('success');
    expect(wolf.target).toBeNull();

    // and an empty field is nobody's business
    expect(runVerb('markPrey', { within: 4 }, wolf, { nearestPerson: () => null, playerX: 90, playerZ: 0 })).toBe('failure');
  });
});
