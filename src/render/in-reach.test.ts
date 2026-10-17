import { describe, expect, it } from 'vitest';
import { IsoCamera } from './camera';
import { inReachOnScreen } from './in-reach';

/** Somebody in reach, marked in the world by an installed app (#571). */
describe('somebody in reach, on the screen', () => {
  it('stands where the camera is looking, with the name above the feet', () => {
    const camera = new IsoCamera(() => ({ width: 800, height: 400 }));
    const marked = inReachOnScreen(camera, { name: 'Ada', x: camera.target.x, y: 0, z: camera.target.z }, 800, 400);
    expect(marked?.name).toBe('Ada');
    expect(marked!.feet.x).toBeCloseTo(400, -1);
    expect(marked!.feet.y).toBeCloseTo(200, -1);
    expect(marked!.head.y, 'the name hangs over the head').toBeLessThan(marked!.feet.y);
  });

  it('marks somebody off to one side on that side', () => {
    const camera = new IsoCamera(() => ({ width: 800, height: 400 }));
    const here = inReachOnScreen(camera, { name: 'Ada', x: camera.target.x, y: 0, z: camera.target.z }, 800, 400)!;
    const there = inReachOnScreen(camera, { name: 'Bo', x: camera.target.x + 3, y: 0, z: camera.target.z - 3 }, 800, 400)!;
    expect(Math.hypot(there.feet.x - here.feet.x, there.feet.y - here.feet.y)).toBeGreaterThan(10);
  });
});
