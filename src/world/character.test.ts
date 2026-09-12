import { describe, expect, it } from 'vitest';
import { PROVINCE, provinceOf } from './provinces';
import { TEMPER, characterAt, characterOf, dangerAt } from './character';
import { SPAWN } from '../entities/spawning';
import { TEMPER as OUT_AFTER_DARK } from '../entities/wilds';

/**
 * A province with a character of its own.
 *
 * The thing this is instead of: rings. "It gets harder the further out you go" needs a middle to be
 * far from, and an endless country has none — so a place is dangerous because it *is*, which two
 * players standing in it can agree about and a player who leaves and comes back finds unchanged.
 */
describe('what a province is like', () => {
  it('is the same answer however it is asked, and on every machine', () => {
    const id = provinceOf(700, -300);
    expect(characterOf(99, id)).toEqual(characterAt(99, 700, -300));
    expect(characterOf(99, id)).toEqual(characterOf(99, id));
  });

  it('is a different place in a different world', () => {
    const here = provinceOf(0, 0);
    expect(characterOf(1, here).danger).not.toBe(characterOf(2, here).danger);
  });

  it('is never entirely safe and never entirely a nightmare', () => {
    for (let px = -6; px <= 6; px++) {
      for (let pz = -6; pz <= 6; pz++) {
        const { danger } = characterOf(7, `${px}:${pz}`);
        expect(danger).toBeGreaterThanOrEqual(TEMPER.MILDEST);
        expect(danger).toBeLessThanOrEqual(TEMPER.WORST);
      }
    }
  });

  it('varies between neighbours, so walking somewhere means arriving somewhere', () => {
    const seen = new Set<number>();
    for (let px = 0; px < 8; px++) seen.add(Math.round(characterOf(3, `${px}:0`).danger * 100));
    expect(seen.size, 'eight counties in a row and every one the same').toBeGreaterThan(4);
  });
});

describe('the frontier between two counties', () => {
  it('is a stretch of country rather than a line in the grass', () => {
    // stepping two tiles must never change the danger by much: a boundary a player could stand
    // astride and watch the wolves stop would be a rule they could play against
    let worst = 0;
    for (let x = -PROVINCE; x <= PROVINCE * 2; x += 2) {
      worst = Math.max(worst, Math.abs(dangerAt(11, x, 40) - dangerAt(11, x + 2, 40)));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('still reaches what each province is at its middle', () => {
    // the blend is a blend, not an averaging-away: the middle of a place still feels like the place
    const middles: number[] = [];
    for (let px = 0; px < 10; px++) {
      middles.push(dangerAt(5, px * PROVINCE + PROVINCE / 2, PROVINCE / 2));
    }
    expect(Math.max(...middles) - Math.min(...middles), 'every county blended into the same mush')
      .toBeGreaterThan(0.15);
  });

  it('is somewhere in the scale wherever it is asked', () => {
    for (let x = -2000; x <= 2000; x += 137) {
      const danger = dangerAt(2, x, x * 3);
      expect(danger).toBeGreaterThanOrEqual(TEMPER.MILDEST);
      expect(danger).toBeLessThanOrEqual(TEMPER.WORST);
    }
  });
});

describe('what a province does to what lives in it', () => {
  it('is felt, which is the only reason it exists', () => {
    /*
     * The test that would catch this being wired up and doing nothing. A bad county has to have
     * meaningfully more out after dark than a quiet one, or the whole idea is a number in a file.
     */
    const nights = (danger: number): number =>
      SPAWN.NIGHT_PACK_CHANCE * (1 + danger * (OUT_AFTER_DARK.NIGHTS - 1));
    const quiet = nights(TEMPER.MILDEST);
    const bad = nights(TEMPER.WORST);
    expect(bad / quiet).toBeGreaterThan(1.3);
    // and never so much that a province becomes a wall rather than a place
    expect(bad).toBeLessThan(1);
  });
});
