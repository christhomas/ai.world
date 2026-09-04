import { describe, expect, it } from 'vitest';
import { GRUDGE, Grudges, markupFor, regardOf } from './grudge';

/**
 * A grudge exists to make killing somebody's cow a decision rather than a free meal, so what is
 * tested is that it costs something real, that it is local, and that it does not last for ever.
 */
describe('what a village holds against you', () => {
  it('thinks nothing of somebody who has done nothing', () => {
    const grudges = new Grudges();
    expect(grudges.weight('Ashford', 1)).toBe(0);
    expect(grudges.regard('Ashford', 1)).toBe('fine');
    expect(grudges.markup('Ashford', 1)).toBe(0);
  });

  it('sours on the first beast and turns them away by the third', () => {
    const grudges = new Grudges();
    grudges.slighted('Ashford', 1);
    expect(grudges.regard('Ashford', 1)).toBe('soured');
    grudges.slighted('Ashford', 1);
    grudges.slighted('Ashford', 1);
    expect(grudges.regard('Ashford', 1)).toBe('unwelcome');
  });

  it('takes its opinion out of your purse, and more the worse it gets', () => {
    const grudges = new Grudges();
    grudges.slighted('Ashford', 1);
    const once = grudges.markup('Ashford', 1);
    grudges.slighted('Ashford', 1);
    const twice = grudges.markup('Ashford', 1);

    expect(once).toBeGreaterThan(0);
    expect(twice).toBeGreaterThan(once);
    expect(twice).toBeLessThanOrEqual(GRUDGE.MARKUP);
  });

  it('is the business of the village it happened in, and nowhere else', () => {
    const grudges = new Grudges();
    grudges.slighted('Ashford', 1);
    expect(grudges.weight('Ashford', 1)).toBeGreaterThan(0);
    expect(grudges.weight('Fernmoor', 1), 'the next village along never heard').toBe(0);
  });

  it('lets it go if you stay away long enough, and not before', () => {
    const grudges = new Grudges();
    grudges.slighted('Ashford', 1);
    grudges.slighted('Ashford', 1);
    expect(grudges.regard('Ashford', 5)).not.toBe('fine');

    const settled = 1 + Math.ceil((GRUDGE.A_BEAST * 2) / GRUDGE.FORGIVEN_A_DAY);
    expect(grudges.weight('Ashford', settled)).toBe(0);
    expect(grudges.regard('Ashford', settled)).toBe('fine');
  });

  it('does not hold more against you than there is to hold', () => {
    const grudges = new Grudges();
    for (let n = 0; n < 20; n++) grudges.slighted('Ashford', 1);
    expect(grudges.weight('Ashford', 1)).toBe(GRUDGE.MOST);
    expect(markupFor(GRUDGE.MOST)).toBeCloseTo(GRUDGE.MARKUP, 5);
  });

  it('remembers across a save, fading from the day it was earned', () => {
    const grudges = new Grudges();
    grudges.slighted('Ashford', 10);
    const back = new Grudges(grudges.save());
    expect(back.weight('Ashford', 10)).toBe(grudges.weight('Ashford', 10));
    expect(back.weight('Ashford', 20)).toBeLessThan(back.weight('Ashford', 10));
  });

  it('reads out in words rather than in a number nobody should see', () => {
    expect(regardOf(0)).toBe('fine');
    expect(regardOf(GRUDGE.SOURED)).toBe('soured');
    expect(regardOf(GRUDGE.UNWELCOME)).toBe('unwelcome');
  });
});
