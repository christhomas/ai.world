import { describe, expect, it } from 'vitest';
import { headingOnMap } from './mapbase';
import { yawFor } from '../entities/entity';

/**
 * One minus sign, and the sort of thing that is wrong for a fortnight before anybody notices the
 * arrow is pointing the wrong way. A rig's forward is (cos yaw, -sin yaw); a map canvas has z
 * running down its y axis. These check the two agree by walking in each direction and asking
 * where the cone would point.
 */
describe('which way the map arrow points', () => {
  /** Where a cone of this heading reaches, one unit out, in canvas coordinates. */
  const tip = (yaw: number): { x: number; y: number } => {
    const a = headingOnMap(yaw);
    return { x: Math.cos(a), y: Math.sin(a) };
  };

  it('points right on the canvas for somebody walking east', () => {
    const t = tip(yawFor(1, 0));
    expect(t.x).toBeCloseTo(1, 6);
    expect(t.y).toBeCloseTo(0, 6);
  });

  it('points down the canvas for somebody walking south, which is +z', () => {
    const t = tip(yawFor(0, 1));
    expect(t.y).toBeCloseTo(1, 6);
    expect(t.x).toBeCloseTo(0, 6);
  });

  it('points up the canvas for somebody walking north', () => {
    const t = tip(yawFor(0, -1));
    expect(t.y).toBeCloseTo(-1, 6);
  });

  it('points left for somebody walking west', () => {
    const t = tip(yawFor(-1, 0));
    expect(t.x).toBeCloseTo(-1, 6);
  });

  it('turns the same way the hero turns', () => {
    // a quarter turn from east should land on south, not north
    const east = tip(yawFor(1, 0)), south = tip(yawFor(0, 1));
    const cross = east.x * south.y - east.y * south.x;
    expect(cross, 'the cone turns the wrong way round').toBeGreaterThan(0);
  });
});
