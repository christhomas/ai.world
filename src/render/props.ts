import * as THREE from 'three';
import { cutAwayFor } from './cutaway';
import { PROPS, propFootprints } from '../entities/props';
import type { PropKind } from '../world/biomes';
import type { Footprints } from '../world/footprints';
import { build } from './geometry';

/**
 * The prop catalogue, drawn.
 *
 * What a prop *is* — the parts it is made of and how much ground it stands on — is in
 * `entities/props.ts`, as data anything can read. This is the half that needs a renderer: one
 * merged geometry per kind with baked vertex colours, which chunks draw with `InstancedMesh`, so
 * a forest costs one draw call.
 *
 * There used to be a five-hundred-line list of `THREE` primitives here, and the measuring of it
 * lived next door. Both moved out together, for a reason that only showed up in the server's
 * container image: a world that draws nothing still has to know how wide a cottage is, and while
 * the only way to know that was to build one, it had to carry a 3D library to do it.
 */
export class PropLibrary {
  readonly geometries = new Map<PropKind, THREE.BufferGeometry>();
  /** Window-only geometry per building kind, drawn unlit so it can glow at night. */
  readonly glows = new Map<PropKind, THREE.BufferGeometry>();
  /**
   * One material for every prop in the world, and the one that gets out of the way.
   *
   * Props are what actually stand between the camera and the hero — a curtain wall, a tower, a
   * cottage, an oak — so this is where the cutaway belongs. The ground is deliberately left alone:
   * see `render/cutaway.ts`.
   */
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  /** How much ground each of these takes up, for whoever has to walk round them. */
  readonly footprints: Footprints = propFootprints();

  constructor() {
    cutAwayFor(this.material);
    for (const [kind, def] of PROPS) {
      this.geometries.set(kind, build(def.parts));
      if (def.glow) this.glows.set(kind, build(def.glow));
    }
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const g of this.glows.values()) g.dispose();
    this.material.dispose();
  }
}
