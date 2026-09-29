import * as THREE from 'three';
import { WORLD } from '../core/config';
import type { ScenePlacement, ScenePropPart } from '../core/scene';
import type { SceneGraph, SceneNode } from '../core/scenegraph';
import { bindGraphMount } from './graphmount';

/** One boat definition feeds the live adapter and the portable frame. */
export const BOAT_PARTS: readonly ScenePropPart[] = [
  { shape: 'box', size: [3.4, 0.55, 1.5], color: 0x6b4a2b, offset: [0, 0.25, 0] },
  { shape: 'box', size: [0.9, 0.5, 1.0], color: 0x6b4a2b, offset: [2.0, 0.3, 0], rot: [0, 0, 0.35] },
  { shape: 'box', size: [3.2, 0.1, 1.3], color: 0x9a6a3d, offset: [0, 0.56, 0] },
  { shape: 'box', size: [0.5, 0.3, 1.3], color: 0x5a3a22, offset: [-1.4, 0.7, 0] },
  { shape: 'cyl', size: [0.06, 0.07, 2.8, 6], color: 0x5a3a22, offset: [0.2, 1.9, 0] },
  { shape: 'box', size: [0.06, 1.5, 1.4], color: 0xf4f0e6, offset: [0.25, 2.0, 0] },
  { shape: 'box', size: [0.4, 0.22, 0.04], color: 0xc0392b, offset: [0.45, 3.2, 0] },
  { shape: 'box', size: [0.3, 0.3, 0.3], color: 0x8a6a3e, offset: [-0.6, 0.75, 0.35] },
  { shape: 'box', size: [0.3, 0.3, 0.3], color: 0x8a6a3e, offset: [-0.6, 0.75, -0.35] },
];

export function boatRecord(graph: SceneGraph, visible: boolean, mesh: THREE.Group): {
  node: Extract<SceneNode, { kind: 'prop-batch' }>; pose: ScenePlacement;
  show(on: boolean): void;
} {
  const pose: ScenePlacement = { x: 0, y: WORLD.WATER_Y - 0.12, z: 0, rot: 0 };
  const placements: ScenePlacement[] = visible ? [pose] : [];
  const node = graph.add({ kind: 'prop-batch', parts: BOAT_PARTS, placements,
    castShadow: true, receiveShadow: false }) as Extract<SceneNode, { kind: 'prop-batch' }>;
  bindGraphMount(graph, node, (frame) => {
    const at = frame.placements?.[0];
    mesh.visible = Boolean(at);
    if (!at) return;
    mesh.position.set(at.x, at.y, at.z);
    mesh.rotation.y = at.rot;
  });
  return { node, pose, show(on) { placements.length = 0; if (on) placements.push(pose); } };
}

/** A small ferry built from primitives; faces +x. */
export function buildBoat(): THREE.Group {
  const g = new THREE.Group();
  const mat = (hex: number) => new THREE.MeshLambertMaterial({ color: hex });
  const add = (geo: THREE.BufferGeometry, hex: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat(hex));
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  for (const part of BOAT_PARTS) {
    const geo = part.shape === 'cyl'
      ? new THREE.CylinderGeometry(part.size[0], part.size[1], part.size[2], part.size[3])
      : new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
    add(geo, part.color, part.offset, part.rot);
  }
  g.position.y = WORLD.WATER_Y - 0.12;
  return g;
}

/** A game-facing boat handle with pose changes owned by the renderer. */
export interface BoatVisual {
  visible: boolean;
  setPose(x: number, y: number, z: number, yaw: number): void;
}

export function putBoatIn(scene: THREE.Scene, graph?: SceneGraph): BoatVisual {
  const mesh = buildBoat();
  const record = graph && boatRecord(graph, false, mesh);
  mesh.visible = false;
  scene.add(mesh);
  return {
    get visible() { return mesh.visible; },
    set visible(on: boolean) { mesh.visible = on; record?.show(on); },
    setPose(x, y, z, yaw) {
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      if (record) Object.assign(record.pose, { x, y, z, rot: yaw });
    },
  };
}
