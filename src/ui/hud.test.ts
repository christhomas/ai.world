import { describe, expect, it } from 'vitest';
import { meter } from './hud';

/**
 * The bar every readout in the corner is drawn with.
 *
 * Health, breath and the sword arm are one scale now — a hundred is the whole of anything — and one
 * renderer, which is the point of this test: a bar is the half of a readout that can be wrong
 * without anybody noticing, because a bar a block short at the top still reads as full. The number
 * beside it carries the precision and is not this function's business.
 *
 * It was three dots wide for breath and twenty blocks for health until the day somebody noticed the
 * two disagreed about what a full meter looks like.
 */
describe('the meter in the corner', () => {
  const width = meter(1).length;

  it('is the same width however full it is', () => {
    for (const share of [0, 0.01, 0.33, 0.5, 0.99, 1]) expect(meter(share).length).toBe(width);
  });

  it('is all lit when it is full and all dark when it is empty', () => {
    expect(meter(1)).toBe('█'.repeat(width));
    expect(meter(0)).toBe('░'.repeat(width));
  });

  it('lights half of it for half', () => {
    expect([...meter(0.5)].filter((c) => c === '█').length).toBe(width / 2);
  });

  it('never runs off the end, whatever it is handed', () => {
    // a hero healed past his maximum, a share worked out from a nought, a NaN out of a division
    expect(meter(1.4)).toBe('█'.repeat(width));
    expect(meter(-2)).toBe('░'.repeat(width));
    expect(meter(Number.NaN).length).toBe(width);
  });
});
