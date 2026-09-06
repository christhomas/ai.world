import * as THREE from 'three';
import { CAMERA } from '../core/config';
import type { IsoCamera } from '../render/camera';
import type { Ranges } from '../world/ranges';

/**
 * How far back the camera stands when there is a mountain about.
 *
 * The picture is an orthographic box half as tall as the zoom, and the zoom was capped at
 * seventy-two — thirty-six units of height. A peak stands fifty-five units above the ground it
 * grows out of, and at forty-five degrees that is about thirty-nine units up the screen from its
 * own foot before the ground it covers is counted at all. So a mountain could not be looked at:
 * the top of it was cut off by the top of the frustum, and what showed through the gap was the
 * grass underneath. Every mountain in the game was a grey band across the middle of the screen.
 *
 * The camera therefore opens up when the hero comes near a range and closes again as he leaves it.
 * That is a rule the game already has — a cave shuts the view in to seventeen — used the other way
 * round, and it is the honest one for a fixed camera: the alternative is mountains built small
 * enough for the picture, which is a mountain that has agreed to be a hill.
 *
 * The player keeps the last word. Touching the wheel anywhere near a mountain hands the zoom back
 * to them for as long as they stay; the camera only takes it up again once they have walked out of
 * the range's country and come back.
 */

const VIEW = {
  /**
   * How near a peak the view starts opening, and how far away it has finished closing, in tiles.
   *
   * Both are generous. A mountain is in the picture long before you are standing on it — that is
   * the whole point of one — and a view that snapped open at its foot would be a camera that
   * lurched every time you crossed a line on a map you cannot see.
   */
  NEAR: 120,
  FAR: 260,
  /** Headroom above the summit, in world units, so a peak is not framed exactly at the top edge. */
  MARGIN: 12,
  /** However tall the mountain, the view never opens past this. Beyond it the hero is an ant. */
  CEILING: 150,
  /** How fast the zoom eases toward where it should be, as a share of the gap per second. */
  EASE: 1.6,
  /** A gap smaller than this is left alone, so the frustum is not rebuilt every frame for nothing. */
  SETTLED: 0.05,
  /**
   * The most the camera will look up, in world units, and how fast it gets there.
   *
   * Zooming out alone cannot frame a mountain: the picture is centred on the hero, so half of what
   * the extra height buys is spent on ground behind him. Lifting what the camera aims at moves the
   * whole picture up the mountain instead, which is what a person does when they look at one — and
   * it costs nothing in scale, so the hero stays the size he was.
   */
  LOOK_UP: 34,
  LOOK_EASE: 1.4,
} as const;

/**
 * How much of a peak's height ends up on the screen.
 *
 * The camera stands at forty-five degrees, so a thing `h` tall reaches `h · cos 45°` up the picture.
 * Written from the rig's own numbers rather than as 0.707, so it stays true if the pitch changes.
 */
const UPRIGHT = CAMERA.DIST / Math.hypot(CAMERA.DIST, CAMERA.HEIGHT);

export class Skyline {
  /** The zoom the player had before a mountain took the view, to give back when it is done. */
  private theirs: number = CAMERA.START_ZOOM;
  /** What this last set the zoom to, so a zoom that is not this is one the player chose. */
  private ours = Number.NaN;
  /** True once the player has overruled us, until they leave every range behind. */
  private handedOver = false;
  /** How far above the hero the camera is currently aiming, eased rather than snapped. */
  private lookUp = 0;
  private readonly up = new THREE.Vector3();
  private readonly toPeak = new THREE.Vector3();

  constructor(private readonly ranges: Ranges | null) {}

  /**
   * Called every frame with where the hero is. `outdoors` is false inside a building or a cave,
   * where somebody else owns the zoom and this must keep its hands off entirely.
   */
  update(iso: IsoCamera, x: number, z: number, dt: number, outdoors: boolean): void {
    if (!this.ranges || this.ranges.peaks.length === 0) return;
    if (!outdoors) { this.handedOver = false; this.ours = Number.NaN; this.lookUp = 0; return; }
    this.aim(iso, x, z, dt);

    // The tallest peak nearby, weighted by nothing: a big mountain far off wants as much room as a
    // small one close to, and taking the maximum of what each asks for is the whole calculation.
    let wants: number = CAMERA.MAX_ZOOM;
    for (const peak of this.ranges.peaks) {
      const away = Math.hypot(peak.x - x, peak.z - z);
      if (away > VIEW.FAR) continue;
      const near = Math.max(0, Math.min(1, (VIEW.FAR - away) / (VIEW.FAR - VIEW.NEAR)));
      const needs = (peak.lift * UPRIGHT + VIEW.MARGIN) * 2;
      wants = Math.max(wants, CAMERA.MAX_ZOOM + (Math.min(needs, VIEW.CEILING) - CAMERA.MAX_ZOOM) * near);
    }

    if (wants <= CAMERA.MAX_ZOOM + VIEW.SETTLED) {
      // out of the mountains: the ceiling comes back down, and the player gets the wheel back
      if (this.handedOver || !Number.isNaN(this.ours)) {
        iso.limitZoom(CAMERA.MAX_ZOOM);
        this.handedOver = false;
        this.ours = Number.NaN;
      }
      return;
    }

    // a zoom that is not the one this set is one the player set, and theirs stands
    if (!Number.isNaN(this.ours) && Math.abs(iso.zoom - this.ours) > VIEW.SETTLED) {
      this.handedOver = true;
      this.theirs = iso.zoom;
    }
    iso.limitZoom(Math.max(wants, iso.zoom));
    if (this.handedOver) return;

    if (Number.isNaN(this.ours)) this.theirs = iso.zoom;      // remember what to give back
    const gap = wants - iso.zoom;
    if (Math.abs(gap) < VIEW.SETTLED) return;
    iso.zoom += gap * Math.min(1, dt * VIEW.EASE);
    this.ours = iso.zoom;
    iso.resize();
  }

  /**
   * How far up the camera should be aiming, worked out from where the picture actually cuts off.
   *
   * The screen's up direction is the camera's own second axis, so how far up the picture a point
   * lands is that axis dotted with the way from the target to the point — no trigonometry of ours
   * to go stale if the rig is ever re-pitched. Anything past half the zoom is off the top of the
   * frame, and lifting the target by the shortfall over the vertical part of that axis is exactly
   * the lift that brings it back in.
   */
  private aim(iso: IsoCamera, x: number, z: number, dt: number): void {
    this.up.setFromMatrixColumn(iso.camera.matrixWorld, 1);
    let wants = 0;
    for (const peak of this.ranges!.peaks) {
      const away = Math.hypot(peak.x - x, peak.z - z);
      if (away > VIEW.FAR) continue;
      this.toPeak.set(peak.x - iso.target.x, peak.y - iso.target.y, peak.z - iso.target.z);
      const up = this.toPeak.dot(this.up);
      const room = iso.zoom / 2 - VIEW.MARGIN;
      if (up <= room) continue;
      wants = Math.max(wants, Math.min(VIEW.LOOK_UP, (up - room) / Math.max(0.2, this.up.y)));
    }
    this.lookUp += (wants - this.lookUp) * Math.min(1, dt * VIEW.LOOK_EASE);
  }

  /**
   * How far above the hero the camera is aiming this frame.
   *
   * Added to the camera's target after the hero has had his say about where it points, because he
   * pulls it back down to his own feet every frame and would otherwise undo this one.
   */
  get headroom(): number {
    return this.lookUp;
  }

  /** What the player had before the mountains took the view. Restored when a place hands it back. */
  get playersZoom(): number {
    return this.theirs;
  }
}
