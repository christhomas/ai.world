import { afterEach, describe, expect, it, vi } from 'vitest';
import { daysAsked, TUNED_FOR } from './benchdays';

/**
 * How long a bench run is, and why it is a question rather than a constant.
 *
 * `DAYS` was 100 and both benches read it. A hundred days is barely more than one lifetime —
 * people live 60 to 90 — so every question of the form *does this village recover, or does it
 * flatten out* was unanswerable: the run stopped before the answer arrived. #248 is waiting on
 * exactly that, and no constant in the economy should move until it can be tried rather than
 * argued about.
 *
 * The default is still a hundred, so every existing invocation means what it meant. What is new is
 * that somebody can ask for a thousand.
 *
 * `TUNED_FOR` is the other half and matters more than it looks. A bench full of bounds tuned at one
 * length will go red the moment it is asked a longer question, and *a bench that goes red because
 * somebody asked it a longer question is a bench somebody turns off*. So a bound that is only true
 * at the tuned length says so and reports rather than fails.
 */

afterEach(() => { delete process.env.BENCH_DAYS; });

describe('how long a bench is asked to run', () => {
  it('is a hundred days when nobody says otherwise, which is what every caller meant before', () => {
    expect(daysAsked()).toBe(100);
    expect(TUNED_FOR).toBe(100);
  });

  it('takes the number it is given', () => {
    process.env.BENCH_DAYS = '400';
    expect(daysAsked()).toBe(400);
  });

  it('refuses a length that is not a length, rather than running for NaN days', () => {
    for (const nonsense of ['', 'soon', '-5', '0', '12.5']) {
      process.env.BENCH_DAYS = nonsense;
      expect(() => daysAsked(), nonsense).toThrow(/BENCH_DAYS/);
    }
  });

  it('says when it is not at the length its bounds were tuned for', () => {
    expect(daysAsked() === TUNED_FOR).toBe(true);
    process.env.BENCH_DAYS = '365';
    expect(daysAsked() === TUNED_FOR).toBe(false);
  });

  it('is not silently capped, because the cost of a longer run is the point of asking', () => {
    process.env.BENCH_DAYS = '5000';
    expect(daysAsked()).toBe(5000);
  });
});
