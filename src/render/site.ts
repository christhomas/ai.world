import * as THREE from 'three';
import { PropKind } from '../world/biomes';
import { addPropInstances, disposeInstances } from './instancing';
import type { PropLibrary } from './props';
import { WORLD } from '../core/config';

/**
 * How far a building site can be from the hero before it stops being drawn.
 *
 * Wider than the crops use, because a house is a landmark and a crop is not: the whole point of
 * having one built is seeing it from the road on the way back, and a house that only came into
 * existence once you were standing on it would be a nasty surprise rather than a homecoming.
 */
const DRAW_RANGE = 140;

/**
 * A plot with something on it, in the terms drawing needs and no others.
 *
 * The crop field next door reads its plantings straight out of `Plots` and works out their
 * ripeness itself, and this would happily do the same with commissions — but the architecture
 * test only has room for so many places where drawing reaches up into the rules, and it says so
 * in as many words. So the caller does the one subtraction that decides which stage a house is at
 * and hands the answer down. The union below is the same one `building.ts` calls `Stage`, and the
 * compiler will say so at the call site the day the two stop agreeing.
 */
export interface Site {
  id: string;
  x: number;
  z: number;
  /** Which way the front of it looks, in radians. */
  rot?: number;
  stage: 'pegs' | 'frame' | 'roof' | 'house';
}

/** Which prop stands on the plot at each stage of the work. */
const PROP: Record<Site['stage'], PropKind> = {
  pegs: PropKind.HousePegs,
  frame: PropKind.HouseFrame,
  roof: PropKind.HouseRoof,
  house: PropKind.HouseYours,
};

/**
 * Draws the houses somebody has had built, at whatever stage of building they have reached.
 *
 * Written on the same pattern as the crop field, and for the same reason: a commission changes
 * about once a day, so the meshes are rebuilt only when the set of visible plots or the stage any
 * of them is at actually changes. Between those moments this costs one string compare a frame.
 *
 * It draws from the commissions rather than from the world's structure list because these houses
 * are not in the world's structure list — they were not there when the terrain was generated, and
 * putting them there would mean laying a village out again every time somebody paid a deposit.
 */
export class BuildingSite {
  private readonly group = new THREE.Group();
  private signature = '';

  constructor(scene: THREE.Object3D, private readonly props: PropLibrary, private readonly glowMaterial: THREE.Material) {
    scene.add(this.group);
  }

  /** @param heightAt ground height, so a house sits on its plot rather than hanging over it */
  update(sites: readonly Site[], heroX: number, heroZ: number, heightAt: (x: number, z: number) => number | null): void {
    const near = sites.filter((s) => Math.hypot(s.x - heroX, s.z - heroZ) < DRAW_RANGE);
    const signature = near.map((s) => `${s.id},${s.stage}`).sort().join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    this.group.clear();
    disposeInstances(this.group);
    addPropInstances(
      this.group, this.props,
      near.map((s) => ({
        kind: PROP[s.stage],
        x: s.x,
        y: heightAt(s.x, s.z) ?? WORLD.STEP,
        z: s.z,
        rot: s.rot ?? 0,
      })),
      this.glowMaterial,
    );
  }

  dispose(): void {
    disposeInstances(this.group);
  }
}
