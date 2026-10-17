import { Biome } from '../world/biomes';
import type { SoundVoice } from './sound-recipes';

/**
 * The procedural soundtrack's notes (#578): a slow arpeggio, each biome its own mode and root, the
 * dark slowing it, quietening it and dropping it an octave. The page plays it through Web Audio
 * (`music.ts`, with its drone under it) and an installed app plays the same notes, so the tune is
 * written once. No loops, no files.
 */
const SCALES = {
  // semitone offsets from the root
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
  lydian: [0, 2, 4, 6, 9],
  dorian: [0, 2, 3, 7, 9],
} as const satisfies Record<string, readonly number[]>;

export interface Mood { root: number; scale: readonly number[]; tempo: number; wave: 'sine' | 'triangle' }

export const MOODS: Record<Biome, Mood> = {
  [Biome.Plains]: { root: 261.63, scale: SCALES.major, tempo: 0.55, wave: 'triangle' },
  [Biome.Forest]: { root: 220.0, scale: SCALES.dorian, tempo: 0.65, wave: 'sine' },
  [Biome.Desert]: { root: 196.0, scale: SCALES.lydian, tempo: 0.85, wave: 'triangle' },
  [Biome.Swamp]: { root: 174.61, scale: SCALES.minor, tempo: 0.95, wave: 'sine' },
  [Biome.Mountain]: { root: 246.94, scale: SCALES.minor, tempo: 0.75, wave: 'triangle' },
  [Biome.Snow]: { root: 293.66, scale: SCALES.major, tempo: 0.9, wave: 'sine' },
};

export const CAVE: Mood = { root: 130.81, scale: SCALES.minor, tempo: 1.4, wave: 'sine' };

/**
 * What the dark does to the music. Not a mood of its own — the same tune, played the way somebody
 * would play it with the lamp low: slower, quieter, and dropped an octave once it is properly
 * night. Nought is noon and one is midnight, so each of these is what full dark is worth.
 */
const NIGHT = {
  /** How much longer a beat lasts at midnight than at noon. */
  SLOWER: 0.5,
  /** How much of a note's loudness the dark takes off. */
  QUIETER: 0.35,
  /** Dark enough to put the arpeggio down an octave, which is the only thing that reads as night. */
  DEEP: 0.5,
} as const;

/** How long a beat lasts in this mood at this darkness, in seconds. */
export function beat(mood: Mood, night: number): number {
  return mood.tempo * (1 + night * NIGHT.SLOWER);
}

/** The step'th note of the tune: its pitch, its wave and how loud it rings, out of one. */
export function noteAt(step: number, mood: Mood, night: number): { freq: number; wave: Mood['wave']; peak: number } {
  const { root, scale, wave } = mood;
  // a wandering arpeggio: mostly steps, occasional leaps, octave down at night
  const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
  const degree = scale[pattern[step % pattern.length] % scale.length];
  const octave = night > NIGHT.DEEP ? 0.5 : step % 16 < 8 ? 1 : 2;
  return { freq: root * octave * Math.pow(2, degree / 12), wave, peak: 0.06 * (1 - night * NIGHT.QUIETER) };
}

/**
 * A plucked note as a voice: up in a fortieth of a second and ringing away over the next second,
 * at `share` of its loudness, starting `at` seconds from now.
 */
export function pluck(note: { freq: number; wave: Mood['wave']; peak: number }, share: number, at: number): SoundVoice {
  return { tone: note.freq, dur: 1.1, wave: note.wave, gain: note.peak * share, at, rise: 0.04 };
}
