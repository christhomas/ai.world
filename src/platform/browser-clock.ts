import type { FrameClock } from '../core/loop';

/** The page's frames: animation frames on the performance clock, looked up when called. */
export const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (frame) => requestAnimationFrame(frame),
  cancel: (handle) => cancelAnimationFrame(handle),
};
