import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The shape-building machinery behind the prop catalogue: coloured primitives, a triangular
 * prism for roofs, and the cottage and chapel shells that several biomes share. Nothing here
 * knows what a tree or a forge is; that lives in the catalogue.
 */

export type WindowSpec = [[number, number, number], [number, number, number]];
export const HOUSE_WINDOWS: WindowSpec[] = [
  [[0.08, 0.42, 0.42], [1.22, 1.15, 0.75]],
  [[0.08, 0.42, 0.42], [1.22, 1.15, -0.75]],
  [[0.42, 0.42, 0.08], [0, 1.15, 1.22]],
  [[0.42, 0.42, 0.08], [-0.4, 1.15, -1.22]],
];
export const CHURCH_WINDOWS: WindowSpec[] = [
  [[0.08, 0.9, 0.3], [1.32, 1.8, 0.6]],
  [[0.08, 0.9, 0.3], [1.32, 1.8, -0.6]],
  [[0.3, 0.9, 0.08], [0.4, 1.5, 1.12]],
  [[0.3, 0.9, 0.08], [-0.4, 1.5, 1.12]],
  [[0.3, 0.9, 0.08], [0.4, 1.5, -1.12]],
  [[0.3, 0.9, 0.08], [-0.4, 1.5, -1.12]],
];

export interface HouseStyle { wall: number; roof: number; trim: number; roofType: 'gable' | 'flat' | 'steep' }

/** Small cottage on a 3x3 footprint; door faces +x. */
export function house(st: HouseStyle): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(2.6, 0.2, 2.6), st.trim, [0, 0.1, 0]),
    part(new THREE.BoxGeometry(2.4, 1.5, 2.4), st.wall, [0, 0.95, 0]),
    part(new THREE.BoxGeometry(0.08, 0.95, 0.62), 0x3a2a1a, [1.22, 0.68, 0]),
    ...HOUSE_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(...size), 0x9fd4ef, pos)),
    part(new THREE.BoxGeometry(0.55, 0.16, 0.9), st.trim, [1.5, 0.08, 0]),
  ];
  if (st.roofType === 'flat') {
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 2.7), st.roof, [0, 1.85, 0]));
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 0.2), st.trim, [0, 2.1, 1.25]));
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 0.2), st.trim, [0, 2.1, -1.25]));
    parts.push(part(new THREE.BoxGeometry(0.2, 0.3, 2.7), st.trim, [-1.25, 2.1, 0]));
  } else {
    const h = st.roofType === 'steep' ? 1.6 : 1.1;
    parts.push(prism(3.0, h, 3.0, st.roof, [0, 1.7, 0]));
    parts.push(part(new THREE.BoxGeometry(0.34, 0.9, 0.34), st.trim, [-0.7, 1.7 + h * 0.55, 0.7]));
  }
  return merge(parts);
}

/** Chapel on a 3x3 footprint: nave with a steep roof, a steeple at the back, door facing +x. */
export function church(st: HouseStyle): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(2.7, 0.2, 2.7), st.trim, [0, 0.1, 0]),
    part(new THREE.BoxGeometry(2.5, 2.1, 2.2), st.wall, [0.05, 1.25, 0]),
    part(new THREE.BoxGeometry(0.08, 1.3, 0.8), 0x3a2a1a, [1.32, 0.85, 0]),
    ...CHURCH_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(...size), 0x9fd4ef, pos)),
    part(new THREE.BoxGeometry(0.7, 0.16, 1.1), st.trim, [1.6, 0.08, 0]),
    // steeple at the back
    part(new THREE.BoxGeometry(1.0, 4.2, 1.0), st.wall, [-0.9, 2.1, 0]),
    part(new THREE.ConeGeometry(0.85, 1.4, 4), st.roof, [-0.9, 4.9, 0], [1, 1, 1], [0, Math.PI / 4, 0]),
    part(new THREE.BoxGeometry(0.08, 0.7, 0.08), 0xf1c40f, [-0.9, 5.9, 0]),
    part(new THREE.BoxGeometry(0.4, 0.08, 0.08), 0xf1c40f, [-0.9, 6.0, 0]),
    part(new THREE.BoxGeometry(0.3, 0.5, 0.08), 0x2a1a10, [-0.9, 3.6, 0.52]),
    part(new THREE.BoxGeometry(0.3, 0.5, 0.08), 0x2a1a10, [-0.9, 3.6, -0.52]),
  ];
  if (st.roofType === 'flat') {
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 2.5), st.roof, [0.15, 2.45, 0]));
  } else {
    parts.push(prism(2.9, 1.5, 2.6, st.roof, [0.15, 2.3, 0]));
  }
  return merge(parts);
}

/** Triangular prism with the ridge along z, base at y=0 of `pos`. */
export function prism(w: number, h: number, d: number, hex: number, pos: [number, number, number]): THREE.BufferGeometry {
  const x = w / 2, z = d / 2;
  const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], D = [-x, 0, z], E = [0, h, -z], F = [0, h, z];
  const tris: number[][][] = [
    [B, C, F], [B, F, E],      // +x slope
    [D, A, E], [D, E, F],      // -x slope
    [C, D, F],                 // +z gable
    [A, B, E],                 // -z gable
    [A, D, C], [A, C, B],      // underside
  ];
  const positions: number[] = [];
  for (const [a, b, c] of tris) {
    // ensure outward winding: normal must point away from the prism centre
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = nx * cx + ny * (cy - h / 3) + nz * cz >= 0;
    const order = out ? [a, b, c] : [a, c, b];
    for (const p of order) positions.push(p[0], p[1], p[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  g.computeVertexNormals();
  return part(g, hex, pos);
}

export function part(
  geo: THREE.BufferGeometry, hex: number,
  pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo; // flat shading falls out of unshared vertices
  if (g !== geo) geo.dispose();
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  ));
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('prop merge failed');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return g;
}
