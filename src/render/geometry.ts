import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropPart } from '../entities/shapes';

/**
 * How a part list becomes something that can be drawn.
 *
 * The parts themselves are in `entities/`, as plain data with no `THREE` in them, because the
 * server has to know how big a house is without owning a renderer. This is the other side of that
 * bargain: one primitive per part, coloured, turned, planted, and merged into a single geometry
 * per kind so that a forest costs one draw call. Nothing here knows what a tree or a forge is.
 *
 * The primitives are `THREE`'s own rather than triangles of ours, and `entities/shapes.ts`
 * reproduces where their corners land so that the box a walker meets is the shape on the screen.
 * `world/footprints.test.ts` stands the two against each other, prop by prop.
 */

/** One part, as geometry: the primitive its shape names, at its own size. */
export function buildPart(p: PropPart): THREE.BufferGeometry {
  return part(primitive(p), p.color, p.offset, p.scale, p.rot);
}

/** A whole prop: every part merged, ready to instance. */
export function build(parts: readonly PropPart[]): THREE.BufferGeometry {
  return merge(parts.map(buildPart));
}

function primitive(p: PropPart): THREE.BufferGeometry {
  switch (p.shape) {
    case 'box': return new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
    case 'cyl': return new THREE.CylinderGeometry(p.size[0], p.size[1], p.size[2], p.size[3]);
    case 'cone': return new THREE.ConeGeometry(p.size[0], p.size[1], p.size[2]);
    case 'ico': return new THREE.IcosahedronGeometry(p.size[0], p.size[1]);
    case 'dodec': return new THREE.DodecahedronGeometry(p.size[0], p.size[1]);
    case 'prism': return prism(p.size[0], p.size[1], p.size[2]);
  }
}

/**
 * Triangular prism with the ridge along z, base at y=0: every pitched roof in the game.
 *
 * Written out by hand because `THREE` has no prism, and a four-sided cone is a pyramid rather than
 * a roof.
 */
function prism(w: number, h: number, d: number): THREE.BufferGeometry {
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
  return g;
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
