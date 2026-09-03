import * as THREE from 'three';
import { WORLD } from '../core/config';

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
  add(new THREE.BoxGeometry(3.4, 0.55, 1.5), 0x6b4a2b, [0, 0.25, 0]);
  add(new THREE.BoxGeometry(0.9, 0.5, 1.0), 0x6b4a2b, [2.0, 0.3, 0], [0, 0, 0.35]);
  add(new THREE.BoxGeometry(3.2, 0.1, 1.3), 0x9a6a3d, [0, 0.56, 0]);
  add(new THREE.BoxGeometry(0.5, 0.3, 1.3), 0x5a3a22, [-1.4, 0.7, 0]);
  add(new THREE.CylinderGeometry(0.06, 0.07, 2.8, 6), 0x5a3a22, [0.2, 1.9, 0]);
  add(new THREE.BoxGeometry(0.06, 1.5, 1.4), 0xf4f0e6, [0.25, 2.0, 0]);
  add(new THREE.BoxGeometry(0.4, 0.22, 0.04), 0xc0392b, [0.45, 3.2, 0]);
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), 0x8a6a3e, [-0.6, 0.75, 0.35]);
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), 0x8a6a3e, [-0.6, 0.75, -0.35]);
  g.position.y = WORLD.WATER_Y - 0.12;
  return g;
}
