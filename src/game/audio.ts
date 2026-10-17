import { Biome } from '../world/biomes';
import { Music } from './music';
import { SOUNDS, STRIDE, type SoundVoice } from './sound-recipes';

/**
 * All sound is synthesised with Web Audio: no sample files, in keeping with the no-textures rule.
 * The context is created on the first user gesture (browsers require it).
 *
 * The bare numbers below are frequencies in hertz, durations in seconds and gains out of one,
 * handed to `tone` and `burst` whose parameters already name them. They are left as they are on
 * purpose: `this.tone(420, 0.25, 'sine', 0.06)` beside a comment saying `owl` is a description of
 * a sound, and putting a name in front of the 420 would only be a longer way of writing it.
 */
/**
 * The height of fall, in world units, that water makes as much noise as it ever will at. Anything
 * taller is the same roar — which is the only reason this is a number and not simply the drop:
 * without a ceiling a hundred-foot fall would drown the game out from across the valley.
 */
const FULL_ROAR = 12;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  /** The river bed, so to speak: a second noise voice that swells as you come up on water. */
  private water: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wetness = 0;
  private stepTimer = 0;
  private chirpTimer = 3;
  private biome: Biome = Biome.Plains;
  private night = 0;
  /** Underground: drips instead of birds, no wind. */
  cave = false;
  volume: number;
  readonly music = new Music();

  constructor() {
    let v = 0.6;
    try { const s = localStorage.getItem('ai.world/volume'); if (s !== null) v = Number(s); } catch { /* ignore */ }
    this.volume = Number.isFinite(v) ? v : 0.6;
    const unlock = () => { this.ensure(); };
    const signal = this.listening.signal;
    window.addEventListener('keydown', unlock, { once: true, signal });
    window.addEventListener('pointerdown', unlock, { once: true, signal });
  }

  /** Everything this sound holds open, so silence can be complete. */
  private readonly listening = new AbortController();

  /** Hold the whole audio graph while the tab is hidden, and pick it up again after. */
  /** Nothing is audible while the game is paused, water included. */
  private hushWater(): void { if (this.water) this.water.gain.gain.value = 0; }

  quiet(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on) void ctx.suspend().catch(() => { /* already suspended */ });
    else void ctx.resume().catch(() => { /* the browser will unlock it on the next key */ });
  }

  /** Close the audio down: no wind, no music, no context left running. */
  dispose(): void {
    this.listening.abort();
    this.music.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.wind = null;
    void ctx?.close().catch(() => { /* already gone */ });
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
    this.music.setVolume(this.volume);
    try { localStorage.setItem('ai.world/volume', String(this.volume)); } catch { /* ignore */ }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      // 2 s of white noise, reused for wind, footsteps and thuds
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      this.wind = { gain, filter };

      // Water gets its own voice off the same noise buffer. A river is a soft hiss and a fall is
      // a loud one an octave lower, so one bed with a moving filter covers both and there is
      // nothing to load.
      const wsrc = ctx.createBufferSource();
      wsrc.buffer = buf; wsrc.loop = true;
      const wfilter = ctx.createBiquadFilter();
      wfilter.type = 'bandpass'; wfilter.frequency.value = 900; wfilter.Q.value = 0.5;
      const wgain = ctx.createGain();
      wgain.gain.value = 0;
      wsrc.connect(wfilter).connect(wgain).connect(this.master);
      wsrc.start();
      this.water = { gain: wgain, filter: wfilter };
      this.music.attach(ctx, this.master);
      this.music.setVolume(this.volume);
      return ctx;
    } catch {
      return null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number, rise = 0.01): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + rise);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, gain: number, when = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    // the same two seconds of noise every time would make every footstep the identical footstep,
    // so each burst is played at its own speed from its own place in the buffer
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  /** A sound as `sound-recipes.ts` describes it, which an installed app plays from the same description. */
  private play(voices: SoundVoice[]): void {
    for (const v of voices) {
      if ('tone' in v) this.tone(v.tone, v.dur, v.wave, v.gain, v.at, v.slide, v.rise);
      else this.burst(v.dur, v.burst, v.q, v.gain, v.at);
    }
  }

  footstep(hard: boolean): void { this.play(SOUNDS.footstep(hard)); }

  /**
   * How much water is audible from here, and how far it is falling.
   *
   * `nearness` is nought out of earshot and one standing in it; `drop` is the height of the
   * biggest fall within earshot, in world units, which decides whether this is a brook or
   * something you have to raise your voice over. Eased rather than set, so walking up to a river
   * fades in instead of switching on.
   */
  setWater(nearness: number, drop: number): void {
    this.wetness = Math.max(0, Math.min(1, nearness));
    const w = this.water;
    if (!w || !this.ctx) return;
    const loud = Math.min(1, drop / FULL_ROAR);
    w.gain.gain.value = this.wetness * (0.035 + loud * 0.16) * (this.cave ? 0.6 : 1);
    // a fall is broader and lower than a brook, which is most of what tells them apart
    w.filter.frequency.value = 1500 - loud * 950;
    w.filter.Q.value = 0.5 + loud * 0.9;
  }

  /** A blow landing: meat, bone or plate. See `SOUNDS.hit`. */
  hit(on: 'flesh' | 'bone' | 'plate'): void { this.play(SOUNDS.hit(on)); }

  /** A swing through empty air. */
  miss(): void { this.play(SOUNDS.miss()); }

  /** A creature's voice, pitched to its size. See `SOUNDS.voice`. */
  voice(weight: number, dying = false): void { this.play(SOUNDS.voice(weight, dying)); }
  blip(): void { this.play(SOUNDS.blip()); }
  chime(): void { this.play(SOUNDS.chime()); }
  jingle(): void { this.play(SOUNDS.jingle()); }
  fanfare(): void { this.play(SOUNDS.fanfare()); }
  thud(): void { this.play(SOUNDS.thud()); }
  select(): void { this.play(SOUNDS.select()); }

  /** Something heavy meeting water. */
  splash(): void { this.play(SOUNDS.splash()); }

  /** A whale calling. */
  whalesong(): void { this.play(SOUNDS.whalesong()); }

  setScene(biome: Biome, night: number): void {
    this.biome = biome;
    this.night = night;
    this.music.setScene(biome, night, this.cave);
  }

  /** Per frame: footsteps while walking, ambient wind + wildlife for the current biome. */
  update(dt: number, walking: boolean, onRoad: boolean): void {
    if (!this.ctx || !this.wind) return;
    this.music.update();
    this.stepTimer -= dt;
    if (walking && this.stepTimer <= 0) { this.stepTimer = STRIDE; this.footstep(onRoad); }
    const windy = this.biome === Biome.Desert || this.biome === Biome.Snow || this.biome === Biome.Mountain;
    const target = this.cave ? 0.012 : (windy ? 0.07 : 0.025) * (1 - this.night * 0.4);
    this.wind.gain.gain.value += (target - this.wind.gain.gain.value) * Math.min(1, dt * 0.5);

    this.chirpTimer -= dt;
    if (this.chirpTimer <= 0) {
      this.chirpTimer = 2 + Math.random() * 7;
      if (this.cave) {
        this.chirpTimer = 1 + Math.random() * 4;
        this.tone(1800 + Math.random() * 1200, 0.08, 'sine', 0.05, 0, 900); // drip
      } else if (this.night > 0.6) {
        if (Math.random() < 0.35) { this.tone(420, 0.25, 'sine', 0.06); this.tone(350, 0.35, 'sine', 0.06, 0.3); } // owl
      } else if (this.biome === Biome.Swamp) {
        this.tone(130, 0.12, 'sawtooth', 0.05); this.tone(120, 0.14, 'sawtooth', 0.05, 0.16); // frog
      } else if (this.biome === Biome.Plains || this.biome === Biome.Forest) {
        const f = 1800 + Math.random() * 900;
        for (let i = 0; i < 3; i++) this.tone(f, 0.07, 'sine', 0.05, i * 0.1, f * 1.25); // bird
        if (this.biome === Biome.Forest) this.chirpTimer *= 0.6;
      } else if (this.biome === Biome.Mountain && Math.random() < 0.3) {
        this.tone(2400, 0.5, 'sine', 0.04, 0, 1800); // eagle cry
      }
    }
  }
}
