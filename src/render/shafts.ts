import * as THREE from 'three';
import { SHAFT, shaftsAround } from '../world/shafts';

/**
 * A hole in the ground, drawn so that it looks like one.
 *
 * It has to read as a *drop* rather than as a dark patch of grass, and it has to read that way from
 * far enough off to be walked to on purpose — the whole point of a shaft is that you can see it,
 * want it, and have to go and buy the means of getting into it. So: a black disc laid on the
 * ground with a ring of spoil round the lip, which is what a hole in a field actually looks like
 * from above, and which the low-poly world already has the vocabulary for.
 *
 * Flat, like the whirlpools, and for the same reason: the ground in this world is a mesh built per
 * chunk, and cutting a real hole in it would mean the mesher, the collision boxes and the streaming
 * all learning about one piece of scenery.
 */

/** How far off a shaft is worth drawing, in tiles. */
const SEEN_FROM = 220;
/** The most drawn at once, and how many stones make the lip of one. */
const AT_ONCE = 8;
const STONES = 11;

export class Shafts {
  private readonly hole: THREE.InstancedMesh;
  private readonly lip: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private readonly turned = new THREE.Quaternion();
  private readonly spin = new THREE.Euler();
  private readonly scale = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene, private readonly seed: number) {
    this.hole = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20),
      // unlit black: a lit dark material picks up the sun and reads as slate rather than as depth
      new THREE.MeshBasicMaterial({ color: 0x05070a }),
      AT_ONCE,
    );
    this.lip = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: 0x6b6a63, flatShading: true }),
      AT_ONCE * STONES,
    );
    for (const mesh of [this.hole, this.lip]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.ground = true;
      scene.add(mesh);
    }
    this.hole.renderOrder = 1;
    this.lip.castShadow = true;
    this.lip.receiveShadow = true;
  }

  /**
   * Draw the shafts around a point.
   *
   * `groundAt` answers null for a chunk this page has not built, and `couldBe` for a spot that is
   * sea, road or somebody's front garden — a shaft that fails either is not there at all, and the
   * two questions are asked in that order because the cheap one is second.
   */
  update(x: number, z: number, groundAt: (x: number, z: number) => number | null, couldBe: (x: number, z: number) => boolean): void {
    let holes = 0, stones = 0;
    for (const one of shaftsAround(x, z, SEEN_FROM, this.seed)) {
      if (holes >= AT_ONCE) break;
      const ground = groundAt(one.x, one.z);
      if (ground === null || !couldBe(one.x, one.z)) continue;

      // the mouth, a hair above the turf so it is not fighting the ground for the same pixels
      this.pos.set(one.x, ground + 0.03, one.z);
      this.scale.set(SHAFT.MOUTH, SHAFT.MOUTH, 1);
      this.m.compose(this.pos, this.flat, this.scale);
      this.hole.setMatrixAt(holes++, this.m);

      // and the spoil round the lip: the rock that came out of it, in the shapes this world uses
      for (let i = 0; i < STONES; i++) {
        const turn = (i / STONES) * Math.PI * 2 + one.x * 0.7;
        const out = SHAFT.MOUTH * (1.02 + (i % 3) * 0.06);
        const size = 0.24 + (i % 4) * 0.07;
        this.pos.set(one.x + Math.cos(turn) * out, ground + size * 0.35, one.z + Math.sin(turn) * out);
        this.spin.set(i * 0.7, turn, i * 1.3);
        this.turned.setFromEuler(this.spin);
        this.scale.set(size, size * 0.7, size);
        this.m.compose(this.pos, this.turned, this.scale);
        this.lip.setMatrixAt(stones++, this.m);
      }
    }
    this.write(this.hole, holes);
    this.write(this.lip, stones);
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
    for (const mesh of [this.hole, this.lip]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
  }
}
