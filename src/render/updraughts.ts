import * as THREE from 'three';
import { THERMAL, thermalsAround } from '../world/thermals';

/**
 * What a column of warm air looks like from the ground.
 *
 * The lift itself is a fact about a place and nothing can see it — `world/thermals.ts` is arithmetic
 * — so without this a glider pilot would be hunting for something invisible with no way of learning
 * where it was. The whole feature turns on being able to look across a valley and say *there*.
 *
 * So each column is drawn twice over: a lazy spiral of motes going up it, which reads as air
 * moving, and a low cloud standing on top of it, which is what you can actually see from a mile
 * off and is how real ones are found. Both are cheap — one instanced mesh apiece, a few hundred
 * instances between them, written only for the columns near enough to be in shot.
 *
 * Deliberately not lit and deliberately not shadowed. It is air.
 */

/** How far from the hero a column is worth drawing, in tiles. */
const SEEN_FROM = 260;

/** How many motes go up each column, and how far apart the columns' clouds sit above the ground. */
const MOTES = 26;
const CLOUD_AT = THERMAL.CEILING * 0.75;

/** The most columns drawn at once. Past this the sky is a texture rather than a set of landmarks. */
const AT_ONCE = 24;

export class Updraughts {
  private readonly motes: THREE.InstancedMesh;
  private readonly clouds: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private t = 0;

  constructor(scene: THREE.Scene, private readonly seed: number) {
    // a mote is a small pale flake, unlit so it reads as light rather than as a thing
    const flake = new THREE.PlaneGeometry(0.55, 0.55);
    this.motes = new THREE.InstancedMesh(
      flake,
      new THREE.MeshBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
      AT_ONCE * MOTES,
    );
    // a cloud is one lump of the same geometry everything else in this world is made of
    this.clouds = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      // pale, soft and flat: a lit solid at this size reads as a boulder somebody left on a
      // hillside, which is what the first version of this looked like
      new THREE.MeshLambertMaterial({
        color: 0xffffff, transparent: true, opacity: 0.5, flatShading: true, depthWrite: false,
      }),
      AT_ONCE * 3,
    );
    for (const mesh of [this.motes, this.clouds]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.air = true;                 // not a creature and not a prop: see `perf.test.ts`
      scene.add(mesh);
    }
  }

  /**
   * Draw the columns around a point.
   *
   * `groundAt` is asked once per column rather than per mote: a column stands on one piece of
   * ground and the motes go up from it, and a world that has not streamed that chunk yet answers
   * null — in which case the column is skipped rather than drawn at sea level, which is where the
   * first version put every thermal the player had not visited.
   */
  update(dt: number, x: number, z: number, groundAt: (x: number, z: number) => number | null): void {
    this.t += dt;
    const near = thermalsAround(x, z, SEEN_FROM, this.seed).slice(0, AT_ONCE);
    let mote = 0, cloud = 0;
    for (const one of near) {
      /*
       * A cloud stands whether or not this page has built the ground under it.
       *
       * The columns are landmarks — the whole point of drawing them is that you can look across a
       * valley and see where the lift is — and the ground three hundred tiles away is exactly the
       * ground a page has not streamed yet. Asking for it and giving up when it answers null drew
       * precisely one column, the one the player was standing next to, which is the one you do not
       * need a landmark for.
       *
       * So the cloud hangs at a height above the sea and the motes, which are a thing you see close
       * up and which have to start at somebody's feet, wait for the ground to turn up.
       */
      const ground = groundAt(one.x, one.z);
      for (let i = 0; ground !== null && i < MOTES; i++) {
        // each mote climbs the column on its own schedule and starts again at the bottom, which is
        // one modulo and no per-mote state at all
        const climbed = ((this.t * 0.22 + i / MOTES) % 1);
        const up = climbed * CLOUD_AT;
        // and turns about the middle as it goes, because warm air does and because a straight line
        // of dots reads as a fence post
        const turn = climbed * Math.PI * 3 + i;
        const wide = THERMAL.RADIUS * 0.55 * (0.3 + climbed * 0.7);
        this.pos.set(one.x + Math.cos(turn) * wide, ground + 0.4 + up, one.z + Math.sin(turn) * wide);
        // fading in at the bottom and out at the top, done with size because these are unlit quads
        // sharing one material and opacity is not per instance
        const size = Math.sin(Math.PI * climbed) * 0.9 + 0.15;
        this.scale.set(size, size, size);
        this.m.compose(this.pos, this.quat, this.scale);
        this.motes.setMatrixAt(mote++, this.m);
      }
      // three lumps at the top, which is a cloud in this world's language
      const under = ground ?? 0;
      for (let i = 0; i < 3; i++) {
        const swing = this.t * 0.05 + i * 2.1;
        this.pos.set(
          one.x + Math.cos(swing) * (2.2 + i * 1.4),
          under + CLOUD_AT + Math.sin(swing * 0.7) * 0.6 + i * 0.8,
          one.z + Math.sin(swing) * (2.2 + i * 1.4),
        );
        const size = 4.4 - i * 0.8;
        this.scale.set(size, size * 0.4, size);
        this.m.compose(this.pos, this.quat, this.scale);
        this.clouds.setMatrixAt(cloud++, this.m);
      }
    }
    this.write(this.motes, mote);
    this.write(this.clouds, cloud);
  }

  private write(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Which way the motes face: at the camera, so a flake is never edge-on and invisible. */
  faceThe(camera: THREE.Camera): void {
    this.quat.copy(camera.quaternion);
  }

  dispose(): void {
    for (const mesh of [this.motes, this.clouds]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
  }
}
