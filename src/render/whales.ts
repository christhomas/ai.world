import * as THREE from 'three';
import { WORLD } from '../core/config';
import { WHALE, whaleAt, type Pod } from '../game/whales';
import type { SceneGraph, SceneNode } from '../core/scenegraph';

type MeshNode = Extract<SceneNode, { kind: 'mesh' }>;
interface WhalePart {
  shape: 'body' | 'belly' | 'head' | 'tail' | 'box';
  colour: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  castShadow?: boolean;
}

const PARTS: readonly WhalePart[] = [
  { shape: 'body', colour: 0x2f4a63, position: [0, 0, 0], rotation: [0, 0, 0], scale: [2.9, 0.95, 1.15], castShadow: true },
  { shape: 'belly', colour: 0xb9cbd8, position: [0, -0.06, 0], rotation: [0, 0, 0], scale: [2.85, 0.9, 1.1] },
  { shape: 'head', colour: 0x2f4a63, position: [2.15, -0.05, 0], rotation: [0, 0, 0], scale: [1.5, 0.85, 1] },
  { shape: 'tail', colour: 0x2f4a63, position: [-3, 0.1, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] },
  { shape: 'box', colour: 0x2f4a63, position: [-3.6, 0.18, 0], rotation: [0, 0, -0.25], scale: [0.75, 0.12, 2.5] },
  { shape: 'box', colour: 0x2f4a63, position: [0.6, -0.25, -1], rotation: [0, -0.4, -0.25], scale: [1.2, 0.12, 0.5] },
  { shape: 'box', colour: 0x2f4a63, position: [0.6, -0.25, 1], rotation: [0, 0.4, 0.25], scale: [1.2, 0.12, 0.5] },
];

function describeMesh(graph: SceneGraph, mesh: THREE.Mesh, colour: number, lit: boolean): MeshNode {
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  return graph.add({
    kind: 'mesh', material: 'lit-solid', colour, visible: false,
    castShadow: mesh.castShadow, receiveShadow: false,
    geometry: { positions: position.array as Float32Array, normals: normal.array as Float32Array,
      indices: mesh.geometry.index?.array as Uint16Array | Uint32Array | undefined },
    world: new THREE.Matrix4().toArray(),
    materialState: { intent: lit ? 'lit' : 'unlit', transparent: !lit,
      opacity: lit ? 1 : 0.5, depthWrite: lit,
      effects: lit ? ['flat-shading'] : [] },
  }) as MeshNode;
}

function partWorld(x: number, y: number, z: number, yaw: number, pitch: number, part: WhalePart, out: number[]): void {
  const root = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -yaw, pitch * 0.55, 'YZX')),
    new THREE.Vector3(1, 1, 1));
  const local = new THREE.Matrix4().compose(new THREE.Vector3(...part.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)),
    new THREE.Vector3(...part.scale));
  root.multiply(local).toArray(out);
}

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
  private readonly bodyNodes: MeshNode[][] = [];
  private readonly rings: Array<{ mesh: THREE.Mesh; left: number; node?: MeshNode }> = [];
  private readonly ringMaterial: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene, private readonly graph?: SceneGraph) {
    for (let i = 0; i < POOL; i++) {
      const body = buildWhale();
      body.visible = false;
      scene.add(body);
      this.bodies.push(body);
      this.bodyNodes.push(graph ? body.children.map((child, at) => describeMesh(graph, child as THREE.Mesh, PARTS[at].colour, true)) : []);
    }
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.5, depthWrite: false });
    const ring = new THREE.RingGeometry(0.45, 0.62, 20);
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(ring, this.ringMaterial.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      const node = graph && describeMesh(graph, mesh, 0xeaf6ff, false);
      this.rings.push({ mesh, left: 0, node });
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
        for (const [at, node] of this.bodyNodes[drawn - 1].entries()) {
          node.visible = true;
          partWorld(whale.x, whale.y, whale.z, whale.yaw, whale.pitch, PARTS[at], node.world!);
        }
        // a whale that was up and is now down has just hit the water
        const wasUp = body.userData.airborne === true;
        body.userData.airborne = whale.airborne;
        if (wasUp && !whale.airborne) {
          splashes.push({ x: whale.x, z: whale.z });
          this.splash(whale.x, whale.z);
        }
      }
    }
    for (let i = drawn; i < POOL; i++) {
      this.bodies[i].visible = false;
      for (const node of this.bodyNodes[i]) node.visible = false;
    }
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
    this.syncRing(spare);
  }

  private syncRing(ring: (typeof this.rings)[number]): void {
    const node = ring.node;
    if (!node) return;
    node.visible = ring.mesh.visible;
    node.materialState!.opacity = (ring.mesh.material as THREE.MeshBasicMaterial).opacity;
    new THREE.Matrix4().compose(ring.mesh.position, new THREE.Quaternion().setFromEuler(ring.mesh.rotation),
      ring.mesh.scale).toArray(node.world);
  }

  private ageRings(dt: number): void {
    for (const ring of this.rings) {
      if (ring.left <= 0) continue;
      ring.left -= dt;
      const through = 1 - ring.left / RING_LIFE;
      ring.mesh.scale.setScalar(0.6 + through * RING_SPREAD);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - through);
      if (ring.left <= 0) ring.mesh.visible = false;
      this.syncRing(ring);
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
    for (const nodes of this.bodyNodes) for (const node of nodes) this.graph?.remove(node);
    for (const ring of this.rings) {
      if (ring.node) this.graph?.remove(ring.node);
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
  const materials = new Map<number, THREE.MeshLambertMaterial>();
  for (const part of PARTS) {
    let material = materials.get(part.colour);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color: part.colour, flatShading: true });
      materials.set(part.colour, material);
    }
    const geometry = part.shape === 'body' ? new THREE.SphereGeometry(1, 10, 7)
      : part.shape === 'belly' ? new THREE.SphereGeometry(0.92, 10, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45)
        : part.shape === 'head' ? new THREE.SphereGeometry(0.72, 9, 6)
          : part.shape === 'tail' ? new THREE.ConeGeometry(0.62, 1.5, 4)
            : new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...part.position);
    mesh.rotation.set(...part.rotation);
    mesh.scale.set(...part.scale);
    mesh.castShadow = part.castShadow ?? false;
    group.add(mesh);
  }
  return group;
}
