import { describe, expect, it } from 'vitest';
import { bodyMotion, cycleTurn } from '../src/entities/motion';
import { previewMotion } from './builder-preview';

describe('Character Builder preview movement', () => {
  it('keeps the full body and limb transforms finite while idle, turning, and walking', () => {
    for (const walk of [0, 0.5, 1]) {
      for (const phase of [0, Math.PI / 2, Math.PI]) {
        const mover = { ...previewMotion(), walk, phase };
        expect(Object.values(bodyMotion(mover)).every(Number.isFinite)).toBe(true);
        expect(cycleTurn('legL', mover).every(Number.isFinite)).toBe(true);
      }
    }
  });
});
