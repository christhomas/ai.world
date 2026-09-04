import { describe, expect, it } from 'vitest';
import { personWins } from './places';

/**
 * The first errand of a new save is taken and paid in the village square, and a market pitch
 * stands in the middle of that square. Enter reached the pitch from anywhere in it, and offline a
 * pitch only says to come back online, so the errand could be taken and never handed in. These
 * pin the rule that fixed it.
 */
describe('who answers a keypress', () => {
  it('gives it to somebody standing nearer than the scenery', () => {
    // the elder at arm's length, the trestle across the square
    expect(personWins(0, 0, { x: 0.8, z: 0 }, 4, 0)).toBe(true);
  });

  it('leaves it with the scenery you are standing in front of', () => {
    // somebody wandering past behind you is not who you meant
    expect(personWins(0, 0, { x: 3, z: 0 }, 0.5, 0)).toBe(false);
  });

  it('leaves it with the scenery when nobody is about', () => {
    expect(personWins(0, 0, null, 5, 5)).toBe(false);
  });

  it('measures from the player rather than between the two', () => {
    // person and pitch close together, both far from the hero: still whoever is nearer to them
    expect(personWins(0, 0, { x: 9.5, z: 0 }, 10, 0)).toBe(true);
    expect(personWins(0, 0, { x: 10, z: 0 }, 9.5, 0)).toBe(false);
  });
});
