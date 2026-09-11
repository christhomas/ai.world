import { describe, expect, it } from 'vitest';
import { HEALTH } from '../world/health';
import { MAELSTROM, maelstromIn, maelstromsAround, swallowing, tollOf } from '../world/maelstroms';
import { createSwallows } from './swallows';
import { GameState } from './state';

/**
 * The water that goes down.
 *
 * The bargain is the feature: at least half your hearts to be taken, sometimes all of them, and
 * twice the treasure of anywhere else at the bottom. What has to hold for that to be a gamble
 * rather than a trap is that it is *findable* — a fixed place in the world, not an event that
 * happens to you — and that surviving it puts you somewhere you can play from.
 */

/** Enough of the game for a whirlpool to have somebody to take. */
function atSea(hp: number = HEALTH.FULL) {
  const state = new GameState();
  state.hp = hp;
  const said: string[] = [];
  const knockouts: string[] = [];
  const entered: Array<{ id: string; style: string }> = [];
  let underground: unknown = null;
  // a boat that remembers where it was put, which is the half of this that matters on the way out
  const sailing = {
    sailing: true, x: 0, z: 0,
    abandon() { this.sailing = false; },
    board() { this.sailing = true; },
  };
  const places = {
    get underground() { return underground; },
    enterDungeon: (poi: { name: string }, style: string, id: string) => {
      entered.push({ id, style });
      underground = { poi };
    },
  };
  const world = createSwallows({
    seed: 3,
    state,
    places: places as never,
    sailing: sailing as never,
    hull: () => (sailing.sailing ? { x: sailing.x, z: sailing.z } : hull),
    say: (line) => said.push(line),
    knockOut: (why) => knockouts.push(why),
  });
  let hull = { x: 0, z: 0 };
  return {
    state, said, knockouts, entered, sailing, world,
    sailTo: (x: number, z: number) => { hull = { x, z }; sailing.x = x; sailing.z = z; },
    surface: () => { underground = null; },
  };
}

describe('where the whirlpools are', () => {
  it('is a fact about a world, not an accident that happens to you', () => {
    const one = maelstromIn(2, -3, 9);
    expect(maelstromIn(2, -3, 9), 'it moved between two askings').toEqual(one);
    expect(maelstromIn(2, -3, 10).id, 'two worlds put theirs in the same place').not.toBe(one.id);
    // named for where it is rather than what it is called: two of them may share a name and must
    // not share an anchor
    expect(one.id).toContain('sunken:');
  });

  it('is rare enough that most of the sea is sea', () => {
    // a long crossing, and how much of it is inside turning water
    let caught = 0, looked = 0;
    for (let x = 0; x < 4000; x += 7) {
      looked++;
      if (swallowing(x, 250, 9)) caught++;
    }
    expect(caught / looked, 'the sea is more whirlpool than water').toBeLessThan(0.02);
    // and yet a long enough sail passes one: they are findable, not mythical
    expect(maelstromsAround(0, 0, MAELSTROM.SPACING * 2, 9).length).toBeGreaterThan(3);
  });

  it('takes a hull only at its middle, so it can be steered round once seen', () => {
    const one = maelstromIn(0, 0, 9);
    expect(swallowing(one.x, one.z, 9)?.id, 'sailing into the middle was not enough').toBe(one.id);
    expect(swallowing(one.x + MAELSTROM.MOUTH + 0.5, one.z, 9), 'the rim took a boat that skirted it').toBe(null);
    expect(swallowing(one.x + MAELSTROM.RADIUS + 1, one.z, 9)).toBe(null);
  });
});

describe('what it costs', () => {
  it('is never less than half of you and never more than all of you', () => {
    for (let cell = 0; cell < 40; cell++) {
      const one = maelstromIn(cell, cell * 3, 5);
      for (let day = 1; day < 8; day++) {
        const toll = tollOf(one, 5, day);
        expect(toll).toBeGreaterThanOrEqual(MAELSTROM.TOLL.least);
        expect(toll).toBeLessThanOrEqual(MAELSTROM.TOLL.most);
      }
    }
  });

  it('is the same for everybody watching the same descent', () => {
    const one = maelstromIn(1, 1, 5);
    expect(tollOf(one, 5, 3)).toBe(tollOf(one, 5, 3));
    // and a different day is a different roll: it is a gamble each time, not a fact about a place
    const rolls = new Set([1, 2, 3, 4, 5].map((day) => tollOf(one, 5, day)));
    expect(rolls.size, 'the same whirlpool cost the same every day of the world').toBeGreaterThan(1);
  });
});

describe('being taken down', () => {
  const where = maelstromIn(0, 0, 3);
  /**
   * A day whose roll is survivable, found rather than assumed.
   *
   * The toll is between half your hearts and all of them, and which it is on a given day is not
   * something a test gets to choose — that unpredictability is the feature. So a test about
   * *surviving* one has to go and find a day it can be survived on, exactly as a player who wanted
   * a sure thing would have to.
   */
  const kindDay = (() => {
    for (let day = 1; day < 60; day++) if (tollOf(where, 3, day) < 0.85) return day;
    throw new Error('this whirlpool is fatal every day of its life');
  })();

  it('costs hearts, leaves the boat at the rim, and puts you in the cavern under it', () => {
    const game = atSea(100);
    game.state.day = kindDay;
    game.sailTo(where.x, where.z);
    game.world.check();
    expect(game.entered.length, 'the sea swallowed him and nothing happened').toBe(1);
    expect(game.entered[0], 'it was not a drowned cavern').toEqual({ id: where.id, style: 'sunken' });
    expect(game.state.hp, 'it cost him nothing').toBeLessThan(HEALTH.FULL / 2);
    expect(game.sailing.sailing, 'he went down still sailing').toBe(false);
  });

  it('carries you to a town instead when it takes everything', () => {
    // a scratch left in hand and half your health owed: this is the roll nobody can see coming
    const game = atSea(HEALTH.A_SCRATCH);
    game.state.day = kindDay;
    game.sailTo(where.x, where.z);
    game.world.check();
    expect(game.knockouts.length, 'he survived what should have finished him').toBe(1);
    expect(game.entered.length, 'a man with no hearts left went treasure hunting').toBe(0);
  });

  it('puts you back on the deck when you come up, because the sea is no place to stand', () => {
    const game = atSea(100);
    game.state.day = kindDay;
    game.sailTo(where.x, where.z);
    game.world.check();
    expect(game.sailing.sailing).toBe(false);

    // below, nothing happens however long he is down there
    game.world.check();
    expect(game.world.under?.id).toBe(where.id);

    game.surface();
    game.world.check();
    expect(game.sailing.sailing, 'he surfaced in open water with no boat').toBe(true);
    expect(game.world.under, 'the game still thinks he is under').toBe(null);
  });

  it('does not take the same boat twice on the way out', () => {
    const game = atSea(100);
    game.state.day = kindDay;
    game.sailTo(where.x, where.z);
    game.world.check();
    game.surface();
    game.world.check();          // aboard again, and the boat is where it was left: at the rim
    const wentDown = game.entered.length;
    for (let n = 0; n < 10; n++) game.world.check();
    expect(game.entered.length, 'it swallowed him again before he could steer off').toBe(wentDown);
    expect(game.state.hp, 'and took more hearts for it').toBeGreaterThan(0);
  });
});
