import { describe, expect, it } from 'vitest';
import { CAMERA } from '../core/config';
import { QUALITY, shadowFar } from './scene';

/**
 * The renderer itself needs a browser, but the two things worth pinning here do not: what each
 * quality level actually changes, and that a graphics chip's name reads like a chip.
 */

/**
 * Where the game's own sun stands over the camera's target at a given hour, as height above the
 * target and distance along the ground. Copied out of DayCycle deliberately: if that orbit
 * changes, these numbers are what says whether the shadow fit still covers it.
 */
function sunAt(time: number): { up: number; flat: number } {
  const ang = (time - 0.25) * Math.PI * 2;
  const sunH = Math.sin(ang);
  return { up: 18 + Math.max(0.1, sunH) * 62, flat: Math.hypot(Math.cos(ang) * 60, 26) };
}

/** The half-diagonal of the ground in shot, and the half-width of the shadow box, at a zoom. */
const shot = (zoom: number, aspect = 16 / 9) => ({
  groundRadius: Math.hypot(zoom * aspect / 2, zoom * 0.5 / Math.sin(Math.atan2(CAMERA.HEIGHT, CAMERA.DIST))),
  half: zoom * 1.1,
});

/** How far along the ground every unit of a thing's height carries it up the screen. */
const LIFT = CAMERA.DIST / CAMERA.HEIGHT;

describe('the slab the sun casts shadows through', () => {
  /**
   * The claim the fit rests on, checked by walking the world rather than by repeating the
   * arithmetic: every point that is inside the shadow box and could appear on screen is in front
   * of the far plane. A point is on screen only if its ground position is within the ground in
   * shot plus its own height carried along by the camera's pitch, because a thing that high
   * appears exactly where ground that much further away would.
   */
  it('never cuts off anything that is both in the box and in the picture', () => {
    for (const zoom of [14, 30, 45, 72]) {
      for (const hour of [0.05, 0.25, 0.27, 0.4, 0.5, 0.6, 0.73, 0.76, 0.95]) {
        const { up, flat } = sunAt(hour);
        const { groundRadius, half } = shot(zoom);
        const far = shadowFar(up, flat, groundRadius, half);
        const L = Math.hypot(flat, up);
        let checked = 0;
        // along the sun's line, across it, and up: tiles, because that is what the world is made of
        for (let along = -260; along <= 260; along += 2) {
          for (let across = 0; across <= 260; across += 4) {
            for (let high = 0; high <= 64; high += 2) {
              const inBox = across <= half && Math.abs(along * up - high * flat) <= half * L;
              if (!inBox) continue;
              // the box is symmetric across the sun's line, so one side stands for both
              if (Math.hypot(along, across) > groundRadius + LIFT * high) continue;
              const depth = L - (along * flat + high * up) / L;
              expect(depth, `zoom ${zoom} hour ${hour}: ${along} along, ${across} across, ${high} up`)
                .toBeLessThanOrEqual(far);
              checked++;
            }
          }
        }
        expect(checked, `zoom ${zoom} hour ${hour} tested nothing`).toBeGreaterThan(0);
      }
    }
  });

  it('is deeper when the sun is low, because a low sun rakes it out sideways', () => {
    const { groundRadius, half } = shot(30);
    const noon = sunAt(0.5);
    const dusk = sunAt(0.76);
    expect(shadowFar(dusk.up, dusk.flat, groundRadius, half))
      .toBeGreaterThan(shadowFar(noon.up, noon.flat, groundRadius, half));
  });

  it('is well inside the four hundred it replaces at the zooms the game is played at', () => {
    for (const zoom of [14, 30, 45]) {
      const { groundRadius, half } = shot(zoom);
      for (const hour of [0.27, 0.5, 0.76]) {
        const { up, flat } = sunAt(hour);
        const far = shadowFar(up, flat, groundRadius, half);
        expect(far).toBeLessThan(280);
        // and never in front of the ground it is meant to reach
        expect(far).toBeGreaterThan(Math.hypot(flat, up));
      }
    }
  });

  it('asks for nothing but the ground under it when the sun is straight overhead', () => {
    // no sideways reach at all: the slab need only be as deep as the sun is high, plus the margin
    expect(shadowFar(80, 0, 40, 33)).toBeCloseTo(80, 6);
  });
});

describe('quality levels', () => {
  it('cost less as they go down, and each is described for a person', () => {
    expect(QUALITY.high.pixels).toBeGreaterThan(QUALITY.medium.pixels);
    expect(QUALITY.medium.pixels).toBeGreaterThan(QUALITY.low.pixels);
    expect(QUALITY.high.shadows).toBe(true);
    expect(QUALITY.low.shadows).toBe(false);
    for (const level of Object.values(QUALITY)) expect(level.label).toMatch(/[a-z]/);
  });
});
