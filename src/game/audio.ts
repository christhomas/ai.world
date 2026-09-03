import { Biome } from '../world/biomes';
import { Music } from './music';

/**
 * All sound is synthesised with Web Audio: no sample files, in keeping with the no-textures rule.
 * The context is created on the first user gesture (browsers require it).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
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
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
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
      this.music.attach(ctx, this.master);
      this.music.setVolume(this.volume);
      return ctx;
    } catch {
      return null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
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
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  footstep(hard: boolean): void { this.burst(0.07, hard ? 1500 : 700, 1.2, hard ? 0.12 : 0.18); }
  blip(): void { this.tone(880 + Math.random() * 80, 0.035, 'square', 0.04); }
  chime(): void { this.tone(660, 0.12, 'sine', 0.12); this.tone(990, 0.16, 'sine', 0.12, 0.11); }
  jingle(): void { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.14, i * 0.13)); }
  fanfare(): void { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i === 3 ? 0.4 : 0.14, 'triangle', 0.14, i * 0.12)); }
  thud(): void { this.tone(140, 0.22, 'sine', 0.3, 0, 55); this.burst(0.12, 300, 0.8, 0.2); }
  select(): void { this.tone(1200, 0.03, 'square', 0.03); }

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
    if (walking && this.stepTimer <= 0) { this.stepTimer = 0.27; this.footstep(onRoad); }
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
