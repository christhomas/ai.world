import { describe, expect, it } from 'vitest';
import { SOUNDS, type SoundVoice } from './sound-recipes';

/** Every sound the game can make, with the arguments that change it. */
const everySound = (): Array<[string, SoundVoice[]]> => [
  ['footstep on a road', SOUNDS.footstep(true)], ['footstep off one', SOUNDS.footstep(false)],
  ['hit flesh', SOUNDS.hit('flesh')], ['hit bone', SOUNDS.hit('bone')], ['hit plate', SOUNDS.hit('plate')],
  ['miss', SOUNDS.miss()], ['bat', SOUNDS.voice(0.2)], ['troll', SOUNDS.voice(4)], ['dying', SOUNDS.voice(1, true)],
  ['blip', SOUNDS.blip(() => 0.5)], ['chime', SOUNDS.chime()], ['jingle', SOUNDS.jingle()], ['fanfare', SOUNDS.fanfare()],
  ['thud', SOUNDS.thud()], ['select', SOUNDS.select()], ['splash', SOUNDS.splash()], ['whalesong', SOUNDS.whalesong()],
];

/**
 * The game's sounds, described once (#578): the page plays them through Web Audio and an installed
 * app synthesises the same voices, so what each is made of is what both hear.
 */
describe('the sounds the game makes, wherever they are played', () => {
  it('is made of voices any synthesiser can play: something to hear, for a while, starting on time', () => {
    for (const [name, voices] of everySound()) {
      expect(voices.length, name).toBeGreaterThan(0);
      for (const v of voices) {
        const pitch = 'tone' in v ? v.tone : v.burst;
        expect(pitch, name).toBeGreaterThan(20);
        expect(v.dur, name).toBeGreaterThan(0);
        expect(v.gain, name).toBeGreaterThan(0);
        expect(v.gain, name).toBeLessThanOrEqual(1);
        expect(v.at, name).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pitches a voice to the size of whoever makes it, and lets the dying fall further', () => {
    const pitch = (voices: SoundVoice[]) => (voices[0] as { tone: number }).tone;
    expect(pitch(SOUNDS.voice(0.2))).toBeGreaterThan(pitch(SOUNDS.voice(4)));
    const dying = SOUNDS.voice(1, true)[0] as { tone: number; slide: number };
    const calling = SOUNDS.voice(1)[0] as { tone: number; slide: number };
    expect(dying.slide / dying.tone).toBeLessThan(calling.slide / calling.tone);
  });

  it('plays a fanfare in order and holds its last note longest', () => {
    const notes = SOUNDS.fanfare();
    expect(notes.map((n) => n.at)).toEqual([...notes.map((n) => n.at)].sort((a, b) => a - b));
    expect(Math.max(...notes.map((n) => n.dur))).toBe(notes.at(-1)!.dur);
  });
});
