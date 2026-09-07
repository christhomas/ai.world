import { describe, expect, it } from 'vitest';
import { upFrom } from './minimap';

/**
 * Which way is up on the corner map.
 *
 * It used to be north, always, while the camera it sits beside can be swung right round — so a
 * village drawn on your left was as likely to be behind you, and the one question a corner map is
 * asked ("what is around me, and which way is it") got an answer you had to translate first. The
 * map now turns with the picture, and it works out how far to turn from the picture's own corners
 * rather than from a second copy of the camera's angle that could drift out of step with it.
 */

/** A view quad, clockwise from the bottom-left of the screen, looking `along` across flat ground. */
function looking(along: [number, number]): Array<{ x: number; z: number }> {
  const [ux, uz] = along;                 // screen up, in world
  const rx = -uz, rz = ux;                // screen right is up turned a quarter
  const at = (a: number, b: number) => ({ x: rx * a + ux * b, z: rz * a + uz * b });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

const degrees = (r: number) => Math.round((r * 180) / Math.PI);

describe('which way the corner map is turned', () => {
  it('leaves the map alone when the camera already looks north', () => {
    // map space is x to the right and z down, so "up the screen" is -z
    expect(degrees(upFrom(looking([0, -1])))).toBe(0);
  });

  it('turns it a quarter for each quarter the camera swings', () => {
    expect(degrees(upFrom(looking([1, 0])))).toBe(-90);    // looking east: east goes to the top
    expect(Math.abs(degrees(upFrom(looking([0, 1]))))).toBe(180);   // south: half a turn either way
    expect(degrees(upFrom(looking([-1, 0])))).toBe(90);    // west
  });

  it('puts whatever the camera is looking at directly above the hero', () => {
    for (const angle of [0.3, 1.1, 2.4, -0.9, 3.0]) {
      const up: [number, number] = [Math.cos(angle), Math.sin(angle)];
      const spin = upFrom(looking(up));
      // turn the world direction by the same amount the map is turned, and it should point up
      const x = up[0] * Math.cos(spin) - up[1] * Math.sin(spin);
      const z = up[0] * Math.sin(spin) + up[1] * Math.cos(spin);
      expect(x).toBeCloseTo(0, 9);
      expect(z).toBeCloseTo(-1, 9);
    }
  });

  it('does not turn at all without a picture to take it from', () => {
    // the dungeon draws its own map with no view quad, and a test may draw with none either
    expect(upFrom([])).toBe(0);
    expect(upFrom([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }])).toBe(0);
    // and a degenerate quad — a camera looking straight down — leaves it where it was
    expect(upFrom([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }])).toBe(0);
  });
});
