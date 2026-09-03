/** requestAnimationFrame loop with clamped delta so a background tab never produces a giant step. */
export class GameLoop {
  private last = 0;
  private running = false;
  private handle = 0;

  constructor(private readonly tick: (dt: number, time: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.tick(dt, now / 1000);
      this.handle = requestAnimationFrame(frame);
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }
}
