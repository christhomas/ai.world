import { describe, expect, it } from 'vitest';
import { Simplex2D } from './noise';

describe('Simplex2D', () => {
  it('stays in range and is coherent', () => {
    const n = new Simplex2D(7);
    let min = 1, max = -1, maxStep = 0;
    let prev = n.noise(0, 0);
    for (let i = 0; i < 5000; i++) {
      const v = n.noise(i * 0.01, i * 0.013);
      min = Math.min(min, v); max = Math.max(max, v);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(min).toBeGreaterThanOrEqual(-1.01);
    expect(max).toBeLessThanOrEqual(1.01);
    expect(max - min).toBeGreaterThan(1);       // actually uses the range
    expect(maxStep).toBeLessThan(0.15);         // neighbours are similar (the old sin-hash fails this)
  });

  it('is seed-deterministic', () => {
    expect(new Simplex2D(3).fbm(1.5, 2.5)).toBe(new Simplex2D(3).fbm(1.5, 2.5));
    expect(new Simplex2D(3).fbm(1.5, 2.5)).not.toBe(new Simplex2D(4).fbm(1.5, 2.5));
  });
});
