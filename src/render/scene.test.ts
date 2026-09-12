import { describe, expect, it } from 'vitest';
import { SHADOW, shadowsWorthDrawing } from './daycycle';
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

describe('when the shadows are worth drawing again', () => {
  /*
   * The shadow pass is a second traversal of the scene and a second set of draw calls, at 2048 by
   * 2048 on the quality most people play at, and three.js runs it every frame unless it is told
   * otherwise. A CPU profile put the renderer process at 160% of a core on a tab nobody was
   * touching; this is one of the three things that explains it.
   */
  it('draws them when the light has actually gone somewhere', () => {
    expect(shadowsWorthDrawing(SHADOW.STILL, 0)).toBe(true);
    expect(shadowsWorthDrawing(SHADOW.STILL * 4, 0)).toBe(true);
  });

  it('does not draw them again for a sun that has barely crawled', () => {
    // the sun crosses the sky once in two hours of real time, which is a fortieth of a degree a
    // frame: sixty times a second it moves far less than one pixel of the shadow map
    expect(shadowsWorthDrawing(SHADOW.STILL / 10, 0)).toBe(false);
    expect(shadowsWorthDrawing(0, 0)).toBe(false);
  });

  it('draws them anyway on a slow floor, so the world can change without asking', () => {
    // a chunk arriving, a door opening, a tree coming down: none of them move the sun, and none of
    // them should have to know that shadows exist
    expect(shadowsWorthDrawing(0, SHADOW.FLOOR)).toBe(true);
    expect(shadowsWorthDrawing(0, SHADOW.FLOOR - 1)).toBe(false);
  });

  it('saves most of the pass while somebody stands still, and none of it while they walk', () => {
    // standing still at sixty frames a second: ten passes a second instead of sixty
    const frames = 60;
    const still = Array.from({ length: frames }, (_, n) => shadowsWorthDrawing(0, (n % 6) * (1000 / frames)));
    expect(still.filter(Boolean).length).toBeLessThanOrEqual(frames / 5);
    // and walking, where the camera drags the sun along with it, every frame as before
    expect(shadowsWorthDrawing(SHADOW.STILL * 2, 0)).toBe(true);
  });
});
