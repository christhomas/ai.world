import { describe, expect, it } from 'vitest';
import { SHAFT, overAShaft, shaftIn, shaftsAround } from '../world/shafts';
import { createShafts, openCountry } from './shafts';
import { GameState } from './state';

/**
 * A hole in the ground that only opens to equipment.
 *
 * Everything else underground in this world opens to persistence: walk far enough, fight hard
 * enough, find the cave mouth. A shaft opens to a hundred and forty gold of folded silk and to
 * nothing else, which is what makes buying the silk a decision about where the map is open to you.
 * So the two things worth pinning are that it takes somebody carrying it, and that it plainly does
 * not take somebody who is not.
 */

function walking(carrying: boolean) {
  const state = new GameState();
  if (carrying) state.give('parachute', 1);
  const said: string[] = [];
  const found: string[] = [];
  const entered: Array<{ id: string; style: string }> = [];
  let underground: unknown = null;
  let at = { x: 0, z: 0 };
  const places = {
    get underground() { return underground; },
    indoors: null as unknown,
    enterDungeon: (poi: { name: string }, style: string, id: string) => {
      entered.push({ id, style });
      underground = { poi };
    },
  };
  const shafts = createShafts({
    seed: 4,
    state,
    places: places as never,
    hero: () => at,
    outdoors: () => underground === null,
    couldBe: () => true,
    say: (line) => said.push(line),
    discover: (name) => found.push(name),
  });
  return {
    state, said, found, entered, shafts,
    walkTo: (x: number, z: number) => { at = { x, z }; },
    climbOut: () => { underground = null; },
  };
}

describe('where the shafts are', () => {
  it('is the same hole in every session and a different one in every world', () => {
    const one = shaftIn(1, 2, 4);
    expect(shaftIn(1, 2, 4)).toEqual(one);
    expect(shaftIn(1, 2, 5).id).not.toBe(one.id);
    expect(one.id).toContain('shaft:');
  });

  it('is close enough to be a feature of the country', () => {
    // a walk across a county passes some: they are landmarks, not rumours
    expect(shaftsAround(0, 0, SHAFT.SPACING * 2, 4).length).toBeGreaterThan(8);
  });

  it('is only underfoot when you are actually standing in the mouth', () => {
    const one = shaftIn(0, 0, 4);
    expect(overAShaft(one.x, one.z, 4)?.id).toBe(one.id);
    expect(overAShaft(one.x + SHAFT.MOUTH + 0.5, one.z, 4), 'the rim swallowed somebody walking past').toBe(null);
  });
});

describe('what counts as ground a shaft could be in', () => {
  const country = {
    heightAt: () => 1 as number | null,
    isRoad: () => false,
    peopled: () => false,
    blocked: () => false,
  };

  it('is land, off the road, out of the village and with nothing standing on it', () => {
    expect(openCountry(country, 0, 0)).toBe(true);
    expect(openCountry({ ...country, heightAt: () => null }, 0, 0), 'a shaft in the sea').toBe(false);
    expect(openCountry({ ...country, isRoad: () => true }, 0, 0), 'a shaft in the road').toBe(false);
    expect(openCountry({ ...country, peopled: () => true }, 0, 0), 'a shaft in the market place').toBe(false);
    expect(openCountry({ ...country, blocked: () => true }, 0, 0), 'a shaft under a cottage').toBe(false);
  });
});

describe('stepping into one', () => {
  const hole = shaftIn(0, 0, 4);

  it('takes you down when you are carrying silk', () => {
    const game = walking(true);
    game.walkTo(hole.x, hole.z);
    game.shafts.step(1 / 60);
    expect(game.entered, 'he walked over it and nothing happened').toEqual([{ id: hole.id, style: 'cave' }]);
    expect(game.found, 'the place was not written down anywhere').toContain(hole.name);
  });

  it('tells you what you would need when you are not, and then holds its tongue', () => {
    const game = walking(false);
    game.walkTo(hole.x, hole.z);
    for (let n = 0; n < 60; n++) game.shafts.step(1 / 60);
    expect(game.entered, 'he fell in with nothing to slow him').toEqual([]);
    expect(game.said.length, 'it explained the drop sixty times').toBe(1);
    expect(game.said[0]).toContain(hole.name);
  });

  it('does not drop you straight back down the one you climbed out of', () => {
    const game = walking(true);
    game.walkTo(hole.x, hole.z);
    game.shafts.step(1 / 60);
    expect(game.entered.length).toBe(1);

    // coming up puts him at the mouth, which is the middle of the hole he just left
    game.climbOut();
    for (let n = 0; n < 60; n++) game.shafts.step(1 / 60);
    expect(game.entered.length, 'the hole ate him again the moment he got out').toBe(1);

    // and once he has walked off it, it is a hole in the ground again
    game.walkTo(hole.x + 20, hole.z);
    game.shafts.step(1 / 60);
    game.walkTo(hole.x, hole.z);
    game.shafts.step(1 / 60);
    expect(game.entered.length, 'he could not go back down a shaft he had left').toBe(2);
  });
});
