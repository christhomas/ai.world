import * as THREE from 'three';
import type { IsoCamera } from '../render/camera';
import type { Ranges } from '../world/ranges';

/**
 * Looking up at a mountain.
 *
 * The picture is an orthographic box half as tall as the zoom — fifteen world units above the hero
 * at the ordinary zoom — and a peak stands fifty-five units above the ground it grows out of. So a
 * mountain does not fit, and the top of one was simply cut off by the top of the frustum with the
 * grass beyond it showing through the gap.
 *
 * The first answer was to open the view up near a range. It worked and it was wrong: framing a
 * whole peak takes a hundred and fifty units of world, which makes the hero an ant seen from a mile
 * up — a picture of a mountain rather than a view from beside one.
 *
 * So the camera keeps its scale and aims up instead, which is what a person does when they look at
 * something tall. The hero sits lower in the frame, the mountain fills the top of it, and nothing
 * about how big anything is changes.
 */

const VIEW = {
  /** How far from a peak the camera starts looking up, and where it has stopped, in tiles. */
  NEAR: 120,
  FAR: 260,
  /** Headroom above the summit, in world units, so a peak is not framed exactly at the top edge. */
  MARGIN: 12,
  /**
   * The most the camera will look up, as a share of the height of the picture.
   *
   * The hero has to stay in the frame. Looking up by L moves him down the screen by about
   * L·cos(pitch), and the picture is only half the zoom tall — so a fixed thirty units put him off
   * the bottom of it entirely at the ordinary zoom, which is the second way this camera found of
   * being wrong about mountains. A quarter of the half-height tilts the view without ever losing
   * him, and gets larger if the player pulls back of their own accord.
   */
  SHARE: 0.5,
  /** And never more than this many world units, however far back somebody has zoomed. */
  LOOK_UP: 22,
  /** How fast it eases there, as a share of the gap per second. */
  EASE: 1.4,
} as const;

export class Skyline {
  /** How far above the hero the camera is currently aiming, eased rather than snapped. */
  private lookUp = 0;
  private readonly up = new THREE.Vector3();
  private readonly toPeak = new THREE.Vector3();

  constructor(private readonly ranges: Ranges | null) {}

  /**
   * Work out how far up to look, from where the picture actually cuts off.
   *
   * The screen's up direction is the camera's own second axis, so how far up the picture a point
   * lands is that axis dotted with the way from what the camera is looking at to the point — no
   * trigonometry of ours to go stale if the rig is ever re-pitched. Anything past half the zoom is
   * off the top of the frame, and lifting the aim by the shortfall over the vertical part of that
   * axis is exactly the lift that brings it back in.
   *
   * `outdoors` is false inside a building or a cave, where there is no sky and nothing to look up
   * at.
   */
  update(iso: IsoCamera, x: number, z: number, dt: number, outdoors: boolean): void {
    if (!this.ranges || this.ranges.peaks.length === 0 || !outdoors) {
      this.lookUp += (0 - this.lookUp) * Math.min(1, dt * VIEW.EASE);
      return;
    }
    this.up.setFromMatrixColumn(iso.camera.matrixWorld, 1);
    let wants = 0;
    for (const peak of this.ranges.peaks) {
      const away = Math.hypot(peak.x - x, peak.z - z);
      if (away > VIEW.FAR) continue;
      // measured from where the camera is already looking, so it does not ask for the same lift
      // again every frame and creep up the sky
      this.toPeak.set(peak.x - iso.target.x, peak.y - (iso.target.y + this.lookUp), peak.z - iso.target.z);
      const up = this.toPeak.dot(this.up);
      const room = iso.zoom / 2 - VIEW.MARGIN;
      if (up <= room) continue;
      const near = Math.max(0, Math.min(1, (VIEW.FAR - away) / (VIEW.FAR - VIEW.NEAR)));
      // never past what keeps the hero in the picture: he is what the camera is following
      const most = Math.min(VIEW.LOOK_UP, (iso.zoom / 2) * VIEW.SHARE);
      wants = Math.max(wants, Math.min(most, (this.lookUp + (up - room) / Math.max(0.2, this.up.y)) * near));
    }
    this.lookUp += (wants - this.lookUp) * Math.min(1, dt * VIEW.EASE);
  }

  /**
   * How far above the hero the camera is aiming this frame.
   *
   * Read by the camera itself rather than added to what it is following: the hero pulls the target
   * back to his own feet every frame, so anything added there accumulates instead of holding — as
   * it did, fifty units into the air, which is where "the camera is a mile up" came from.
   */
  get headroom(): number {
    return this.lookUp;
  }
}
