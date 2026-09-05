import { describe, expect, it } from 'vitest';
import { BUILD, canBuildAt, deposit, isFinished, owed, progressOf, saidOfJob, stageAt, type Commission } from './building';

const job = (began = 10): Commission => ({
  id: 'house:1', x: 20, z: 20, village: 'Ashford', began, paid: deposit(), price: BUILD.PRICE,
});

/**
 * Everything in this world belonged to somebody else — you could sleep in an inn and drink in a
 * pub and none of it was ever yours. This is the first thing that stays where you put it.
 */
describe('having a house built', () => {
  it('is nothing at all on the day it is commissioned', () => {
    expect(progressOf(job(), 10)).toBe(0);
    expect(stageAt(job(), 10)).toBe('pegs');
  });

  it('goes up in recognisable stages rather than inflating', () => {
    const j = job();
    const seen = [0, 2, 4, 6].map((d) => stageAt(j, 10 + d));
    expect(seen).toEqual(['pegs', 'frame', 'roof', 'house']);
  });

  it('takes days, so it is a thing being built rather than a purchase', () => {
    expect(isFinished(job(), 10 + BUILD.DAYS - 1)).toBe(false);
    expect(isFinished(job(), 10 + BUILD.DAYS)).toBe(true);
  });

  it('asks for the rest of the money only when it is done', () => {
    expect(owed(job(), 12)).toBe(0);
    expect(owed(job(), 10 + BUILD.DAYS)).toBe(BUILD.PRICE - deposit());
  });

  it('wants less up front than the whole price, or it is not a deposit', () => {
    expect(deposit()).toBeGreaterThan(0);
    expect(deposit()).toBeLessThan(BUILD.PRICE);
  });

  it('refuses ground that will not take a house', () => {
    const no = canBuildAt(0, 0, false, { x: 0, z: 0 }, []);
    expect(no.ok).toBe(false);
  });

  it('refuses a plot with no village to send a builder from', () => {
    expect(canBuildAt(0, 0, true, null, []).ok).toBe(false);
  });

  it('refuses somewhere nobody would walk to every morning', () => {
    expect(canBuildAt(BUILD.WITHIN + 50, 0, true, { x: 0, z: 0 }, []).ok).toBe(false);
  });

  it('refuses to put one on top of what is already standing', () => {
    expect(canBuildAt(10, 10, true, { x: 0, z: 0 }, [{ x: 12, z: 10 }]).ok).toBe(false);
  });

  it('takes a clear plot near a village', () => {
    expect(canBuildAt(10, 10, true, { x: 0, z: 0 }, [{ x: 60, z: 60 }]).ok).toBe(true);
  });

  it('counts the days down out loud, and asks for the money at the end', () => {
    expect(saidOfJob(job(), 11)).toContain('days');
    expect(saidOfJob(job(), 10 + BUILD.DAYS - 1)).toContain('One more day');
    expect(saidOfJob(job(), 10 + BUILD.DAYS)).toContain('finished');
  });
});
