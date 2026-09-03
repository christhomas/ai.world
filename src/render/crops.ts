import * as THREE from 'three';
import { PropKind } from '../world/biomes';
import { addPropInstances, disposeInstances } from './instancing';
import type { PropLibrary } from './props';
import { WORLD } from '../core/config';
import { ripeness, type Plots } from '../game/farming';

/** How far a planting can be from the hero before it stops being drawn. */
const DRAW_RANGE = 70;

/**
 * Draws whatever is growing. Plantings change rarely, so the meshes are rebuilt only when the
 * set of visible tiles or their growth stage actually changes.
 */
export class CropField {
  private readonly group = new THREE.Group();
  private signature = '';

  constructor(scene: THREE.Object3D, private readonly props: PropLibrary, private readonly glowMaterial: THREE.Material) {
    scene.add(this.group);
  }

  /** @param heightAt ground height, so crops sit on the soil rather than floating */
  update(plots: Plots, day: number, heroX: number, heroZ: number, heightAt: (x: number, z: number) => number | null): void {
    const near = plots.entries().filter((p) => Math.hypot(p.x - heroX, p.z - heroZ) < DRAW_RANGE);
    const stageOf = (r: number) => (r >= 1 ? PropKind.CropRipe : r >= 0.45 ? PropKind.CropYoung : PropKind.Seedling);
    const signature = near.map((p) => `${p.x},${p.z},${stageOf(ripeness(p.planting, day))}`).sort().join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.group.clear();
    disposeInstances(this.group);
    addPropInstances(
      this.group, this.props,
      near.map((p) => ({
        kind: stageOf(ripeness(p.planting, day)),
        x: p.x + 0.5,
        y: heightAt(p.x + 0.5, p.z + 0.5) ?? WORLD.STEP,
        z: p.z + 0.5,
        rot: 0,
      })),
      this.glowMaterial,
    );
  }

  dispose(): void {
    disposeInstances(this.group);
  }
}
