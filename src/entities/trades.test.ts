import { describe, expect, it } from 'vitest';
import { Memory } from '../core/behaviour';
import { mulberry32 } from '../core/rng';
import { KINDS } from './animals';
import { Entity, Herd, bodyOf, type TileWorld } from './entity';
import { MODELS } from './models';
import { PEOPLE } from './quarry';
import { CREATURE_VERBS, type Mind } from './verbs';
import { TRADES, bodyForTrade, pickTrade, tradeNamed, tradesFor } from './trades';
import type { PartDef } from './rigs';

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
    stock: () => null, foe: () => null,
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

/**
 * What somebody standing in a street is drawn as.
 *
 * A village was eleven trades and one body until the trades got hats, and it was two sexes and one
 * body until the register learnt to say which was which. Both are the same argument, and the rule
 * both follow is that the silhouette carries it rather than the colour: at the distance this camera
 * watches a street from a hat is legible, a hem is legible, and a shirt is not.
 *
 * What is worth pinning is the order the two questions are asked in, that every answer is a body
 * that exists, and that the woman and the man are told apart by their outline — because a pair
 * told apart by a dye is a pair nobody can tell apart at all.
 */

/** The parts a model lays on over the plain person the generator drew. */
const extrasOf = (id: string): PartDef[] => MODELS[id].slice(MODELS.villager.length);
/** How wide something is across, which is the measurement a figure is read by from up here. */
const across = (parts: readonly PartDef[]): number => Math.max(...parts.map((p) => p.size[2]));
/** And how wide this body is at the shoulders, which is the widest the person underneath gets. */
const shouldersOf = (id: string): number => across(MODELS[id].slice(0, MODELS.villager.length));

describe('which body somebody is drawn with', () => {
  it('gives a woman one of her own, and a man one of his', () => {
    expect(bodyForTrade(undefined, 'woman')).toBe('woman');
    expect(bodyForTrade(undefined, 'man')).toBe('man');
  });

  it('lets the trade win, because a woman with a trade wore the hat over the dress', () => {
    expect(bodyForTrade('miner', 'woman')).toBe('miner');
    expect(bodyForTrade('doctor', 'woman')).toBe('doctor');
    // and the seven trades with no hat of their own fall through to the person wearing them
    expect(bodyForTrade('seller', 'woman')).toBe('woman');
    expect(bodyForTrade('hunter', 'man')).toBe('man');
  });

  it('draws anybody nobody has a register entry for as the villager they have always been', () => {
    // a congregation at a church door, whoever is behind a counter, a street stood up by a page
    // that has not been told who lives here yet: drawing those as men would be a guess
    expect(bodyForTrade(undefined)).toBe('villager');
    expect(bodyForTrade('seller')).toBe('villager');
  });

  it('gives a child with no trade yet a body, which an empty trade used not to', () => {
    /*
     * `(trade && BODIES[trade]) ?? 'villager'` handed back the empty string for a child, because
     * an empty string is falsy and is not nullish. Nothing noticed for weeks: `manager.place`
     * falls back to the herd's own kind when handed a body that does not exist, and the herd was
     * villagers. It would notice now — a girl would be drawn as her mother's herd.
     */
    expect(bodyForTrade('', 'woman')).toBe('woman');
    expect(bodyForTrade('')).toBe('villager');
  });

  it('never hands back a body the game cannot draw, or one it would not call a person', () => {
    const everybody = ['clerk', 'sergeant', undefined, '', ...TRADES.map((t) => t.id)];
    for (const trade of everybody) {
      for (const sex of ['woman', 'man', undefined] as const) {
        const body = bodyForTrade(trade, sex);
        expect(KINDS[body], `a ${sex ?? 'nobody'} of trade "${trade}" is drawn as "${body}"`).toBeDefined();
        expect(PEOPLE.has(body), `"${body}" is not counted as a person`).toBe(true);
      }
    }
  });
});

describe('a woman looks like a woman', () => {
  it('is told from a man by her outline rather than by her colour', () => {
    // she flares below the waist and he tapers: her hem is wider across than her own shoulders,
    // and his tunic is narrower than his. That is the whole of it at a hundred paces
    expect(across(extrasOf('woman')), 'a hem no wider than she is').toBeGreaterThan(shouldersOf('woman'));
    expect(across(extrasOf('man')), 'a tunic as broad as his shoulders').toBeLessThan(shouldersOf('man'));
  });

  it('wears hair that falls past her shoulders and turns with her head', () => {
    const hair = extrasOf('woman').find((p) => p.anim === 'head');
    expect(hair, 'nothing on her head moves when she looks at you').toBeDefined();
    expect(hair!.offset[0], 'hair in front of her face').toBeLessThan(0);
    expect(hair!.offset[1] - hair!.size[1] / 2, 'hair that stops at the jaw').toBeLessThan(1);
  });

  it('leaves the walk showing under the dress, so she is never the priest', () => {
    const hem = Math.min(...extrasOf('woman').map((p) => p.offset[1] - p.size[1] / 2));
    expect(hem, 'a hem above the knee').toBeLessThan(0.5);
    expect(hem, 'a cassock to the ankle, which belongs to somebody else').toBeGreaterThan(0.2);
  });

  it('stands on no more ground than anybody else, so a hem is not a door blocked', () => {
    // a footprint is measured off the parts, so a garment that flares is a person who takes up
    // more room — which is how the doctor once became half again as deep as anybody else and
    // could not get through a doorway sideways. He is the worst this village allows.
    const widest = bodyOf(KINDS.doctor);
    for (const body of ['woman', 'man']) {
      expect(bodyOf(KINDS[body]).hw, `${body} lengthways`).toBeLessThanOrEqual(widest.hw);
      expect(bodyOf(KINDS[body]).hd, `${body} across`).toBeLessThanOrEqual(widest.hd);
    }
  });

  it('takes its colours out of the palette rather than inventing new ones', () => {
    // the dress and the tunic are painted from the same palette entry the shirt is, so a street of
    // women is as many colours as a street of villagers ever was and the shape is doing the work
    for (const body of ['woman', 'man']) {
      const own = extrasOf(body).filter((p) => p.tint === undefined);
      expect(own.length, `${body} is wearing ${own.length} colours nobody else can`).toBeLessThanOrEqual(1);
    }
  });
});
