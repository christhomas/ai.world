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

/**
 * A hall's windows are tall and evenly spaced along both flanks, which is the whole of what says
 * "public building" from above: a cottage has whatever windows it happened to get, and a hall has
 * a row of them because somebody drew it before it was built.
 */
export const HALL_WINDOWS: WindowSpec[] = [
  [[0.3, 0.8, 0.08], [0.6, 1.25, 1.42]],
  [[0.3, 0.8, 0.08], [-0.2, 1.25, 1.42]],
  [[0.3, 0.8, 0.08], [0.6, 1.25, -1.42]],
  [[0.3, 0.8, 0.08], [-0.2, 1.25, -1.42]],
  [[0.08, 0.8, 0.3], [-1.42, 1.25, 0.55]],
  [[0.08, 0.8, 0.3], [-1.42, 1.25, -0.55]],
];
/** And a watch house's are small, high and few, which is the same trick used the other way. */
export const WATCH_WINDOWS: WindowSpec[] = [
  [[0.3, 0.3, 0.08], [0.5, 1.45, 1.22]],
  [[0.3, 0.3, 0.08], [0.5, 1.45, -1.22]],
  [[0.08, 0.3, 0.3], [-1.32, 1.45, 0]],
];

/**
 * What the two civic buildings are roofed in, whatever country they stand in.
 *
 * Everything else about them comes out of the biome's own palette, because a village is built of
 * what is round it. The roof does not, and that is the point: houses are roofed in whatever the
 * owner could get, and the parish pays for slate on the two buildings it means to outlast them.
 * It is also the only mark that survives being seen from directly above, which is how this game is
 * seen — the porch and the barred slit are invisible from three of the four sides, and this is
 * not.
 */
const CIVIC_SLATE = { hall: 0x9aa3ad, watch: 0x5a626e } as const;

export interface HouseStyle { wall: number; roof: number; trim: number; roofType: 'gable' | 'flat' | 'steep' }

/**
 * Small cottage on a 3x3 footprint; door faces +x.
 *
 * `storeys` is what a villager who has done well buys with it: the same house with another floor
 * under the same roof, and a second row of windows to say so from a distance.
 */
export function house(st: HouseStyle, storeys = 1): THREE.BufferGeometry {
  const lift = (storeys - 1) * 1.2;
  const parts: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(2.6, 0.2, 2.6), st.trim, [0, 0.1, 0]),
    part(new THREE.BoxGeometry(2.4, 1.5 + lift, 2.4), st.wall, [0, 0.95 + lift / 2, 0]),
    part(new THREE.BoxGeometry(0.08, 0.95, 0.62), 0x3a2a1a, [1.22, 0.68, 0]),
    ...HOUSE_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(...size), 0x9fd4ef, pos)),
    part(new THREE.BoxGeometry(0.55, 0.16, 0.9), st.trim, [1.5, 0.08, 0]),
  ];
  // an upper row of windows, so the extra floor reads as a floor rather than as a taller box
  if (lift > 0) {
    for (const [size, pos] of HOUSE_WINDOWS) {
      parts.push(part(new THREE.BoxGeometry(...size), 0x9fd4ef, [pos[0], pos[1] + lift, pos[2]]));
    }
  }
  if (st.roofType === 'flat') {
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 2.7), st.roof, [0, 1.85 + lift, 0]));
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 0.2), st.trim, [0, 2.1 + lift, 1.25]));
    parts.push(part(new THREE.BoxGeometry(2.7, 0.3, 0.2), st.trim, [0, 2.1 + lift, -1.25]));
    parts.push(part(new THREE.BoxGeometry(0.2, 0.3, 2.7), st.trim, [-1.25, 2.1 + lift, 0]));
  } else {
    const h = st.roofType === 'steep' ? 1.6 : 1.1;
    parts.push(prism(3.0, h, 3.0, st.roof, [0, 1.7 + lift, 0]));
    parts.push(part(new THREE.BoxGeometry(0.34, 0.9, 0.34), st.trim, [-0.7, 1.7 + lift + h * 0.55, 0.7]));
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

/**
 * The town hall on a 3x3 footprint: a long body under a ridge, a porch of pillars over the door,
 * and a turret with a flag on it. Door faces +x, like everything else on this footprint.
 *
 * The pillars are what the building is. A hall is otherwise a cottage drawn slightly bigger, and
 * from the height this camera looks from, slightly bigger is invisible — the eye reads outlines,
 * so the shape has to differ rather than the size. They are kept inside 1.5 tiles of the middle on
 * purpose: the door tile is two tiles out, and a porch that reached further would be a building you
 * could not walk up to.
 */
export function townHall(st: HouseStyle): THREE.BufferGeometry {
  const roofH = st.roofType === 'steep' ? 1.2 : 0.9;
  const ridge = st.roofType === 'flat' ? 2.4 : 2.14 + roofH;
  const roof = CIVIC_SLATE.hall;
  const parts: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(3.0, 0.24, 3.1), st.trim, [0, 0.12, 0]),
    part(new THREE.BoxGeometry(2.6, 1.9, 2.9), st.wall, [-0.15, 1.19, 0]),
    part(new THREE.BoxGeometry(0.08, 1.2, 0.8), 0x3a2a1a, [1.16, 0.84, 0]),
    ...HALL_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(...size), 0x9fd4ef, pos)),
    // the steps, which are below the height anything walks into and so cost nothing to walk past
    part(new THREE.BoxGeometry(0.6, 0.14, 1.8), st.trim, [1.6, 0.07, 0]),
  ];
  for (const z of [-1.0, -0.35, 0.35, 1.0]) {
    parts.push(part(new THREE.CylinderGeometry(0.13, 0.13, 1.8, 6), st.trim, [1.35, 1.14, z]));
  }
  parts.push(part(new THREE.BoxGeometry(0.8, 0.22, 2.4), st.trim, [1.35, 2.15, 0]));
  if (st.roofType === 'flat') {
    parts.push(part(new THREE.BoxGeometry(3.0, 0.3, 3.3), roof, [-0.15, 2.24, 0]));
    parts.push(part(new THREE.BoxGeometry(3.0, 0.26, 0.2), st.trim, [-0.15, 2.5, 1.55]));
    parts.push(part(new THREE.BoxGeometry(3.0, 0.26, 0.2), st.trim, [-0.15, 2.5, -1.55]));
  } else {
    parts.push(prism(3.0, roofH, 3.3, roof, [-0.15, 2.14, 0]));
  }
  // The turret, and it is deliberately too big for the building under it. Drawn to scale it was a
  // box on a ridge that nobody could pick out at the distance this camera looks from, and a town
  // hall you cannot find from across the square is a town hall nobody visits. A bell-cote, a
  // spire, and a banner: three things at three heights, so it reads from every side.
  parts.push(part(new THREE.BoxGeometry(0.8, 1.1, 0.8), 0xefe9d8, [-0.15, ridge + 0.35, 0]));
  parts.push(part(new THREE.BoxGeometry(0.62, 0.7, 0.06), 0x2a1a10, [-0.15, ridge + 0.4, 0.41]));
  parts.push(part(new THREE.BoxGeometry(0.06, 0.7, 0.62), 0x2a1a10, [0.41 - 0.15, ridge + 0.4, 0]));
  parts.push(part(new THREE.ConeGeometry(0.68, 1.0, 4), roof, [-0.15, ridge + 1.4, 0], [1, 1, 1], [0, Math.PI / 4, 0]));
  parts.push(part(new THREE.BoxGeometry(0.07, 1.1, 0.07), 0xefe9d8, [-0.15, ridge + 2.4, 0]));
  parts.push(part(new THREE.BoxGeometry(0.05, 0.4, 0.7), 0xc0392b, [-0.15, ridge + 2.75, 0.4]));
  return merge(parts);
}

/**
 * The watch house on the same 3x3 footprint: low, heavy, and shut. Door faces +x.
 *
 * Everything about it is the opposite of the hall next door, because that is the only way two
 * civic buildings on one square tell themselves apart from above: it is squat where the hall is
 * tall, its windows are small and high where the hall's are a row, and the back third of it is a
 * blind stone wing with one barred slit in it, which is the cell.
 */
export function watchHouse(st: HouseStyle): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    part(new THREE.BoxGeometry(2.9, 0.3, 2.8), st.trim, [0, 0.15, 0]),
    part(new THREE.BoxGeometry(2.7, 1.6, 2.6), st.wall, [0, 1.1, 0]),
    part(new THREE.BoxGeometry(0.08, 1.1, 0.7), 0x2a1a10, [1.36, 0.85, 0]),
    ...WATCH_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(...size), 0x9fd4ef, pos)),
    // the lock-up wing: stone whatever the rest is built of, and proud of the wall so it reads
    part(new THREE.BoxGeometry(1.05, 1.15, 2.7), 0x8f8f8f, [-0.85, 0.875, 0]),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.5), 0x2a1a10, [-1.4, 1.1, 0]),
    // a lamp over the door, which is how anybody finds the place at the hour they usually need it
    part(new THREE.BoxGeometry(0.32, 0.08, 0.08), 0x3a2a1a, [1.5, 2.0, 0]),
    part(new THREE.BoxGeometry(0.22, 0.28, 0.22), 0xf1c40f, [1.62, 1.82, 0]),
    part(new THREE.BoxGeometry(0.34, 0.9, 0.34), st.trim, [0.55, 2.35, 0.85]),
  ];
  for (const z of [-0.18, 0, 0.18]) {
    parts.push(part(new THREE.BoxGeometry(0.07, 0.47, 0.07), 0x4a4a4a, [-1.42, 1.1, z]));
  }
  if (st.roofType === 'flat') {
    parts.push(part(new THREE.BoxGeometry(3.0, 0.3, 2.9), CIVIC_SLATE.watch, [0, 2.0, 0]));
    parts.push(part(new THREE.BoxGeometry(3.0, 0.28, 0.2), st.trim, [0, 2.28, 1.35]));
    parts.push(part(new THREE.BoxGeometry(3.0, 0.28, 0.2), st.trim, [0, 2.28, -1.35]));
  } else {
    parts.push(prism(3.0, st.roofType === 'steep' ? 1.0 : 0.75, 2.9, CIVIC_SLATE.watch, [0, 1.9, 0]));
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
