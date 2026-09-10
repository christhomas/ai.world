import { describe, expect, it } from 'vitest';
import { Pace } from './pace';
import { Tiers } from './tiers';
import { ACTIVE_RANGE } from './spawning';
import { Entity, Herd } from './entity';
import { KINDS } from './animals';
import { mulberry32 } from '../core/rng';

/**
 * C2b: what a machine sheds is its own business, and what exists is the world's.
 *
 * `Roster`'s four thousand was a per-world cap that happened to match one laptop's tick budget —
 * C1 called it the threshold that is obviously wrong, and C2a broke the coincidence outright, since
 * after the tiers a world holds far more than it can think for. The decision taken is that the
 * population does not depend on the hardware and the *thinking* does: two players in one field see
 * the same deer, and the slower machine simply thinks for fewer of them.
 *
 * So there are two claims. Nothing disappears; and what is thought for is what is nearest.
 */
const flock = (many: number, from: number, to: number): Entity[] => {
  const kind = KINDS.sheep;
  const rng = mulberry32(7);
  const herd = new Herd(kind, 0, 0, 0, 0, 40);
  return Array.from({ length: many }, (_, n) => {
    // strung out along +x, so which of them is nearest is a fact and not a roll
    const x = from + ((to - from) * n) / Math.max(1, many - 1);
    const e = new Entity(kind, x, 0, herd, 'chunk', rng);
    herd.members.push(e);
    return e;
  });
};

describe('how many a machine thinks for', () => {
  it('thinks for all of them when it can afford to', () => {
    const tiers = new Tiers();
    const near = flock(40, 1, ACTIVE_RANGE - 2);
    tiers.sort([near], 0, 0, [], 1000);
    expect(tiers.live.length).toBe(40);
    expect(tiers.watched.length).toBe(40);
  });

  it('sheds the far edge first, and never what you are standing next to', () => {
    const tiers = new Tiers();
    const near = flock(40, 1, ACTIVE_RANGE - 2);
    tiers.sort([near], 0, 0, [], 10);

    expect(tiers.live.length, 'the budget was not applied at all').toBe(10);
    const kept = new Set(tiers.live);
    const nearest = [...near].sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).slice(0, 10);
    for (const one of nearest) {
      expect(kept.has(one), `a sheep ${one.x.toFixed(1)} tiles away was shed while further ones were kept`).toBe(true);
    }
  });

  it('does not change what exists: everything is still there to be told about', () => {
    const tiers = new Tiers();
    const near = flock(40, 1, ACTIVE_RANGE - 2);
    tiers.sort([near], 0, 0, [], 10);
    /*
     * The whole point, and the reason this is not a spawn cap. `watched` is what a player can be
     * told about, and it is untouched: everything the world holds near this player is still held,
     * still drawn, still there for anybody else looking at the same field. What the budget takes
     * away is a tick of thinking, which the coarse tier's closed forms give back.
     */
    expect(tiers.watched.length, 'a creature stopped existing because a machine was busy').toBe(40);
  });

  it('keeps the herds of whoever it kept, and no others', () => {
    const tiers = new Tiers();
    const one = flock(20, 1, 10), two = flock(20, ACTIVE_RANGE - 12, ACTIVE_RANGE - 2);
    tiers.sort([one, two], 0, 0, [], 20);
    expect(tiers.live.length).toBe(20);
    for (const e of tiers.live) {
      expect(tiers.liveHerds.has(e.herd), 'a creature is thought for and its herd is not').toBe(true);
    }
  });
});

describe('the budget itself', () => {
  it('falls when a tick costs more than its share, and rises when it costs less', () => {
    const dear = new Pace(800);
    // a tenth of a second a tick for eight hundred creatures is far past a fifth of a 0.1s tick
    for (let n = 0; n < 200; n++) dear.measured(0.1, 0.1, 800);
    expect(dear.many, 'a machine that cannot keep up went on promising the same crowd').toBeLessThan(800);

    const cheap = new Pace(200);
    for (let n = 0; n < 200; n++) cheap.measured(0.0002, 0.1, 200);
    expect(cheap.many, 'a fast machine was held to a slow machine’s crowd').toBeGreaterThan(200);
  });

  it('never sheds so far that a village square goes quiet', () => {
    const hopeless = new Pace(800);
    // an absurd cost: a whole tick spent on one creature
    for (let n = 0; n < 500; n++) hopeless.measured(0.1, 0.1, 1);
    expect(hopeless.many, 'a slow machine thought for nobody at all').toBeGreaterThanOrEqual(60);
  });

  it('does not run away on a clock that says nothing took any time', () => {
    // a throttled background tab, or a clock with a millisecond of resolution
    const blind = new Pace(800);
    for (let n = 0; n < 500; n++) blind.measured(0, 0.1, 800);
    expect(blind.many, 'a stopped clock moved the budget').toBe(800);
    const instant = new Pace(800);
    for (let n = 0; n < 500; n++) instant.measured(0, 0, 800);
    expect(instant.many).toBe(800);
  });

  it('settles rather than oscillating, which is what makes the far edge stop twitching', () => {
    const pace = new Pace(800);
    // a machine that costs a microsecond a creature: the budget it should find is 20,000 —
    // past the ceiling, so it should climb and stop there rather than overshooting about it
    for (let n = 0; n < 300; n++) pace.measured(pace.many * 0.000001, 0.1, pace.many);
    const settled = pace.many;
    for (let n = 0; n < 50; n++) pace.measured(pace.many * 0.000001, 0.1, pace.many);
    expect(Math.abs(pace.many - settled), 'the budget is still moving after three hundred ticks').toBeLessThan(2);
  });
});
