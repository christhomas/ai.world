/**
 * Every short sound the game makes, as what it is made of rather than as Web Audio calls (#578).
 *
 * All sound is synthesised, with no sample files, out of two voices: a tone (an oscillator whose
 * gain swells in ten milliseconds and dies away exponentially, and whose pitch may slide) and a burst
 * (white noise through a band-pass filter, dying away exponentially). The page plays these through Web
 * Audio (`audio.ts`); an installed app synthesises the same voices itself. So a sound is described
 * once and the two cannot drift apart.
 *
 * The bare numbers are frequencies in hertz, durations and start times in seconds and gains out of
 * one. They are left as they are on purpose: a tone at 420 beside a comment saying `owl` is a
 * description of a sound, and putting a name in front of the 420 would only be a longer way of
 * writing it.
 */
export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

export type SoundVoice =
  | { tone: number; dur: number; wave: Wave; gain: number; at: number; slide?: number }
  | { burst: number; dur: number; q: number; gain: number; at: number };

const tone = (freq: number, dur: number, wave: Wave, gain: number, at = 0, slide?: number): SoundVoice =>
  slide === undefined ? { tone: freq, dur, wave, gain, at } : { tone: freq, dur, wave, gain, at, slide };
const burst = (dur: number, freq: number, q: number, gain: number, at = 0): SoundVoice => ({ burst: freq, dur, q, gain, at });

export const SOUNDS = {
  footstep: (hard: boolean): SoundVoice[] => [burst(0.07, hard ? 1500 : 700, 1.2, hard ? 0.12 : 0.18)],

  /**
   * A blow landing. What it hits decides what it sounds like: meat is a dull slap, bone is a
   * sharper crack, and a shell or plate rings. Missing is just the air moving, which is quieter
   * and higher and is the whole reason a swing that connects feels different from one that does not.
   */
  hit: (on: 'flesh' | 'bone' | 'plate'): SoundVoice[] => {
    if (on === 'plate') return [tone(1100, 0.09, 'square', 0.07, 0, 700), burst(0.09, 2600, 3, 0.1)];
    if (on === 'bone') return [burst(0.07, 1800, 3.5, 0.16), tone(260, 0.1, 'triangle', 0.1, 0, 150)];
    return [burst(0.11, 420, 0.9, 0.2), tone(120, 0.14, 'sine', 0.16, 0, 70)];
  },

  /** A swing through empty air. */
  miss: (): SoundVoice[] => [burst(0.13, 1150, 0.7, 0.055)],

  /**
   * A creature's voice, pitched to its size: `weight` is roughly how big it is against a person,
   * so a bat squeaks and a troll bellows off the same two lines.
   */
  voice: (weight: number, dying = false): SoundVoice[] => {
    const base = 620 / Math.max(0.35, weight);
    const dur = dying ? 0.5 : 0.26;
    return [tone(base, dur, 'sawtooth', 0.09, 0, dying ? base * 0.45 : base * 0.8), burst(dur * 0.7, base * 1.6, 1.4, dying ? 0.09 : 0.06, 0.02)];
  },

  blip: (random: () => number = Math.random): SoundVoice[] => [tone(880 + random() * 80, 0.035, 'square', 0.04)],
  chime: (): SoundVoice[] => [tone(660, 0.12, 'sine', 0.12), tone(990, 0.16, 'sine', 0.12, 0.11)],
  jingle: (): SoundVoice[] => [523, 659, 784].map((f, i) => tone(f, 0.16, 'triangle', 0.14, i * 0.13)),
  fanfare: (): SoundVoice[] => [523, 659, 784, 1046].map((f, i) => tone(f, i === 3 ? 0.4 : 0.14, 'triangle', 0.14, i * 0.12)),
  thud: (): SoundVoice[] => [tone(140, 0.22, 'sine', 0.3, 0, 55), burst(0.12, 300, 0.8, 0.2)],
  select: (): SoundVoice[] => [tone(1200, 0.03, 'square', 0.03)],

  /** Something heavy meeting water: a low thump under a long hiss of spray. */
  splash: (): SoundVoice[] => [tone(90, 0.3, 'sine', 0.22, 0, 40), burst(0.5, 900, 0.6, 0.16), burst(0.35, 2600, 0.4, 0.1, 0.06)],

  /** A whale calling: two long notes, the second bending up under the first. */
  whalesong: (): SoundVoice[] => [tone(196, 1.5, 'sine', 0.1), tone(147, 1.9, 'sine', 0.09, 0.35, 220)],
};

/** How long after a footstep the next one falls, in seconds, while walking. */
export const STRIDE = 0.27;
