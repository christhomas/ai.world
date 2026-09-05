import { describe, expect, it } from 'vitest';
import { CAMERA } from '../core/config';

// the rig sizes its frustum from the window; none of what is tested here is about the frustum
(globalThis as { window?: unknown }).window = { innerWidth: 1280, innerHeight: 800 };
const { IsoCamera } = await import('./camera');

/**
 * Underground you kept the whole sky's worth of zoom, so a cave read as a small room seen from
 * very high up rather than as somewhere you were inside. A place can now say how far back you may
 * stand in it.
 */
describe('how far back a place lets you stand', () => {
  it('opens all the way out under the sky', () => {
    const iso = new IsoCamera();
    iso.limitZoom(CAMERA.MAX_ZOOM);
    iso.zoom = CAMERA.MAX_ZOOM;
    expect(iso.zoom).toBe(CAMERA.MAX_ZOOM);
  });

  it('pulls the view in with the ceiling rather than waiting to be scrolled', () => {
    const iso = new IsoCamera();
    iso.zoom = CAMERA.MAX_ZOOM;
    iso.limitZoom(CAMERA.SHUT_IN_ZOOM);
    expect(iso.zoom, 'left pulled back until the player happens to scroll').toBe(CAMERA.SHUT_IN_ZOOM);
  });

  it('leaves a view already closer than the ceiling alone', () => {
    const iso = new IsoCamera();
    iso.zoom = CAMERA.MIN_ZOOM + 1;
    iso.limitZoom(CAMERA.SHUT_IN_ZOOM);
    expect(iso.zoom).toBe(CAMERA.MIN_ZOOM + 1);
  });

  it('will not let a very small room lock the camera shut', () => {
    const iso = new IsoCamera();
    iso.limitZoom(1);
    iso.zoom = CAMERA.MAX_ZOOM;
    iso.limitZoom(1);
    expect(iso.zoom).toBe(CAMERA.MIN_ZOOM);
  });

  it('is shut in enough underground to be worth doing', () => {
    // a ceiling near the outdoor one would not read as being inside anything
    expect(CAMERA.SHUT_IN_ZOOM).toBeLessThan(CAMERA.START_ZOOM);
    expect(CAMERA.SHUT_IN_ZOOM).toBeGreaterThanOrEqual(CAMERA.MIN_ZOOM);
  });
});

/**
 * A and D moved you the wrong way.
 *
 * Measured in the running game by projecting the hero's own movement to screen space: W went up
 * and S went down, but A moved you screen-right and D moved you screen-left, at every rotation.
 * The rig was handing out its screen-*left* vector under the name of its right one, and because
 * both the hero and the free camera read it from here, everything that strafed strafed backwards.
 *
 * These check `basis()` against the camera's own world matrix rather than against any arithmetic
 * of ours, because the arithmetic is what was wrong in the first place.
 */
describe('which way the keys move you', () => {
  const axes = (rotation: number) => {
    const iso = new IsoCamera();
    iso.rotation = rotation;
    // applyPosition is private and runs on update; nudging the rig through its own update is the
    // honest way to get the camera where the rotation says it should be
    iso.update({ isDown: () => false, dragDX: 0, dragDY: 0, wheelDelta: 0 } as never, 0, false);
    iso.camera.updateMatrixWorld(true);
    const e = iso.camera.matrixWorld.elements;
    return { iso, rightX: e[0], rightZ: e[2] };
  };

  for (const rotation of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    it(`points its right vector to the right of the screen at ${rotation.toFixed(2)} radians`, () => {
      const { iso, rightX, rightZ } = axes(rotation);
      const { rx, rz } = iso.basis();
      // pointing the same way as the camera's own +X, which is what the screen calls right
      expect(rx * rightX + rz * rightZ, 'the right vector points screen-left').toBeGreaterThan(0.9);
    });

    it(`points its forward vector up the screen at ${rotation.toFixed(2)} radians`, () => {
      const { iso, rightX, rightZ } = axes(rotation);
      const { fx, fz } = iso.basis();
      // forward is away from the camera, so it must have no sideways component at all
      expect(Math.abs(fx * rightX + fz * rightZ), 'forward drifts sideways').toBeLessThan(0.001);
    });
  }
});
