import { describe, expect, it } from 'vitest';
import { bodyMotion, cycleTurn, type Moving } from './motion';

/**
 * A swimmer should read as moving through water.
 *
 * Deep water stopped being a wall on the 12th: `paddles` lets a hero be where there is water and no
 * bottom, and the stroke is 0.4 of his walking pace so the far shore is a commitment. The pose has
 * to sell that change: he should pitch forward, reach with alternating arms, and flutter his legs,
 * rather than staying upright with an ordinary walk swing.
 *
 * `afloat(world, e)` already drives the blend. These checks hold the pose to what the game means by
 * swimming, not just to numbers that happen to differ from walking.
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

  it('leans forward into the water instead of tipping backward', () => {
    // Positive lean tips the upper body backward; swimming needs a strong forward pitch.
    expect(bodyMotion(moving({ afloat: 1 })).lean).toBeLessThan(bodyMotion(moving()).lean);
  });

  it('alternates broad arm strokes and a faster leg flutter', () => {
    const leftArm = cycleTurn('armL', moving({ afloat: 1, phase: Math.PI / 2 }))[2];
    const rightArm = cycleTurn('armR', moving({ afloat: 1, phase: Math.PI / 2 }))[2];
    expect(leftArm).toBeGreaterThan(rightArm + 2);
    const leftRecovering = cycleTurn('armL', moving({ afloat: 1, phase: Math.PI * 1.5 }))[2];
    const rightPulling = cycleTurn('armR', moving({ afloat: 1, phase: Math.PI * 1.5 }))[2];
    expect(rightPulling).toBeGreaterThan(leftRecovering + 2);

    const leg = cycleTurn('legL', moving({ afloat: 1, phase: Math.PI / 4 }))[2];
    expect(leg).toBeCloseTo(0.18, 5);
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
