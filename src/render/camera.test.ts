import { describe, expect, it } from 'vitest';
import { CAMERA } from '../core/config';

// The rig sizes its frustum from the window, and since the zoom band is worked out from the height
// of it, the window this file pretends to be at matters: a full-size desktop one, where the band is
// the tile numbers in the config and nothing is scaled. Tests that care about a smaller screen say
// so themselves.
const DESKTOP = { innerWidth: 1600, innerHeight: 900 };
const fakeWindow = { ...DESKTOP };
(globalThis as { window?: unknown }).window = fakeWindow;
const { IsoCamera, zoomBand } = await import('./camera');

/** Run something with the window pretending to be a different size, and put it back after. */
const atWindow = <T>(width: number, height: number, body: () => T): T => {
  fakeWindow.innerWidth = width; fakeWindow.innerHeight = height;
  try { return body(); } finally { Object.assign(fakeWindow, DESKTOP); }
};

/** How tall the hero stands on the glass, in CSS pixels, at a zoom in a window this tall. */
const heroPixels = (height: number, zoom: number) =>
  CAMERA.HERO_TALL * (CAMERA.DIST / Math.hypot(CAMERA.DIST, CAMERA.HEIGHT)) * height / zoom;

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

  // the floor was CAMERA.MIN_ZOOM until the band learned to answer to the size of the screen; on a
  // desktop window it is that number still, and on a phone it is the closer one the phone gets
  it('will not let a very small room lock the camera shut', () => {
    const iso = new IsoCamera();
    iso.limitZoom(1);
    iso.zoom = CAMERA.MAX_ZOOM;
    iso.limitZoom(1);
    expect(iso.zoom).toBeCloseTo(zoomBand(DESKTOP.innerHeight).min, 5);
    expect(iso.zoom).toBeCloseTo(CAMERA.MIN_ZOOM, 0);
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

/**
 * The default zoom on a phone was a view from five hundred metres up.
 *
 * Thirty tiles of frustum is a good look at the country on a 1600x900 desktop and the same thirty
 * tiles on a phone held sideways — 750x342 — are spread over a third of the height, which left the
 * hero fifteen pixels tall with the whole game happening around him too small to read. So the band
 * is worked out from how big he comes out rather than from a number of tiles, and these check both
 * halves of that: that a desktop is left exactly as it was, and that a phone is not.
 */
describe('how far back the game opens, on the screen it is opened on', () => {
  const PHONE = 342, DESK = 900;

  it('leaves a full-size desktop the band it has always had', () => {
    const band = zoomBand(DESK);
    expect(band.start).toBe(CAMERA.START_ZOOM);
    expect(band.max).toBe(CAMERA.MAX_ZOOM);
    // the closest is the same 14 to within the rounding of the pixel heights it is written as
    expect(band.min).toBeCloseTo(CAMERA.MIN_ZOOM, 0);
  });

  it('never opens wider than that, however big the screen', () => {
    expect(zoomBand(1440).start).toBe(CAMERA.START_ZOOM);
    expect(zoomBand(2160).start).toBe(CAMERA.START_ZOOM);
  });

  it('opens far closer on a phone', () => {
    expect(zoomBand(PHONE).start).toBeLessThan(zoomBand(DESK).start / 2);
  });

  it('opens on a hero the size he is asked to be, on either screen', () => {
    expect(heroPixels(PHONE, zoomBand(PHONE).start)).toBeCloseTo(CAMERA.HERO_ON_SCREEN, 5);
    // the desktop is capped by START_ZOOM instead, which leaves him a little bigger, not smaller
    expect(heroPixels(DESK, zoomBand(DESK).start)).toBeGreaterThan(CAMERA.HERO_ON_SCREEN);
    expect(heroPixels(DESK, zoomBand(DESK).start)).toBeLessThan(CAMERA.HERO_ON_SCREEN * 1.2);
  });

  it('will not let a phone pull back to a hero four pixels tall', () => {
    const band = zoomBand(PHONE);
    expect(heroPixels(PHONE, band.max)).toBeCloseTo(CAMERA.HERO_SMALLEST, 5);
    expect(band.max).toBeLessThan(CAMERA.MAX_ZOOM / 2);
    // and the closest goes closer than a desktop's, or the phone could not reach its own opening view
    expect(band.min).toBeLessThan(band.start);
  });

  it('has no opinion about a window with no height, which is a page mid-layout', () => {
    expect(zoomBand(0).start).toBe(CAMERA.START_ZOOM);
  });

  // a phone picked up and opened upright is covered by a card asking for it to be turned, and the
  // turn arrives here as a resize; a rig that kept the portrait band would spend the whole game at
  // the zoom for a screen the player was told not to play on
  it('picks again when the phone is turned, having only ever picked for itself', () => {
    atWindow(390, 750, () => {
      const iso = new IsoCamera();
      fakeWindow.innerWidth = 750; fakeWindow.innerHeight = PHONE;
      iso.resize();
      expect(iso.zoom).toBe(zoomBand(PHONE).start);
    });
  });

  it('leaves a zoom somebody has an opinion about alone when the window changes', () => {
    atWindow(390, 750, () => {
      const iso = new IsoCamera();
      iso.zoom = 20;
      fakeWindow.innerWidth = 750; fakeWindow.innerHeight = PHONE;
      iso.resize();
      expect(iso.zoom).toBe(20);
    });
  });
});

/**
 * A save carries a number of tiles, and a number of tiles means different things on different
 * glass. The same save is opened on a window that has been resized, or a phone that has been
 * turned, and one left at thirty on a monitor would hand a phone back the exact view the band
 * above exists to prevent.
 */
describe('the zoom a save was left at', () => {
  it('is given back untouched when the screen can still show it', () => {
    const iso = new IsoCamera();
    iso.restoreZoom(60);
    expect(iso.zoom).toBe(60);
  });

  it('is held to what a phone can show, rather than reopening five hundred metres up', () => {
    atWindow(750, 342, () => {
      const iso = new IsoCamera();
      iso.restoreZoom(CAMERA.START_ZOOM);
      expect(iso.zoom).toBe(zoomBand(342).max);
      expect(iso.zoom).toBeLessThan(CAMERA.START_ZOOM);
    });
  });

  it('keeps a player who played close, close', () => {
    atWindow(750, 342, () => {
      const iso = new IsoCamera();
      iso.restoreZoom(8);
      expect(iso.zoom).toBe(8);
    });
  });

  it('ignores a save with no number in it', () => {
    const iso = new IsoCamera();
    const was = iso.zoom;
    iso.restoreZoom(Number.NaN);
    expect(iso.zoom).toBe(was);
  });
});
