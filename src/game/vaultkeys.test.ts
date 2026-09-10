import { describe, expect, it } from 'vitest';
import { lockFor } from './places';
import { GameState } from './state';

/**
 * A key you found is a door you opened.
 *
 * The fault this is about could not be seen from inside the room: the key was filed under the
 * floor's own id and read back under the anchor's, so the barred door opened when you turned the
 * key and was barred again the next time you walked in. Every vault in the game, for as long as
 * there have been keys, and nothing about it looked wrong until you left and came back.
 *
 * So what is pinned here is that one name is used at both ends, and that a save carries it.
 */
describe('the key to a vault', () => {
  it('is named the same whoever is asking', () => {
    expect(lockFor('dungeon:Redhollow', 1)).toBe('dungeon:Redhollow:1');
    // and a keep's floors are four different locks, which is three puzzles that stay puzzles
    const keep = [1, 2, 3, 4].map((floor) => lockFor('castle:Kestrelmarch', floor));
    expect(new Set(keep).size, 'two floors of a keep share a lock').toBe(4);
  });

  it('is still yours when you come back to the floor you found it on', () => {
    const state = new GameState();
    state.keys.add(lockFor('dungeon:Redhollow', 2));
    expect(state.keys.has(lockFor('dungeon:Redhollow', 2)), 'the door barred itself again').toBe(true);
    expect(state.keys.has(lockFor('dungeon:Redhollow', 1)), 'it opened a floor it was not cut for').toBe(false);
    expect(state.keys.has('dungeon:Redhollow'), 'the old unqualified spelling is gone for good').toBe(false);
  });

  it('survives being written down and read back', () => {
    const state = new GameState();
    state.keys.add(lockFor('dungeon:Redhollow', 2));
    const back = GameState.from(JSON.parse(JSON.stringify(state.toJSON())));
    expect(back.keys.has(lockFor('dungeon:Redhollow', 2)), 'the key was lost in the save').toBe(true);
  });
});
