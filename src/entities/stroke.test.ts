import { describe, expect, it } from 'vitest';
import { bodyMotion, cycleTurn, type Moving } from './motion';

/**
 * A swimmer should not be walking on the spot.
 *
 * Deep water stopped being a wall on the 12th: `paddles` lets a hero be where there is water and no
 * bottom, he floats at the surface, and his stroke is 0.4 of his walking pace so the far shore is a
 * commitment. Every part of that is arithmetic, and none of it is anything to *look* at — out there
 * he plays the walk cycle, legs striding against nothing, which reads as a bug rather than as
 * swimming.
 *
 * The state already exists: `afloat(world, e)` is what sets the pace. What was missing is a pose
 * that answers to it.
 */
describe('what a body does out of its depth', () => {
  const moving = (over: Partial<Moving> = {}): Moving => ({
    walk: 1, flap: 0, phase: 1.1, headPitch: 0, hurt: 0, dying: 0, afloat: 0, ...over,
  });

  it('moves its arms differently swimming than walking', () => {
    const walking = cycleTurn('armL', moving());
    const swimming = cycleTurn('armL', moving({ afloat: 1 }));
    expect(swimming).not.toEqual(walking);
  });

  it('barely moves its legs, because a stroke is arms', () => {
    const walking = Math.abs(cycleTurn('legL', moving())[2]);
    const swimming = Math.abs(cycleTurn('legL', moving({ afloat: 1 }))[2]);
    expect(swimming).toBeLessThan(walking);
  });

  it('lies flatter in the water than it stands on land', () => {
    // a body upright in deep water is treading, not swimming, and the lean is the whole difference
    expect(bodyMotion(moving({ afloat: 1 })).lean).toBeGreaterThan(bodyMotion(moving()).lean);
  });

  it('does not bob like a walk, because there is no ground to push off', () => {
    const onLand = Math.abs(bodyMotion(moving()).bob);
    const inWater = Math.abs(bodyMotion(moving({ afloat: 1 })).bob);
    expect(inWater).toBeLessThan(onLand);
  });

  it('crosses over rather than switching, so wading out is one movement', () => {
    // the ground does not drop away in a step and neither should the pose
    const half = cycleTurn('armL', moving({ afloat: 0.5 }))[2];
    const dry = cycleTurn('armL', moving())[2];
    const wet = cycleTurn('armL', moving({ afloat: 1 }))[2];
    expect(Math.min(dry, wet)).toBeLessThanOrEqual(half);
    expect(half).toBeLessThanOrEqual(Math.max(dry, wet));
  });

  it('leaves everything on dry land exactly as it was', () => {
    // the whole world walks through this function; a swimmer is the rare case and must cost the
    // common one nothing
    for (const part of ['legL', 'legR', 'armL', 'armR', 'head', 'tail'] as const) {
      expect(cycleTurn(part, moving({ afloat: 0 }))).toEqual(cycleTurn(part, { ...moving() }));
    }
  });
});
