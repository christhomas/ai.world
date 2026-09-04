import * as THREE from 'three';
import { WORLD } from '../core/config';
import { WHALE, whaleAt, type Pod } from '../game/whales';

/**
 * Drawing the whales. A pod is only ever a few animals and only the near ones are worth drawing,
 * so this keeps a small pool of them and moves the pool to wherever the pods are — the same trick
 * the creature renderer uses, at a much smaller scale.
 *
 * Nothing here decides anything: where a whale is at a given second is `whaleAt`, and this puts a
 * body there. The foam rings are the exception, since a splash is a thing that happened rather
 * than a thing that is.
 */

/** Whales drawn at once. Beyond this the far pods simply go unattended. */
const POOL = 10;
/** Foam rings alive at once, and how long one takes to spread and fade. */
const RINGS = 8;
const RING_LIFE = 2.2;
const RING_SPREAD = 7;

export class WhaleSchool {
  private readonly bodies: THREE.Group[] = [];
  private readonly rings: Array<{ mesh: THREE.Mesh; left: number }> = [];
  private readonly ringMaterial: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const body = buildWhale();
      body.visible = false;
      scene.add(body);
      this.bodies.push(body);
    }
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.5, depthWrite: false });
    const ring = new THREE.RingGeometry(0.45, 0.62, 20);
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(ring, this.ringMaterial.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, left: 0 });
    }
  }

  /**
   * Put the drawn whales where the near pods say their whales are.
   * @returns where any whale came down this frame, for anything floating underneath
   */
  update(pods: Pod[], seconds: number, dt: number): Array<{ x: number; z: number }> {
    const splashes: Array<{ x: number; z: number }> = [];
    let drawn = 0;
    for (const pod of pods) {
      for (let i = 0; i < pod.size && drawn < POOL; i++) {
        const whale = whaleAt(pod, i, seconds);
        const body = this.bodies[drawn++];
        body.visible = true;
        body.position.set(whale.x, whale.y, whale.z);
        // yaw turns the body along its heading; pitch tips the nose up out and down in
        body.rotation.set(0, -whale.yaw, whale.pitch * 0.55, 'YZX');
        // a whale that was up and is now down has just hit the water
        const wasUp = body.userData.airborne === true;
        body.userData.airborne = whale.airborne;
        if (wasUp && !whale.airborne) {
          splashes.push({ x: whale.x, z: whale.z });
          this.splash(whale.x, whale.z);
        }
      }
    }
    for (let i = drawn; i < POOL; i++) this.bodies[i].visible = false;
    this.ageRings(dt);
    return splashes;
  }

  /** A ring of foam spreading from where something heavy met the water. */
  splash(x: number, z: number): void {
    const spare = this.rings.find((r) => r.left <= 0) ?? this.rings[0];
    spare.left = RING_LIFE;
    spare.mesh.visible = true;
    spare.mesh.position.set(x, WORLD.WATER_Y + 0.04, z);
    spare.mesh.scale.setScalar(0.6);
  }

  private ageRings(dt: number): void {
    for (const ring of this.rings) {
      if (ring.left <= 0) continue;
      ring.left -= dt;
      const through = 1 - ring.left / RING_LIFE;
      ring.mesh.scale.setScalar(0.6 + through * RING_SPREAD);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - through);
      if (ring.left <= 0) ring.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const body of this.bodies) {
      this.scene.remove(body);
      body.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings[0]?.mesh.geometry.dispose();
    this.ringMaterial.dispose();
  }
}

/**
 * A whale, in the same flat-shaded parts as everything else: a long dark back, a pale belly, two
 * flippers and a tail that reads as a tail from any distance.
 */
function buildWhale(): THREE.Group {
  const group = new THREE.Group();
  const back = new THREE.MeshLambertMaterial({ color: 0x2f4a63, flatShading: true });
  const belly = new THREE.MeshLambertMaterial({ color: 0xb9cbd8, flatShading: true });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), back);
  body.scale.set(2.9, 0.95, 1.15);
  body.castShadow = true;
  group.add(body);

  const underside = new THREE.Mesh(new THREE.SphereGeometry(0.92, 10, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), belly);
  underside.scale.set(2.85, 0.9, 1.1);
  underside.position.y = -0.06;
  group.add(underside);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 9, 6), back);
  head.scale.set(1.5, 0.85, 1);
  head.position.set(2.15, -0.05, 0);
  group.add(head);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 4), back);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-3.0, 0.1, 0);
  group.add(tail);

  const fluke = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.12, 2.5), back);
  fluke.position.set(-3.6, 0.18, 0);
  fluke.rotation.z = -0.25;
  group.add(fluke);

  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.5), back);
    fin.position.set(0.6, -0.25, side * 1.0);
    fin.rotation.set(0, side * 0.4, side * 0.25);
    group.add(fin);
  }
  return group;
}
