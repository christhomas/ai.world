import { describe, expect, it } from 'vitest';
import { DIRECTOR, Director } from './director';

/**
 * An hour of play met villagers, one errand, deer, wolves, bats and a shop — and none of the
 * nemesis, the warbands, the villages asking for help or the jailbreaks, all of which are built
 * and were simply too far away. This is the distance problem, not a content problem.
 */
describe('the world reaching for a player who has found nothing', () => {
  it('reaches no further than usual while things are happening', () => {
    const d = new Director();
    expect(d.reach).toBe(1);
    d.advance(DIRECTOR.PATIENCE * 0.9);
    expect(d.reach).toBe(1);
  });

  it('leaves a few quiet minutes alone, because quiet is allowed', () => {
    const d = new Director();
    d.advance(DIRECTOR.PATIENCE);
    expect(d.reach).toBe(1);
  });

  it('reaches further the longer nothing happens', () => {
    const d = new Director();
    d.advance(DIRECTOR.PATIENCE + 1);
    const early = d.reach;
    d.advance((DIRECTOR.GIVING_UP - DIRECTOR.PATIENCE) / 2);
    expect(d.reach).toBeGreaterThan(early);
  });

  it('stops reaching at a limit rather than growing for ever', () => {
    const d = new Director();
    d.advance(DIRECTOR.GIVING_UP * 100);
    expect(d.reach).toBeCloseTo(DIRECTOR.MOST, 5);
  });

  it('goes back to normal the moment something happens', () => {
    const d = new Director();
    d.advance(DIRECTOR.GIVING_UP);
    expect(d.reach).toBeGreaterThan(1);
    d.saw('band');
    expect(d.reach).toBe(1);
    expect(d.last).toBe('band');
  });

  it('eases rather than stepping, so nothing pops in when a timer expires', () => {
    const d = new Director();
    d.advance(DIRECTOR.PATIENCE + 0.001);
    expect(d.reach).toBeLessThan(1.02);
  });
});
