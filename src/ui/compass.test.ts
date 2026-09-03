import { describe, expect, it } from 'vitest';
import { bearing } from './compass';

describe('compass bearings', () => {
  it('names the eight points, with north as negative z', () => {
    expect(bearing(1, 0)).toBe('E');
    expect(bearing(0, 1)).toBe('S');
    expect(bearing(-1, 0)).toBe('W');
    expect(bearing(0, -1)).toBe('N');
    expect(bearing(1, 1)).toBe('SE');
    expect(bearing(-1, -1)).toBe('NW');
    expect(bearing(1, -1)).toBe('NE');
    expect(bearing(-1, 1)).toBe('SW');
  });
});
