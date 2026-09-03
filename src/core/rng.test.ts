import { describe, expect, it } from 'vitest';
import { hash3, hashString, mulberry32, rand2 } from './rng';

describe('rng', () => {
  it('mulberry32 is deterministic and uniform-ish', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    for (const v of xs) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('hash3 differs across coordinates and salts', () => {
    expect(hash3(1, 0, 0)).not.toBe(hash3(1, 1, 0));
    expect(hash3(1, 0, 0)).not.toBe(hash3(1, 0, 1));
    expect(hash3(1, 0, 0)).not.toBe(hash3(1, 0, 0, 1));
    expect(hash3(1, 5, 7)).toBe(hash3(1, 5, 7));
    expect(rand2(9, -3, 4)).toBeLessThan(1);
  });

  it('hashString is stable', () => {
    expect(hashString('ai.world')).toBe(hashString('ai.world'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
