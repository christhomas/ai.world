import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { CAVE, MOODS, beat, noteAt, pluck } from './music-score';

/**
 * The soundtrack's notes, which the page and an installed app both play (#578): the same tune,
 * slower, quieter and an octave down in the dark.
 */
describe('the soundtrack, wherever it is played', () => {
  it('walks the mode up and down from the root, an octave up for half of every sixteen notes', () => {
    const mood = MOODS[Biome.Plains];
    expect(noteAt(0, mood, 0).freq).toBeCloseTo(mood.root, 5);
    expect(noteAt(8, mood, 0).freq).toBeCloseTo(mood.root * 2, 5);
    for (let step = 0; step < 16; step++) {
      const { freq } = noteAt(step, mood, 0);
      expect(freq).toBeGreaterThanOrEqual(mood.root);
      expect(freq).toBeLessThan(mood.root * 4);
    }
  });

  it('plays slower, quieter and an octave down when it is properly dark', () => {
    const mood = MOODS[Biome.Forest];
    expect(beat(mood, 1)).toBeGreaterThan(beat(mood, 0));
    expect(noteAt(0, mood, 1).peak).toBeLessThan(noteAt(0, mood, 0).peak);
    expect(noteAt(0, mood, 1).freq).toBeCloseTo(mood.root / 2, 5);
    expect(beat(CAVE, 0)).toBeGreaterThan(beat(mood, 0));
  });

  it('is a plucked note: a slower swell than a sound effect, ringing for a second', () => {
    const note = pluck(noteAt(3, MOODS[Biome.Snow], 0), 0.5, 0.1);
    expect(note).toMatchObject({ dur: 1.1, rise: 0.04, at: 0.1 });
    expect('tone' in note && note.gain).toBeCloseTo(0.03, 5);
  });
});
