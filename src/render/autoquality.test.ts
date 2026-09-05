import { describe, expect, it, vi } from 'vitest';
import { AUTO, AutoQuality, below, everChoseQuality, medianOf, rememberAutoChoice, rememberTheirChoice, type Level } from './autoquality';

/**
 * The rig defaults to `high` — pixel ratio two and a 2048-square shadow map every frame — chosen
 * sight unseen on a machine nobody has measured. A player whose computer cannot hold that gets a
 * slideshow and no clue why.
 */

/** Run a stretch of frames at a steady rate through the watcher, reporting every step it asked for. */
function play(watch: AutoQuality, frameMs: number, frames: number, from: Level = 'high'): Level[] {
  const steps: Level[] = [];
  let level = from;
  for (let n = 0; n < frames; n++) {
    const next = watch.saw(frameMs, level);
    if (next) { steps.push(next); level = next; }
  }
  return steps;
}

const enough = AUTO.SETTLE + AUTO.SAMPLE * (AUTO.STEPS + 2);

describe('turning the picture down until the game moves', () => {
  it('leaves a machine that is keeping up completely alone', () => {
    expect(play(new AutoQuality(false), 16, enough)).toEqual([]);
  });

  it('steps down on a machine that plainly is not', () => {
    // thirty milliseconds a frame is about thirty-three a second
    expect(play(new AutoQuality(false), 30, enough)[0]).toBe('medium');
  });

  it('does nothing at all for somebody who chose a level themselves', () => {
    // they picked `high` on a slow machine, which is them deciding they would rather have the
    // picture. It is not the game's place to argue.
    expect(play(new AutoQuality(true), 40, enough)).toEqual([]);
  });

  it('and stops the moment they open the menu and pick one', () => {
    const watch = new AutoQuality(false);
    watch.leaveItAlone();
    expect(play(watch, 40, enough)).toEqual([]);
  });

  it('ignores the first stretch, because a world is still building itself', () => {
    // every frame here is dreadful, but they are all inside the settling period
    expect(play(new AutoQuality(false), 90, AUTO.SETTLE)).toEqual([]);
  });

  it('only ever goes down, one rung at a time, and not for ever', () => {
    const steps = play(new AutoQuality(false), 90, enough);
    expect(steps).toEqual(['medium', 'low']);
    expect(steps.length).toBeLessThanOrEqual(AUTO.STEPS);
  });

  it('gives up rather than looping once there is nothing plainer to pick', () => {
    expect(below('low')).toBeNull();
    expect(play(new AutoQuality(false), 90, enough, 'low')).toEqual([]);
  });

  it('does not punish a machine that is only a little over, or nobody keeps their shadows', () => {
    // a steady 55fps is not worth a visible change in how the game looks
    expect(play(new AutoQuality(false), 18, enough)).toEqual([]);
  });

  it('judges on the middle frame, so one long one does not condemn the rest', () => {
    expect(medianOf([5, 5, 5, 5, 400])).toBe(5);
    expect(medianOf([])).toBe(0);
  });

  it('is not fooled by a machine that is fine on average and stutters constantly', () => {
    // half the frames dreadful is a game that feels dreadful, whatever the mean says
    const watch = new AutoQuality(false);
    const steps: Level[] = [];
    let level: Level = 'high';
    for (let n = 0; n < enough; n++) {
      const next = watch.saw(n % 2 === 0 ? 4 : 40, level);
      if (next) { steps.push(next); level = next; }
    }
    expect(steps.length).toBeGreaterThan(0);
  });
});

describe('remembering who chose', () => {
  it('treats a level the game picked as not a choice, so it can still adjust', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    store.set('ai.world/quality', 'medium');
    rememberAutoChoice();
    expect(everChoseQuality(), 'the game mistook its own decision for the player\'s').toBe(false);
    rememberTheirChoice();
    expect(everChoseQuality()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('says nobody chose when there is nothing written down at all', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => {}, removeItem: () => {},
    });
    expect(everChoseQuality()).toBe(false);
    vi.unstubAllGlobals();
  });
});
