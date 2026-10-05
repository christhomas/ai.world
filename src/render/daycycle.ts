import * as THREE from 'three';
import { Daylight, type DayCycleInput, type DaylightRig } from './daylight';

export { SHADOW, shadowsWorthDrawing } from './daylight';
export type { DayCycleInput } from './daylight';

/** Browser material mount for the production portable daylight calculations. */
export class DayCycle extends Daylight {
  readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0x9fd4ef });
  private released = false;
  constructor(rig: DaylightRig, now: () => number = () => performance.now()) { super(rig, now); }
  override apply(input: DayCycleInput): number {
    const night = super.apply(input);
    if (!this.released) this.glowMaterial.color.setRGB(...this.glowLinear);
    return night;
  }
  override dispose(): void {
    if (this.released) return;
    this.released = true;
    super.dispose();
    this.glowMaterial.dispose();
  }
}
