import { GAMEPLAY } from './config';

/**
 * Host-scheduled loop with clamped delta so a background tab never produces a giant step,
 * and a ceiling on how often the world is actually drawn: the browser offers frames as fast as
 * the display refreshes, which on a fast screen is more of them than this game is worth.
 */
/**
 * A frame that arrives a hair before it is due is still taken: refresh rates and our ceiling are
 * rarely exact multiples, and waiting for the next one would halve the rate rather than trim it.
 */
const HALF_A_FRAME_EARLY = 2;

/** The host supplies milliseconds from one monotonic clock and asynchronous frame callbacks. */
export interface FrameClock {
  now(): number;
  request(frame: (now: number) => void): number;
  cancel(handle: number): void;
}

// Lazy calls keep construction and a supplied native clock independent of browser globals.
const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (frame) => requestAnimationFrame(frame),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class GameLoop {
  private last = 0;
  private running = false;
  private handle = 0;
  private generation = 0;
  /** Shortest gap between two drawn frames, in milliseconds. */
  private readonly minGap = 1000 / GAMEPLAY.MAX_FPS;

  constructor(
    private readonly tick: (dt: number, time: number) => void,
    private readonly clock: FrameClock = browserClock,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.clock.now();
    const generation = ++this.generation;
    const frame = (now: number) => {
      if (!this.running || generation !== this.generation) return;
      this.handle = this.clock.request(frame);
      // a frame offered sooner than we want one is simply declined; the next will do
      const since = now - this.last;
      if (since < this.minGap - HALF_A_FRAME_EARLY) return;
      this.last = now;
      this.tick(Math.min(since / 1000, 0.1), now / 1000);
    };
    this.handle = this.clock.request(frame);
  }

  stop(): void {
    this.running = false;
    ++this.generation;
    this.clock.cancel(this.handle);
  }
}
