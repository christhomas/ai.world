import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { assertPixelsRemain } = require('./compare.cjs') as {
  assertPixelsRemain: (width: number, height: number, rect: number[] | null) => void;
};

describe('screenshot exclusion rectangles', () => {
  it('rejects an exclusion that leaves no pixels to compare', () => {
    expect(() => assertPixelsRemain(1440, 900, [0, 0, 1440, 900])).toThrow(/no pixels/i);
  });

  it('allows exclusions that leave at least one pixel', () => {
    expect(() => assertPixelsRemain(1440, 900, [0, 0, 1439, 900])).not.toThrow();
  });
});
