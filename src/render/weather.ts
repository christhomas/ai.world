import * as THREE from 'three';
import { Season } from '../game/seasons';

const COUNT = 900;
/** The column of falling drops follows the camera; this is its half-extent in tiles. */
const SPREAD = 46;
const HEIGHT = 26;

/**
 * Rain and snow as one Points cloud that follows the camera. Drops fall in world space and wrap
 * around, so there is no per-particle bookkeeping and nothing to save.
 */
export class Weather {
  readonly points: THREE.Points;
  private readonly offsets: Float32Array;
  private readonly speeds: Float32Array;
  private readonly material: THREE.PointsMaterial;
  private t = 0;
  private strength = 0;
  private snowy = false;

  constructor(scene: THREE.Scene) {
    const positions = new Float32Array(COUNT * 3);
    this.offsets = new Float32Array(COUNT * 3);
    this.speeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.offsets[i * 3] = (Math.random() * 2 - 1) * SPREAD;
      this.offsets[i * 3 + 1] = Math.random() * HEIGHT;
      this.offsets[i * 3 + 2] = (Math.random() * 2 - 1) * SPREAD;
      this.speeds[i] = 0.6 + Math.random() * 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({ color: 0xbcd8f0, size: 0.16, transparent: true, opacity: 0 });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** @param strength 0 = clear, 1 = full downpour */
  set(strength: number, season: Season): void {
    this.strength = strength;
    this.snowy = season === Season.Winter;
    this.material.color.setHex(this.snowy ? 0xf2f6ff : 0xa8c8e8);
    this.material.size = this.snowy ? 0.22 : 0.14;
  }

  update(dt: number, camX: number, camZ: number, camY: number): void {
    this.material.opacity = this.snowy ? this.strength * 0.9 : this.strength * 0.55;
    this.points.visible = this.strength > 0.02;
    if (!this.points.visible) return;
    const fall = this.snowy ? 4 : 26;
    const drift = this.snowy ? 2.2 : 0.8;
    this.t += dt;
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const speed = this.speeds[i];
      let y = this.offsets[i * 3 + 1] - ((this.t * fall * speed) % HEIGHT);
      if (y < 0) y += HEIGHT;
      const sway = this.snowy ? Math.sin(this.t * 0.8 + i) * drift : this.t * drift;
      arr[i * 3] = camX + this.offsets[i * 3] + sway;
      arr[i * 3 + 1] = camY - HEIGHT * 0.35 + y;
      arr[i * 3 + 2] = camZ + this.offsets[i * 3 + 2];
    }
    pos.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
