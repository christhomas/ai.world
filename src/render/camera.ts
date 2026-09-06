import * as THREE from 'three';
import { CAMERA } from '../core/config';
import type { Input } from '../core/input';

/** Orthographic isometric rig: orbits a ground target, pans in screen space, zooms by frustum size. */
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
  zoom: number = CAMERA.START_ZOOM;
  /** How far back this place lets you stand: less sky indoors and underground than in a field. */
  private ceiling: number = CAMERA.MAX_ZOOM;

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
      this.zoom = Math.max(CAMERA.MIN_ZOOM, Math.min(this.ceiling, this.zoom + input.wheelDelta * 0.03));
      this.applyFrustum(window.innerWidth / window.innerHeight);
    }
    this.applyPosition();
  }

  resize(): void {
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
    this.ceiling = Math.max(CAMERA.MIN_ZOOM, most);
    if (this.zoom > this.ceiling) {
      this.zoom = this.ceiling;
      this.resize();
    }
  }

  private applyFrustum(aspect: number): void {
    const c = this.camera;
    c.left = -this.zoom * aspect / 2;
    c.right = this.zoom * aspect / 2;
    c.top = this.zoom / 2;
    c.bottom = -this.zoom / 2;
    c.updateProjectionMatrix();
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
