import { describe, expect, it } from 'vitest';
import { carriedTo, costOf, saidOfKnockout } from './knockout';

const villages = [
  { name: 'Far', x: 500, z: 500 },
  { name: 'Near', x: 10, z: 10 },
  { name: 'Middling', x: 90, z: 0 },
];

describe('being knocked out', () => {
  it('is somebody nearby carrying you, not the first village on a list', () => {
    expect(carriedTo(villages, 0, 0)!.name).toBe('Near');
    expect(carriedTo(villages, 480, 480)!.name).toBe('Far');
  });

  it('copes with a world that never grew a village, rather than crashing', () => {
    // the one bug on this path a player cannot recover from is the game throwing while they are
    // unconscious, so waking nowhere has to be a supported answer
    expect(carriedTo([], 0, 0)).toBeNull();
  });

  it('cannot take more than you are carrying', () => {
    expect(costOf(3, 10)).toBe(3);
    expect(costOf(50, 10)).toBe(10);
    expect(costOf(0, 10)).toBe(0);
  });

  it('says what got you, where you are, and what it cost', () => {
    const pages = saidOfKnockout('A wolf', { name: 'Ashford', x: 0, z: 0 }, 10, false);
    expect(pages[0]).toContain('A wolf');
    expect(pages[1]).toContain('Ashford');
    expect(pages[2]).toContain('10 gold');
  });

  it('has different words for waking up out of a hole in the ground', () => {
    const below = saidOfKnockout('Something', { name: 'Ashford', x: 0, z: 0 }, 0, true);
    expect(below[1]).toContain('daylight');
  });

  it('does not claim to have taken money off somebody with none', () => {
    const pages = saidOfKnockout('A wolf', { name: 'Ashford', x: 0, z: 0 }, 0, false);
    expect(pages[2]).not.toMatch(/\d+ gold lighter/);
  });
});
