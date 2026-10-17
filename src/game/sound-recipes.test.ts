import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { SOUNDS, waterBed, wildlifeCall, windLevel, type SoundVoice } from './sound-recipes';

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

  it('hears the creatures of the place: drips below, owls at night, frogs, birds, eagles, and a quiet desert', () => {
    const always = () => 0;
    expect(wildlifeCall(Biome.Plains, 0, true, always).voices[0]).toMatchObject({ tone: 1800, slide: 900 });
    expect(wildlifeCall(Biome.Plains, 0, true, always).next, 'a cave drips more often').toBe(1);
    expect(wildlifeCall(Biome.Forest, 0.9, false, always).voices.map((v) => 'tone' in v && v.tone)).toEqual([420, 350]);
    expect(wildlifeCall(Biome.Swamp, 0, false, always).voices.every((v) => 'tone' in v && v.wave === 'sawtooth')).toBe(true);
    const birds = wildlifeCall(Biome.Forest, 0, false, always);
    expect(birds.voices.map((v) => v.at)).toEqual([0, 0.1, 0.2]);
    expect(birds.next, 'a wood is busier than a field').toBeCloseTo(wildlifeCall(Biome.Plains, 0, false, always).next * 0.6);
    expect(wildlifeCall(Biome.Mountain, 0, false, always).voices).toHaveLength(1);
    expect(wildlifeCall(Biome.Desert, 0, false, always).voices).toEqual([]);
    for (const biome of [Biome.Plains, Biome.Forest, Biome.Swamp, Biome.Mountain]) {
      for (const v of wildlifeCall(biome, 0, false, always).voices) expect(v.gain).toBeLessThanOrEqual(0.06);
    }
  });

  it('turns the beds up and down as the page does: wind in open country, roaring water at a fall', () => {
    expect(windLevel(Biome.Snow, 0, false)).toBeGreaterThan(windLevel(Biome.Plains, 0, false));
    expect(windLevel(Biome.Snow, 1, false), 'night stills the wind').toBeCloseTo(windLevel(Biome.Snow, 0, false) * 0.6);
    expect(windLevel(Biome.Snow, 0, true), 'a breath underground').toBe(0.012);
    expect(waterBed(0, 30, false).gain, 'out of earshot is silent').toBe(0);
    const brook = waterBed(1, 0, false), fall = waterBed(1, 30, false);
    expect(fall.gain).toBeGreaterThan(brook.gain);
    expect(fall.centre, 'a fall is lower than a brook').toBeLessThan(brook.centre);
    expect(waterBed(1, 30, false)).toEqual(waterBed(1, 12, false));
    expect(waterBed(1, 6, true).gain).toBeCloseTo(waterBed(1, 6, false).gain * 0.6);
  });
});
