import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../../server/sim';
import { Forgetful } from '../../server/vault';
import { WORLD_PAUSE, WORLD_RESUME } from '../net/link';
import { worldDoor } from './simdoor';

/**
 * The page's words to the world thread, in a capture and out of one (#522).
 *
 * A capture's world moves only when the harness says `shots-step`, a hundred milliseconds of its own
 * clock at a time. A tab shown again used to arm the wall-clock ticker underneath that anyway.
 */
describe("the world thread's door", () => {
  afterEach(() => { vi.useRealTimers(); });

  /** A world that writes down what it was asked to do. */
  const told = () => {
    const ticks: number[] = [];
    let started = 0, stopped = 0;
    return {
      ticks,
      get started() { return started; },
      get stopped() { return stopped; },
      start: () => { started++; },
      stop: () => { stopped++; },
      tick: (now?: number) => { ticks.push(now ?? Number.NaN); },
    };
  };

  it('in a capture, a resume arms no ticker and three steps are exactly 300 ms', () => {
    const sim = told(), said: string[] = [], posted: string[] = [];
    const door = worldDoor(sim, (text) => said.push(text), true, (message) => posted.push(message));
    door(WORLD_RESUME);
    door('shots-step:3');
    door(WORLD_PAUSE);
    expect(sim.started).toBe(0);
    expect(sim.stopped).toBe(0);
    expect(sim.ticks).toEqual([100, 200, 300]);
    expect(posted).toEqual(['shots-step-done']);
    expect(said).toEqual([]);
  });

  it('does the same with the real world, which leaves no interval behind', () => {
    vi.useFakeTimers();
    const sim = new Simulation({ vault: new Forgetful(), dataDir: 'worlds' });
    sim.captureAt(0);
    const ticked: number[] = [];
    const tick = sim.tick.bind(sim);
    sim.tick = (now?: number) => { ticked.push(now ?? Number.NaN); tick(now); };
    const door = worldDoor(sim, () => {}, true, () => {});
    // measured against what a fresh world already holds, which is not the ticker's business
    const before = vi.getTimerCount();
    door(WORLD_RESUME);
    door('shots-step:3');
    expect(vi.getTimerCount()).toBe(before);
    expect(ticked).toEqual([100, 200, 300]);
  });

  it('in a capture, bytes are dropped rather than parsed', () => {
    const sim = told(), said: string[] = [];
    const door = worldDoor(sim, (text) => said.push(text), true, () => {});
    expect(() => door(new ArrayBuffer(4))).not.toThrow();
    expect(said).toEqual([]);
    expect(sim.ticks).toEqual([]);
  });

  it('out of a capture, pause and resume still stop and start the world, and words go through', () => {
    const sim = told(), said: string[] = [];
    const door = worldDoor(sim, (text) => said.push(text), false, () => {});
    door(WORLD_PAUSE);
    door(WORLD_RESUME);
    door('shots-step:3');
    door('{"type":"hello"}');
    expect(sim.stopped).toBe(1);
    expect(sim.started).toBe(1);
    expect(sim.ticks).toEqual([]);
    expect(said).toEqual(['shots-step:3', '{"type":"hello"}']);
  });
});
