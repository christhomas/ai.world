import * as THREE from 'three';
import { CAMERA } from '../core/config';
import type { Input } from '../core/input';

/**
 * How much of a standing thing's height the picture actually gets, as a share of it.
 *
 * The rig looks down from CAMERA.HEIGHT over CAMERA.DIST, and a screen is at right angles to where
 * it is looking, so a world-vertical of h takes up h·cos(pitch) of the picture rather than h. At
 * the forty-five degrees this game looks down from that is about seven tenths. Derived rather than
 * written down, so that re-pitching the rig moves this with it instead of leaving it wrong.
 */
const UPRIGHT = CAMERA.DIST / Math.hypot(CAMERA.DIST, CAMERA.HEIGHT);

/**
 * The zoom band for a window this many CSS pixels tall: where the game opens, and how far in and
 * out the player may go from there.
 *
 * The frustum is `zoom` world units tall and the window is `height` pixels tall, so a hero
 * `CAMERA.HERO_TALL` units high stands `HERO_TALL·UPRIGHT·height/zoom` pixels on the glass — turn
 * that around and a wanted height in pixels is a zoom. Each of the three is that sum against the
 * tile number it has always had, and the closer of the two wins: on a desktop the tiles win and
 * nothing whatever changes, and on a phone, where thirty tiles would leave the hero fifteen pixels
 * tall, the pixels win.
 *
 * Pure, and given the height rather than reading the window itself, so the arithmetic can be
 * checked at a size instead of at a device.
 */
export function zoomBand(height: number): { start: number; min: number; max: number } {
  // a window with no height at all is a headless one mid-layout; the desktop band is the safe answer
  if (!(height > 0)) return { start: CAMERA.START_ZOOM, min: CAMERA.MIN_ZOOM, max: CAMERA.MAX_ZOOM };
  const zoomFor = (pixels: number) => CAMERA.HERO_TALL * UPRIGHT * height / pixels;
  return {
    start: Math.min(CAMERA.START_ZOOM, zoomFor(CAMERA.HERO_ON_SCREEN)),
    min: Math.min(CAMERA.MIN_ZOOM, zoomFor(CAMERA.HERO_LARGEST)),
    max: Math.min(CAMERA.MAX_ZOOM, zoomFor(CAMERA.HERO_SMALLEST)),
  };
}

/**
 * How much zoom a notch of wheel is worth, as a share of where the game opened.
 *
 * A share rather than a fixed 0.03 tiles, because a phone's band is about a third as wide as a
 * desktop's, and a thumb-span of pinch worth a fifth of the band on a monitor would be worth over
 * half of it on a handset. On a full-size screen this is 0.03 tiles a notch, as it always was.
 */
const WHEEL_SHARE = 0.03 / CAMERA.START_ZOOM;

/** Orthographic isometric rig: orbits a ground target, pans in screen space, zooms by frustum size. */
/** Scratch for `groundCorners`, which runs every frame and should not litter. */
const CORNER = new THREE.Vector3();
const FORWARD = new THREE.Vector3();

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  rotation = Math.PI / 4;
  /**
   * How far above the target the camera actually looks, in world units.
   *
   * Used to look up a mountain without moving what the camera is following. Held here rather than
   * added to `target` by whoever wants it, because the hero pulls the target back to his own feet
   * every frame and anything added to it accumulates instead: the first version of this drifted
   * fifty units into the air within a few seconds, which is where "the camera is a mile up" came
   * from.
   */
  lift = 0;
  zoom: number = zoomBand(window.innerHeight).start;
  /** How far back this place lets you stand: less sky indoors and underground than in a field. */
  private ceiling: number = CAMERA.MAX_ZOOM;
  /**
   * The zoom this rig picked for itself and still owns.
   *
   * While the zoom is still exactly that, nobody has had an opinion about it — not the player at
   * the wheel, not a save, not a room that sized the view to fit itself — so a window that changes
   * size gets a freshly picked one. A phone opened upright is why: the game covers itself and asks
   * to be turned, the turn arrives as a resize, and without this the player would spend the game at
   * the zoom that suited the portrait screen they were told not to play on. The moment anyone does
   * have an opinion the two part company and the number is theirs to keep.
   */
  private ownZoom: number = this.zoom;

  /**
   * The band for the window as it is now, read fresh rather than kept.
   *
   * A window changes size — a phone turns, an address bar slides away, a desktop window is dragged
   * — and a band worked out once at startup would be about a screen that no longer exists. Nothing
   * is clamped by merely asking, though, so a window that grows and shrinks by sixty pixels as the
   * browser chrome comes and goes cannot ratchet a player's own zoom down with it.
   */
  private get band(): { start: number; min: number; max: number } {
    return zoomBand(window.innerHeight);
  }

  constructor() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.applyFrustum(aspect);
    this.applyPosition();
  }

  /**
   * Unit vectors on the ground plane for "screen up" and "screen right".
   *
   * The right one used to be the left one. It was handed out under this name to the hero, the free
   * camera and the touch stick alike, so everything that strafed strafed backwards: A moved you
   * right and D moved you left, at every rotation, for as long as the game has existed. Forward
   * was always correct, which is why it read as an occasional glitch rather than as a constant —
   * you notice a wrong turn far less than you notice walking backwards.
   *
   * Screen right for a camera standing at `target + (cos r, ·, sin r)` and looking back at the
   * target is `(sin r, -cos r)`: the camera's own +X axis, which is what the screen calls right.
   * `camera.test.ts` checks this against the rig's world matrix rather than against any arithmetic
   * of ours, because the arithmetic is what was wrong.
   */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    return {
      fx: -Math.cos(this.rotation), fz: -Math.sin(this.rotation),
      rx: Math.sin(this.rotation), rz: -Math.cos(this.rotation),
    };
  }

  /** `pan` false = keys and drag do not move the target (something else, e.g. the player, owns it). */
  update(input: Input, dt: number, pan = true): void {
    const { fx, fz, rx, rz } = this.basis();
    const step = CAMERA.SPEED * dt * (this.zoom / CAMERA.START_ZOOM);
    if (pan) {
      if (input.isDown('w', 'arrowup')) { this.target.x += fx * step; this.target.z += fz * step; }
      if (input.isDown('s', 'arrowdown')) { this.target.x -= fx * step; this.target.z -= fz * step; }
      if (input.isDown('a', 'arrowleft')) { this.target.x -= rx * step; this.target.z -= rz * step; }
      if (input.isDown('d', 'arrowright')) { this.target.x += rx * step; this.target.z += rz * step; }
    }
    if (input.isDown('q')) this.rotation -= CAMERA.ROT_SPEED * dt;
    if (input.isDown('e')) this.rotation += CAMERA.ROT_SPEED * dt;

    if (pan && (input.dragDX !== 0 || input.dragDY !== 0)) {
      const k = CAMERA.DRAG_SPEED * (this.zoom / CAMERA.START_ZOOM);
      // dragging takes hold of the world and pulls it, so the view goes the other way to the hand.
      // The sideways term is subtracted because the right vector was corrected above and this drag
      // was quietly relying on it pointing left; without the sign, grabbing the map would invert.
      this.target.x += -rx * input.dragDX * k + fx * input.dragDY * k;
      this.target.z += -rz * input.dragDX * k + fz * input.dragDY * k;
    }
    if (input.wheelDelta !== 0) {
      const band = this.band;
      const wanted = this.zoom + input.wheelDelta * WHEEL_SHARE * band.start;
      this.zoom = Math.max(band.min, Math.min(Math.min(this.ceiling, band.max), wanted));
      this.applyFrustum(window.innerWidth / window.innerHeight);
    }
    this.applyPosition();
  }

  resize(): void {
    const band = this.band;
    if (this.zoom === this.ownZoom && band.start !== this.ownZoom) {
      this.zoom = this.ownZoom = Math.min(this.ceiling, band.start);
    }
    this.applyFrustum(window.innerWidth / window.innerHeight);
  }

  /**
   * Shut the view in, or open it back up to the sky.
   *
   * Pulls the current zoom in with the ceiling rather than only capping the wheel, so stepping
   * from a field into a cave closes the picture rather than leaving you pulled back until you
   * happen to scroll. Never below MIN_ZOOM, so a very small room cannot lock the camera.
   */
  limitZoom(most: number): void {
    this.ceiling = Math.max(this.band.min, most);
    if (this.zoom > this.ceiling) {
      this.zoom = this.ceiling;
      this.resize();
    }
  }

  /**
   * Take back the zoom a save was left at, as far as this screen allows.
   *
   * A save carries a number of tiles, and tiles mean different things on different glass: a player
   * who left the game at thirty on a monitor and opens it on a phone would be handed back the very
   * view this band exists to stop — the country from five hundred metres up, with themselves
   * fifteen pixels tall in the middle of it. So what comes back is held inside the band, which is
   * the same clamp their own fingers would hit a moment later, rather than thrown away: a player
   * who liked to play pulled back still gets the furthest this screen goes, and one who played
   * close still gets close.
   */
  restoreZoom(saved: number): void {
    if (!Number.isFinite(saved)) return;
    const band = this.band;
    this.zoom = Math.max(band.min, Math.min(band.max, saved));
    this.resize();
  }

  private applyFrustum(aspect: number): void {
    const c = this.camera;
    c.left = -this.zoom * aspect / 2;
    c.right = this.zoom * aspect / 2;
    c.top = this.zoom / 2;
    c.bottom = -this.zoom / 2;
    c.updateProjectionMatrix();
  }

  /**
   * The four corners of the picture, where they land on the ground the hero is standing on.
   *
   * The corner map used to draw the slice of world on screen as a square centred on the hero,
   * turned forty-five degrees and stretched by a hand-picked 1.4. That was true only while the
   * camera looked straight at the hero's feet, and it stopped being true the moment it learned to
   * aim up at a mountain: the hero then sits three-quarters of the way down the frame, most of
   * what is on screen is in front of him, and a box drawn round him says otherwise.
   *
   * So ask the camera instead of guessing. An orthographic picture has one direction through it,
   * so each corner is a point on the near plane run along that direction until it meets the
   * ground — no trigonometry of ours to go stale if the rig is ever re-pitched, re-zoomed or
   * turned.
   *
   * Returned clockwise from the bottom-left of the screen. A flat plane, because the ground is not
   * one and following it would mean four raycasts a frame for a line drawn six pixels long.
   */
  groundCorners(groundY: number): Array<{ x: number; z: number }> {
    this.camera.getWorldDirection(FORWARD);
    const out: Array<{ x: number; z: number }> = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      CORNER.set(nx, ny, 0).unproject(this.camera);
      // the camera looks down, so this always meets the plane; the guard is for a rig pitched flat
      const along = Math.abs(FORWARD.y) < 1e-4 ? 0 : (groundY - CORNER.y) / FORWARD.y;
      out.push({ x: CORNER.x + FORWARD.x * along, z: CORNER.z + FORWARD.z * along });
    }
    return out;
  }

  private applyPosition(): void {
    const at = this.target.y + this.lift;
    this.camera.position.set(
      this.target.x + Math.cos(this.rotation) * CAMERA.DIST,
      at + CAMERA.HEIGHT,
      this.target.z + Math.sin(this.rotation) * CAMERA.DIST,
    );
    this.camera.lookAt(this.target.x, at, this.target.z);
  }
}
