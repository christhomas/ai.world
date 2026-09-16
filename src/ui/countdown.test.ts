import { describe, expect, it } from 'vitest';
import { Countdown } from './countdown';

/** Run it for this many seconds a frame at a time, and say what happened. */
function through(clock: Countdown, many: number, step = 1 / 60): Counted {
  let expired = false, redraws = 0;
  for (let t = 0; t < many; t += step) {
    const { state, changed } = clock.tick(step);
    if (state === 'expired') expired = true;
    if (changed) redraws++;
  }
  return { expired, redraws };
}
interface Counted { expired: boolean; redraws: number }

describe('a menu that decides for itself', () => {
  it('takes its own answer when nobody says anything', () => {
    const clock = new Countdown();
    clock.begin(30);
    expect(through(clock, 29).expired, 'it went early').toBe(false);
    expect(through(clock, 2).expired).toBe(true);
  });

  it('ends for good the moment somebody is there, rather than starting again', () => {
    /*
     * The half that matters. A count that could come back would be a menu that still closes under
     * a reader, only later — so pressing anything ends it rather than putting it back to thirty.
     */
    const clock = new Countdown();
    clock.begin(30);
    through(clock, 5);
    clock.answered();
    expect(clock.counting).toBe(false);
    expect(through(clock, 600).expired, 'it decided for somebody who was plainly there').toBe(false);
  });

  it('asks for a redraw once a second and not sixty times for the same number', () => {
    const clock = new Countdown();
    clock.begin(5);
    // five seconds of sixty frames is three hundred ticks; five of them change what is on screen
    expect(through(clock, 4.5).redraws).toBeLessThan(8);
  });

  it('never shows a nought while it is still counting', () => {
    // "in 0s" is a lie for a fraction of a second every second, and it is the last thing anybody
    // reads before the menu acts
    const clock = new Countdown();
    clock.begin(1);
    through(clock, 0.99, 0.01);
    expect(clock.seconds).toBeGreaterThan(0);
  });

  it('does nothing at all when a node does not expire', () => {
    const clock = new Countdown();
    clock.begin(undefined);
    expect(clock.counting).toBe(false);
    expect(through(clock, 600).expired).toBe(false);
    clock.begin(0);
    expect(through(clock, 600).expired, 'nought is not a very short count').toBe(false);
  });
});
