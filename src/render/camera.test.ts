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
