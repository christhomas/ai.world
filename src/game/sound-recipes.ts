import { Biome } from '../world/biomes';

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
  /** `rise` is how long the tone takes to swell, ten milliseconds if it does not say. */
  | { tone: number; dur: number; wave: Wave; gain: number; at: number; slide?: number; rise?: number }
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

/**
 * The creatures a place is heard to have, one call at a time over its wind (#578): a drip
 * underground, an owl at night, a frog in a swamp, birds in fields and woods, an eagle in the
 * mountains, and nothing at all in a desert. `next` is how long until the next one.
 */
export function wildlifeCall(biome: Biome, night: number, cave: boolean, random: () => number = Math.random): { voices: SoundVoice[]; next: number } {
  if (cave) return { voices: [tone(1800 + random() * 1200, 0.08, 'sine', 0.05, 0, 900)], next: 1 + random() * 4 };
  let next = 2 + random() * 7;
  if (night > 0.6) return { voices: random() < 0.35 ? [tone(420, 0.25, 'sine', 0.06), tone(350, 0.35, 'sine', 0.06, 0.3)] : [], next };
  if (biome === Biome.Swamp) return { voices: [tone(130, 0.12, 'sawtooth', 0.05), tone(120, 0.14, 'sawtooth', 0.05, 0.16)], next };
  if (biome === Biome.Plains || biome === Biome.Forest) {
    const f = 1800 + random() * 900;
    if (biome === Biome.Forest) next *= 0.6;
    return { voices: [0, 1, 2].map((i) => tone(f, 0.07, 'sine', 0.05, i * 0.1, f * 1.25)), next };
  }
  if (biome === Biome.Mountain && random() < 0.3) return { voices: [tone(2400, 0.5, 'sine', 0.04, 0, 1800)], next };
  return { voices: [], next };
}

/**
 * The height of fall, in world units, that water makes as much noise as it ever will at. Anything
 * taller is the same roar — which is the only reason this is a number and not simply the drop:
 * without a ceiling a hundred-foot fall would drown the game out from across the valley.
 */
export const FULL_ROAR = 12;

/**
 * The beds under every other sound (#578), each a voice that never stops and is only turned up and
 * down: wind, which is noise through a low-pass whose corner wanders ±180 Hz about 400 at 0.13 Hz;
 * water, noise through a band-pass; and the soundtrack's drone, two sines a few cents either side
 * of half the mood's root. The page holds them as Web Audio nodes and an installed app renders them.
 */
export const BEDS = { WIND_CUTOFF: 400, WIND_SWAY: 180, WIND_SWAY_HZ: 0.13, WIND_Q: 0.7, DRONE_GAIN: 0.05, DRONE_CENTS: [-6, 7] } as const;

/** How loud the wind is here: higher in open, high or bare country, quieter at night, a breath underground. */
export function windLevel(biome: Biome, night: number, cave: boolean): number {
  if (cave) return 0.012;
  const windy = biome === Biome.Desert || biome === Biome.Snow || biome === Biome.Mountain;
  return (windy ? 0.07 : 0.025) * (1 - night * 0.4);
}

/**
 * Water within earshot. `nearness` is nought out of earshot and one standing in it; `drop` is the
 * height of the biggest fall in earshot, which decides whether this is a brook or something you
 * have to raise your voice over: a fall is louder, broader and lower than a brook.
 */
export function waterBed(nearness: number, drop: number, cave: boolean): { gain: number; centre: number; q: number } {
  const wet = Math.max(0, Math.min(1, nearness));
  const loud = Math.min(1, drop / FULL_ROAR);
  return { gain: wet * (0.035 + loud * 0.16) * (cave ? 0.6 : 1), centre: 1500 - loud * 950, q: 0.5 + loud * 0.9 };
}
