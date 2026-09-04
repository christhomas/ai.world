import { describe, expect, it } from 'vitest';
import { nubOffset, stickKeys } from './touch';

describe('the thumb stick', () => {
  it('holds nothing while the thumb rests where it landed', () => {
    expect(stickKeys(0, 0)).toEqual([]);
    expect(stickKeys(9, -9)).toEqual([]);
  });

  it('holds the direction keys for the eight points, with screen up as forward', () => {
    expect(stickKeys(0, -60)).toEqual(['w']);
    expect(stickKeys(0, 60)).toEqual(['s']);
    expect(stickKeys(-60, 0)).toEqual(['a']);
    expect(stickKeys(60, 0)).toEqual(['d']);
    expect(stickKeys(-60, -60)).toEqual(['w', 'a']);
    expect(stickKeys(60, -60)).toEqual(['w', 'd']);
    expect(stickKeys(-60, 60)).toEqual(['s', 'a']);
    expect(stickKeys(60, 60)).toEqual(['s', 'd']);
  });

  it('keeps the nub inside the ring however far the thumb slides', () => {
    expect(nubOffset(10, 0)).toEqual({ x: 10, y: 0 });
    const far = nubOffset(400, 0);
    expect(far.x).toBeCloseTo(54);
    expect(Math.hypot(...Object.values(nubOffset(300, -300)))).toBeCloseTo(54);
  });
});
