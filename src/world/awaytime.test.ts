import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AWAY_TIME, daysAway, daysToLive } from './awaytime';
import { DAY_LENGTH } from '../../server/protocol';

/**
 * What a world does while nobody is looking at it, in the single player game.
 *
 * The two worlds need opposite work here and only look the same from outside. A **shared** world
 * needs nothing at all: `server/sim.ts` keeps stepping whether or not anybody is connected, and
 * `register.advance(today)` walks the days, so a player rejoins at the day the world reached. A
 * **single player** world freezes — `state.ts` restores the saved day and there is no wall clock
 * anywhere in the save.
 *
 * So elapsed time has to be *invented* on this side, and this is the invention.
 *
 * ## Why offline days are slower than lived ones
 *
 * `DAY_LENGTH` is 7200: two real hours per world day while somebody is playing. At that rate a week
 * away is eighty-four days, and `LIFE.LONGEST_LIFE` is ninety — so a holiday would bury everyone who
 * ever knew you, and you would come back to a village of strangers standing on your friends' graves.
 *
 * About a real day per world day instead. A week away is a week of village life: long enough that
 * things moved, short enough that the people you knew are the people you left. No hard cap, because
 * a cap is a cliff — somebody who has been away six months should find a world that moved on, not
 * one that stopped politely at the ninetieth day waiting for them.
 */

describe('how much of the world passes while nobody watches', () => {
  it('runs slower than a day anybody actually lived through', () => {
    expect(AWAY_TIME.A_DAY).toBeGreaterThan(DAY_LENGTH);
  });

  it('gives an hour away almost nothing, which is what stepping out for lunch should cost', () => {
    expect(daysAway(3600)).toBeLessThan(1);
  });

  it('gives a week away about a week, rather than a lifetime', () => {
    const week = daysAway(7 * 24 * 3600);
    expect(week).toBeGreaterThan(4);
    expect(week, 'a holiday must not bury everybody who knew you').toBeLessThan(14);
  });

  it('never runs backwards, whatever the clock says', () => {
    // a machine whose clock was wrong, or corrected while the game was shut: the one case where a
    // naive subtraction hands back a negative and a village un-lives a fortnight
    expect(daysAway(-99999)).toBe(0);
    expect(daysAway(Number.NaN)).toBe(0);
  });

  it('has no cap, because a cap is a cliff', () => {
    const year = daysAway(365 * 24 * 3600);
    const decade = daysAway(3650 * 24 * 3600);
    expect(decade).toBeGreaterThan(year);
  });

  it('is whole days, because a village lives a day at a time', () => {
    for (const seconds of [0, 100, 90000, 8e6]) {
      expect(Number.isInteger(daysAway(seconds)), `${seconds}`).toBe(true);
    }
  });
});

/*
 * And the save, which is the only thing that knows how long the game was shut for.
 */
describe('a save that remembers when it was written', () => {
  it('stamps the moment it was saved, so there is something to measure from', async () => {
    const { GameState } = await import('../game/state');
    const json = new GameState().toJSON();
    expect(typeof json.savedAt).toBe('number');
    expect(json.savedAt!).toBeGreaterThan(0);
  });

  it('works out the days away as the save is read, and no later', async () => {
    const { GameState } = await import('../game/state');
    const week = new GameState().toJSON();
    week.savedAt = Date.now() - 7 * 24 * 3600 * 1000;
    const back = GameState.from(week);
    expect(back.awayFor).toBeGreaterThan(4);
    expect(back.awayFor, 'a week away must not be a lifetime').toBeLessThan(14);
  });

  it('treats a save written before there was a clock as a world away for no time', async () => {
    const { GameState } = await import('../game/state');
    const old = new GameState().toJSON();
    delete old.savedAt;
    expect(GameState.from(old).awayFor).toBe(0);
  });

  it('remembers whether the body was in a bed, which is what makes leaving clean', async () => {
    const { GameState } = await import('../game/state');
    const state = new GameState();
    state.lodged = true;
    expect(GameState.from(state.toJSON()).lodged).toBe(true);
    expect(GameState.from(new GameState().toJSON()).lodged, 'nobody is lodged by default').toBe(false);
  });
});

describe('whose clock has been running', () => {
  it('lives the days a world of one froze through', () => {
    expect(daysToLive(6, false)).toBe(6);
  });

  it('lives none of them in a world somebody else has been stepping', () => {
    /*
     * The one way this feature can do real damage rather than merely nothing. `server/sim.ts` steps
     * a shared world whether or not anybody is connected, so those days have already been lived —
     * once, properly, with everybody else's doings in them. Living them again on the way in would
     * age every village twice: two harvests for one summer, two winters of funerals, children born
     * to parents the server has already buried.
     */
    expect(daysToLive(6, true)).toBe(0);
    expect(daysToLive(365, true)).toBe(0);
  });

  it('refuses a negative however it arrived', () => {
    // a machine whose clock was corrected while the game was shut, which is the field case
    expect(daysToLive(-4, false)).toBe(0);
    expect(daysToLive(Number.NaN, false)).toBe(0);
  });

  it('is asked of the link rather than of the connection', () => {
    /*
     * Playing alone connects too — to a private worker, started fresh with the day this save hands
     * it — so `online.connected` is true either way and says nothing about whose clock ran. Read
     * from the source, because the distinction is invisible in the types and was the whole fault.
     */
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    expect(main).toContain("daysToLive(state.awayFor, url.searchParams.has('server'))");
    expect(main, 'the connection is not what decides this').not.toMatch(/daysToLive\([^)]*online\.connected/);
  });
});
