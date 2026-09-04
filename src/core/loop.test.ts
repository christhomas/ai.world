import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameLoop } from './loop';
import { GAMEPLAY } from './config';

/**
 * A stand-in browser: frames are offered at whatever rate the test asks for, and the clock only
 * moves when the test moves it. Nothing here waits for real time.
 */
function screenAt(hz: number) {
  let now = 0;
  let pending: ((t: number) => void) | null = null;
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => { pending = fn; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pending = null; });
  vi.stubGlobal('performance', { now: () => now });
  return {
    /** Offer frames for this many seconds, as a display of this refresh rate would. */
    run(seconds: number) {
      const gap = 1000 / hz;
      for (let i = 0; i < seconds * hz; i++) {
        now += gap;
        const frame = pending;
        pending = null;
        frame?.(now);
      }
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the frame loop', () => {
  it('draws at the ceiling, however fast the display offers frames', () => {
    const screen = screenAt(120);
    let drawn = 0;
    const loop = new GameLoop(() => { drawn++; });
    loop.start();
    screen.run(1);
    loop.stop();

    // a 120Hz display offers 120; we want about the ceiling, and certainly not all of them
    expect(drawn).toBeGreaterThan(GAMEPLAY.MAX_FPS * 0.9);
    expect(drawn).toBeLessThanOrEqual(GAMEPLAY.MAX_FPS + 1);
  });

  it('takes every frame when the display is slower than the ceiling', () => {
    const screen = screenAt(30);
    let drawn = 0;
    const loop = new GameLoop(() => { drawn++; });
    loop.start();
    screen.run(1);
    loop.stop();
    expect(drawn).toBe(30);
  });

  it('hands on the time that really passed, clamped so a long pause cannot leap the world', () => {
    const screen = screenAt(120);
    const steps: number[] = [];
    const loop = new GameLoop((dt) => steps.push(dt));
    loop.start();
    screen.run(0.5);
    loop.stop();

    const total = steps.reduce((sum, dt) => sum + dt, 0);
    expect(total).toBeCloseTo(0.5, 1);           // no time is lost by declining frames
    for (const dt of steps) expect(dt).toBeLessThanOrEqual(0.1);
  });

  it('stops when it is stopped, and does not start twice', () => {
    const screen = screenAt(60);
    let drawn = 0;
    const loop = new GameLoop(() => { drawn++; });
    loop.start();
    loop.start();                                 // a second start must not double the rate
    screen.run(0.5);
    const half = drawn;
    loop.stop();
    screen.run(0.5);
    expect(drawn).toBe(half);
  });
});
