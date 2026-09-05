import * as THREE from 'three';
import { CAMERA } from '../core/config';
import type { Input } from '../core/input';

/** Orthographic isometric rig: orbits a ground target, pans in screen space, zooms by frustum size. */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  rotation = Math.PI / 4;
  zoom: number = CAMERA.START_ZOOM;
  /** How far back this place lets you stand: less sky indoors and underground than in a field. */
  private ceiling: number = CAMERA.MAX_ZOOM;

  constructor() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.applyFrustum(aspect);
    this.applyPosition();
  }

  /** Unit vectors on the ground plane for "screen up" and "screen right". */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    return {
      fx: -Math.cos(this.rotation), fz: -Math.sin(this.rotation),
      rx: -Math.sin(this.rotation), rz: Math.cos(this.rotation),
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
      this.target.x += rx * input.dragDX * k + fx * input.dragDY * k;
      this.target.z += rz * input.dragDX * k + fz * input.dragDY * k;
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
    this.camera.position.set(
      this.target.x + Math.cos(this.rotation) * CAMERA.DIST,
      this.target.y + CAMERA.HEIGHT,
      this.target.z + Math.sin(this.rotation) * CAMERA.DIST,
    );
    this.camera.lookAt(this.target);
  }
}
