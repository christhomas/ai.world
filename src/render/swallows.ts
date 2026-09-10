import * as THREE from 'three';
import { MAELSTROM, maelstromsAround } from '../world/maelstroms';
import { WORLD } from '../core/config';

/**
 * What a whirlpool looks like from the deck of a boat.
 *
 * It has to be seen and it has to be seen *early*, because the whole of the decision is whether to
 * steer for it or round it, and a hazard you meet without warning is not a decision at all — it is
 * a thing that happened to you. So it is drawn as wide as it turns: rings of foam going round a
 * dark middle, laid flat on the water, turning slowly enough to read as a current rather than as an
 * effect.
 *
 * Flat rings rather than a funnel. The sea in this world is a plane at one height and everything
 * about it — the shader, the coast, the boats — is built on that being true, and a hole in it would
 * mean a hole in all of them for one piece of scenery. What sells it is the turning, not the depth.
 */

/** How far out a whirlpool is worth drawing, in tiles. */
const SEEN_FROM = 320;
/** The most drawn at once. They are four hundred tiles apart; two on screen would be remarkable. */
const AT_ONCE = 4;
/** How many arms of foam each one has, and how many flecks make up an arm. */
const ARMS = 5;
const FLECKS = 9;

export class Swallows {
  private readonly foam: THREE.InstancedMesh;
  private readonly eye: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private t = 0;

  constructor(scene: THREE.Scene, private readonly seed: number) {
    this.foam = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.75, depthWrite: false }),
      AT_ONCE * ARMS * FLECKS,
    );
    // the middle: dark, because what is under it is a cavern and not more sea
    this.eye = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 18),
      new THREE.MeshBasicMaterial({ color: 0x02101a, transparent: true, opacity: 0.92, depthWrite: false }),
      AT_ONCE,
    );
    for (const mesh of [this.eye, this.foam]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 1;              // over the water, under everything that floats on it
      mesh.userData.sea = true;
      scene.add(mesh);
    }
  }

  /**
   * Draw whatever is near enough to matter. `dt` turns them; nothing else moves.
   *
   * `wet` is what keeps them at sea. The lattice they come from knows nothing about the country —
   * it is arithmetic on a cell number — so a good half of the columns it produces land on grass, and
   * the first version of this drew a whirlpool turning in the middle of a meadow. A cell whose spot
   * is not water simply has no whirlpool in it, which makes them rarer than the spacing suggests
   * and puts every one of them where a boat could actually meet it.
   */
  update(dt: number, x: number, z: number, wet: (x: number, z: number) => boolean): void {
    this.t += dt;
    const near = maelstromsAround(x, z, SEEN_FROM, this.seed).filter((one) => wet(one.x, one.z)).slice(0, AT_ONCE);
    let fleck = 0, eye = 0;
    for (const one of near) {
      // a hair above the water so it is not fighting the surface for the same pixels
      const y = WORLD.WATER_Y + 0.06;
      this.pos.set(one.x, y, one.z);
      this.scale.set(MAELSTROM.MOUTH * 1.25, MAELSTROM.MOUTH * 1.25, 1);
      this.m.compose(this.pos, this.flat, this.scale);
      this.eye.setMatrixAt(eye++, this.m);

      for (let arm = 0; arm < ARMS; arm++) {
        for (let i = 0; i < FLECKS; i++) {
          // each fleck sits further out and further round than the last, so an arm is a spiral;
          // the whole thing turns with time, and the outside turns slower than the middle
          const along = (i + 1) / FLECKS;
          const out = MAELSTROM.MOUTH + along * (MAELSTROM.RADIUS - MAELSTROM.MOUTH);
          const turn = (arm / ARMS) * Math.PI * 2 + along * 2.4 - this.t * (0.9 / (0.4 + along));
          this.pos.set(one.x + Math.cos(turn) * out, y, one.z + Math.sin(turn) * out);
          const size = 0.55 + (1 - along) * 0.5;
          this.scale.set(size, size * 2.2, 1);
          // the fleck lies along the current rather than square to the world, which is what makes
          // the ring read as water going round rather than as a circle of dots
          this.m.compose(this.pos, this.flat, this.scale);
          this.m.multiply(new THREE.Matrix4().makeRotationZ(-turn));
          this.foam.setMatrixAt(fleck++, this.m);
        }
      }
    }
    this.write(this.eye, eye);
    this.write(this.foam, fleck);
  }

  private write(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.eye, this.foam]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
  }
}
