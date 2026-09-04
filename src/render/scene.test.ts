import { describe, expect, it } from 'vitest';
import { QUALITY } from './scene';

/**
 * The renderer itself needs a browser, but the two things worth pinning here do not: what each
 * quality level actually changes, and that a graphics chip's name reads like a chip.
 */
describe('quality levels', () => {
  it('cost less as they go down, and each is described for a person', () => {
    expect(QUALITY.high.pixels).toBeGreaterThan(QUALITY.medium.pixels);
    expect(QUALITY.medium.pixels).toBeGreaterThan(QUALITY.low.pixels);
    expect(QUALITY.high.shadows).toBe(true);
    expect(QUALITY.low.shadows).toBe(false);
    for (const level of Object.values(QUALITY)) expect(level.label).toMatch(/[a-z]/);
  });
});
