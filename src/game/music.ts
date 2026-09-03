import { Biome } from '../world/biomes';

/**
 * Procedural soundtrack: a slow arpeggio over a drone, both synthesised. Each biome picks a mode
 * and a root; night drops the octave and slows the tempo. No loops, no files.
 */
const SCALES = {
  // semitone offsets from the root
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
  lydian: [0, 2, 4, 6, 9],
  dorian: [0, 2, 3, 7, 9],
} as const satisfies Record<string, readonly number[]>;

interface Mood { root: number; scale: readonly number[]; tempo: number; wave: OscillatorType }

const MOODS: Record<Biome, Mood> = {
  [Biome.Plains]: { root: 261.63, scale: SCALES.major, tempo: 0.55, wave: 'triangle' },
  [Biome.Forest]: { root: 220.0, scale: SCALES.dorian, tempo: 0.65, wave: 'sine' },
  [Biome.Desert]: { root: 196.0, scale: SCALES.lydian, tempo: 0.85, wave: 'triangle' },
  [Biome.Swamp]: { root: 174.61, scale: SCALES.minor, tempo: 0.95, wave: 'sine' },
  [Biome.Mountain]: { root: 246.94, scale: SCALES.minor, tempo: 0.75, wave: 'triangle' },
  [Biome.Snow]: { root: 293.66, scale: SCALES.major, tempo: 0.9, wave: 'sine' },
};

const CAVE: Mood = { root: 130.81, scale: SCALES.minor, tempo: 1.4, wave: 'sine' };

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private drone: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  private step = 0;
  private nextNote = 0;
  private mood: Mood = MOODS[Biome.Plains];
  private night = 0;
  private wantVolume = 0.35;

  /** Attach to the same context as the sound effects, once it exists. */
  attach(ctx: AudioContext, master: GainNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.wantVolume;
    this.out.connect(master);
    const mk = (detune: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = this.mood.root / 2;
      osc.detune.value = detune;
      return osc;
    };
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const osc = mk(-6), osc2 = mk(7);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    osc.connect(filter); osc2.connect(filter);
    filter.connect(gain).connect(this.out);
    osc.start(); osc2.start();
    this.drone = { osc, osc2, gain };
    this.nextNote = ctx.currentTime + 0.5;
  }

  setVolume(v: number): void {
    this.wantVolume = 0.5 * v;
    if (this.out) this.out.gain.value = this.wantVolume;
  }

  setScene(biome: Biome, night: number, cave: boolean): void {
    const mood = cave ? CAVE : MOODS[biome];
    if (mood !== this.mood && this.drone) {
      this.drone.osc.frequency.setTargetAtTime(mood.root / 2, this.ctx!.currentTime, 1.5);
      this.drone.osc2.frequency.setTargetAtTime(mood.root / 2, this.ctx!.currentTime, 1.5);
    }
    this.mood = mood;
    this.night = night;
  }

  /** Schedules the next note when its time comes; call once per frame. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const beat = this.mood.tempo * (1 + this.night * 0.5);
    while (this.nextNote < ctx.currentTime + 0.25) {
      this.playNote(this.nextNote);
      this.nextNote += beat;
    }
  }

  private playNote(at: number): void {
    const ctx = this.ctx!;
    const { root, scale, wave } = this.mood;
    // a wandering arpeggio: mostly steps, occasional leaps, octave down at night
    const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
    const degree = scale[pattern[this.step % pattern.length] % scale.length];
    const octave = this.night > 0.5 ? 0.5 : this.step % 16 < 8 ? 1 : 2;
    const freq = root * octave * Math.pow(2, degree / 12);
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const peak = 0.06 * (1 - this.night * 0.35);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    osc.connect(g).connect(this.out!);
    osc.start(at);
    osc.stop(at + 1.2);
    this.step++;
  }
}
