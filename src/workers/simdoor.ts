import { WORLD_PAUSE, WORLD_RESUME } from '../net/link-contract';

/** The part of the simulation the page's words reach. */
export interface Steerable {
  start(): void;
  stop(): void;
  tick(now?: number): void;
}

/**
 * What this thread does with each thing the page posts it, apart from the thread itself so a test
 * can post to it.
 *
 * In a capture the harness owns the world's clock (#522). A tab shown again used to `start()` the
 * wall-clock ticker under it, so the next `shots-step` ticked against a `lastTick` read off
 * `Date.now()` and handed the world minus fifty years, then plus fifty years, and two runs no
 * longer photographed one world. So pause and resume are not the capture's to obey.
 */
export function worldDoor(
  sim: Steerable,
  receive: (text: string) => void,
  capturing: boolean,
  post: (message: string) => void,
): (data: unknown) => void {
  let captureNow = 0;
  return (data) => {
    // the world reads text; nothing on the page posts it bytes, and bytes are not a word to parse
    if (typeof data !== 'string') return;
    if (capturing) {
      if (data === WORLD_PAUSE || data === WORLD_RESUME) return;
      if (data.startsWith('shots-step:')) {
        const count = Number(data.slice('shots-step:'.length));
        if (!Number.isInteger(count) || count < 0 || count > 100) return;
        for (let i = 0; i < count; i++) sim.tick(captureNow += 100);
        post('shots-step-done');
        return;
      }
    }
    if (data === WORLD_PAUSE) { sim.stop(); return; }
    if (data === WORLD_RESUME) { sim.start(); return; }
    receive(data);
  };
}
