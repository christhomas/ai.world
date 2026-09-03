import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PropKind } from '../world/biomes';

/**
 * Low-poly prop geometry built from primitives with baked vertex colours.
 * One geometry per kind; chunks render them with InstancedMesh, so a forest costs one draw call.
 */
export class PropLibrary {
  readonly geometries = new Map<PropKind, THREE.BufferGeometry>();
  /** Window-only geometry per building kind, drawn unlit so it can glow at night. */
  readonly glows = new Map<PropKind, THREE.BufferGeometry>();
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor() {
    this.geometries.set(PropKind.Oak, merge([
      part(new THREE.CylinderGeometry(0.13, 0.19, 1.0, 6), 0x6b4a2b, [0, 0.5, 0]),
      part(new THREE.IcosahedronGeometry(0.82, 1), 0x3f9a3a, [0, 1.5, 0]),
      part(new THREE.IcosahedronGeometry(0.5, 1), 0x4aa844, [0.4, 1.25, 0.25]),
    ]));
    this.geometries.set(PropKind.Pine, merge([
      part(new THREE.CylinderGeometry(0.1, 0.16, 0.7, 6), 0x5d3f26, [0, 0.35, 0]),
      part(new THREE.ConeGeometry(0.85, 1.05, 7), 0x2f6b34, [0, 1.05, 0]),
      part(new THREE.ConeGeometry(0.65, 0.95, 7), 0x357a3a, [0, 1.6, 0]),
      part(new THREE.ConeGeometry(0.42, 0.85, 7), 0x3d8a42, [0, 2.15, 0]),
    ]));
    this.geometries.set(PropKind.SnowPine, merge([
      part(new THREE.CylinderGeometry(0.1, 0.16, 0.7, 6), 0x4e3a2a, [0, 0.35, 0]),
      part(new THREE.ConeGeometry(0.85, 1.05, 7), 0x4f7f66, [0, 1.05, 0]),
      part(new THREE.ConeGeometry(0.65, 0.95, 7), 0x7fa792, [0, 1.6, 0]),
      part(new THREE.ConeGeometry(0.42, 0.85, 7), 0xe4edf2, [0, 2.15, 0]),
    ]));
    this.geometries.set(PropKind.Cactus, merge([
      part(new THREE.CylinderGeometry(0.2, 0.23, 1.5, 7), 0x4f9b47, [0, 0.75, 0]),
      part(new THREE.BoxGeometry(0.42, 0.16, 0.16), 0x4f9b47, [0.3, 0.9, 0]),
      part(new THREE.BoxGeometry(0.16, 0.5, 0.16), 0x559f4c, [0.46, 1.15, 0]),
      part(new THREE.BoxGeometry(0.38, 0.16, 0.16), 0x4f9b47, [-0.28, 0.65, 0.05]),
      part(new THREE.BoxGeometry(0.16, 0.42, 0.16), 0x559f4c, [-0.42, 0.85, 0.05]),
    ]));
    this.geometries.set(PropKind.Rock, merge([
      part(new THREE.DodecahedronGeometry(0.36, 0), 0x8a8a8a, [0, 0.2, 0], [1, 0.65, 1]),
    ]));
    this.geometries.set(PropKind.Boulder, merge([
      part(new THREE.DodecahedronGeometry(0.85, 0), 0x7d7d7d, [0, 0.5, 0], [1.15, 0.8, 1]),
      part(new THREE.DodecahedronGeometry(0.4, 0), 0x8f8f8f, [0.7, 0.25, 0.3], [1, 0.7, 1]),
    ]));
    this.geometries.set(PropKind.DeadTree, merge([
      part(new THREE.CylinderGeometry(0.08, 0.17, 1.4, 5), 0x6d5a48, [0, 0.7, 0]),
      part(new THREE.BoxGeometry(0.07, 0.6, 0.07), 0x6d5a48, [0.22, 1.3, 0], [1, 1, 1], [0, 0, -0.7]),
      part(new THREE.BoxGeometry(0.06, 0.5, 0.06), 0x6d5a48, [-0.18, 1.1, 0.05], [1, 1, 1], [0, 0, 0.9]),
    ]));
    this.geometries.set(PropKind.Bush, merge([
      part(new THREE.IcosahedronGeometry(0.42, 1), 0x4f9a3f, [0, 0.3, 0], [1, 0.75, 1]),
      part(new THREE.IcosahedronGeometry(0.3, 1), 0x58a646, [0.32, 0.24, 0.16], [1, 0.8, 1]),
    ]));
    this.geometries.set(PropKind.Reed, merge([
      part(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 4), 0x7fa54a, [0, 0.45, 0], [1, 1, 1], [0, 0, 0.08]),
      part(new THREE.CylinderGeometry(0.02, 0.03, 1.05, 4), 0x8db452, [0.12, 0.52, 0.06], [1, 1, 1], [0.1, 0, -0.06]),
      part(new THREE.CylinderGeometry(0.02, 0.03, 0.8, 4), 0x7fa54a, [-0.1, 0.4, -0.08], [1, 1, 1], [-0.08, 0, 0.12]),
      part(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 5), 0x6b4a2b, [0.12, 1.05, 0.06]),
      part(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 5), 0x6b4a2b, [0, 0.9, 0]),
    ]));
    this.geometries.set(PropKind.Flower, merge([
      part(new THREE.CylinderGeometry(0.015, 0.02, 0.32, 4), 0x5f9a3a, [0, 0.16, 0]),
      part(new THREE.IcosahedronGeometry(0.075, 0), 0xf25c6e, [0, 0.35, 0]),
      part(new THREE.CylinderGeometry(0.015, 0.02, 0.26, 4), 0x5f9a3a, [0.18, 0.13, 0.08]),
      part(new THREE.IcosahedronGeometry(0.065, 0), 0xf7d94c, [0.18, 0.29, 0.08]),
      part(new THREE.CylinderGeometry(0.015, 0.02, 0.28, 4), 0x5f9a3a, [-0.14, 0.14, 0.12]),
      part(new THREE.IcosahedronGeometry(0.07, 0), 0xffffff, [-0.14, 0.31, 0.12]),
    ]));
    this.geometries.set(PropKind.Tuft, merge([
      part(new THREE.ConeGeometry(0.07, 0.38, 4), 0x8cc457, [0, 0.19, 0], [1, 1, 1], [0.18, 0, 0.1]),
      part(new THREE.ConeGeometry(0.07, 0.42, 4), 0x9ccf5f, [0.1, 0.21, -0.06], [1, 1, 1], [-0.12, 0, -0.18]),
      part(new THREE.ConeGeometry(0.07, 0.34, 4), 0x8cc457, [-0.09, 0.17, 0.07], [1, 1, 1], [0.05, 0, 0.2]),
    ]));
    this.geometries.set(PropKind.Mushroom, merge([
      part(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 6), 0xe8dcc0, [0, 0.1, 0]),
      part(new THREE.IcosahedronGeometry(0.16, 0), 0xd23f3f, [0, 0.22, 0], [1, 0.55, 1]),
      part(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 6), 0xe8dcc0, [0.2, 0.07, 0.1]),
      part(new THREE.IcosahedronGeometry(0.11, 0), 0xd8563f, [0.2, 0.15, 0.1], [1, 0.55, 1]),
    ]));
    this.geometries.set(PropKind.Palm, merge([
      part(new THREE.CylinderGeometry(0.09, 0.16, 2.3, 6), 0x8a6a3e, [0.1, 1.15, 0], [1, 1, 1], [0, 0, -0.12]),
      ...[0, 1.26, 2.51, 3.77, 5.03].map((a) =>
        part(new THREE.BoxGeometry(1.3, 0.04, 0.32), 0x4f9b47, [0.24 + Math.cos(a) * 0.55, 2.2 - 0.12, Math.sin(a) * 0.55], [1, 1, 1], [0, -a, -0.45])),
    ]));
    this.geometries.set(PropKind.Lily, merge([
      part(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 7), 0x4f9b47, [0, 0.015, 0]),
      part(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 7), 0x5aa84f, [0.45, 0.015, 0.25]),
      part(new THREE.IcosahedronGeometry(0.08, 0), 0xf49ac1, [0.05, 0.08, 0.02]),
    ]));
    const houseStyles: Array<[PropKind, HouseStyle]> = [
      [PropKind.HousePlains, { wall: 0xf1e4c8, roof: 0xa5502f, trim: 0x8a6a4a, roofType: 'gable' }],
      [PropKind.HouseForest, { wall: 0x8a6238, roof: 0x4f6f3a, trim: 0x5a4632, roofType: 'gable' }],
      [PropKind.HouseDesert, { wall: 0xd9b57c, roof: 0xc49a5c, trim: 0xb08a55, roofType: 'flat' }],
      [PropKind.HouseSwamp, { wall: 0x6f5a42, roof: 0x8a7a45, trim: 0x4a3a2a, roofType: 'gable' }],
      [PropKind.HouseMountain, { wall: 0x8f8f8f, roof: 0x4f5a66, trim: 0x6e6e6e, roofType: 'steep' }],
      [PropKind.HouseSnow, { wall: 0x5a4632, roof: 0xf0f4f8, trim: 0x3a2a1a, roofType: 'steep' }],
    ];
    for (const [kind, style] of houseStyles) {
      this.geometries.set(kind, house(style));
      this.glows.set(kind, merge(HOUSE_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(size[0] * 1.06, size[1] * 1.06, size[2] * 1.06), 0xffffff, pos))));
      const churchKind = kind + (PropKind.ChurchPlains - PropKind.HousePlains);
      this.geometries.set(churchKind, church(style));
      this.glows.set(churchKind, merge(CHURCH_WINDOWS.map(([size, pos]) => part(new THREE.BoxGeometry(size[0] * 1.06, size[1] * 1.06, size[2] * 1.06), 0xffffff, pos))));
    }

    this.geometries.set(PropKind.Well, merge([
      part(new THREE.CylinderGeometry(0.62, 0.66, 0.7, 8), 0x8a8a8a, [0, 0.35, 0]),
      part(new THREE.CylinderGeometry(0.46, 0.46, 0.72, 8), 0x2a4a6a, [0, 0.36, 0]),
      part(new THREE.BoxGeometry(0.1, 1.4, 0.1), 0x6b4a2b, [0, 1.0, 0.5]),
      part(new THREE.BoxGeometry(0.1, 1.4, 0.1), 0x6b4a2b, [0, 1.0, -0.5]),
      prism(1.4, 0.5, 1.4, 0xa5502f, [0, 1.7, 0]),
      part(new THREE.BoxGeometry(0.06, 0.06, 1.0), 0x3a2a1a, [0, 1.6, 0]),
      part(new THREE.CylinderGeometry(0.12, 0.1, 0.16, 6), 0x5a4632, [0, 1.2, 0]),
    ]));
    {
      const pillars: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pillars.push(part(new THREE.CylinderGeometry(0.16, 0.2, 1.6, 6), 0xb8b4a8, [Math.cos(a) * 1.7, 0.8, Math.sin(a) * 1.7]));
        pillars.push(part(new THREE.BoxGeometry(0.44, 0.16, 0.44), 0xa8a498, [Math.cos(a) * 1.7, 1.68, Math.sin(a) * 1.7]));
      }
      this.geometries.set(PropKind.Shrine, merge([
        part(new THREE.CylinderGeometry(2.1, 2.1, 0.1, 12), 0xc9c4b4, [0, 0.05, 0]),
        part(new THREE.BoxGeometry(0.9, 0.5, 0.9), 0xa8a498, [0, 0.35, 0]),
        part(new THREE.IcosahedronGeometry(0.34, 0), 0x6fd3ff, [0, 1.25, 0], [0.8, 1.3, 0.8]),
        ...pillars,
      ]));
    }
    this.geometries.set(PropKind.Ruins, merge([
      part(new THREE.BoxGeometry(2.8, 0.12, 2.8), 0x8a8f80, [0, 0.06, 0]),
      part(new THREE.BoxGeometry(2.4, 1.3, 0.36), 0x9a9a92, [0, 0.65, -1.1]),
      part(new THREE.BoxGeometry(0.36, 0.8, 1.9), 0x9a9a92, [-1.1, 0.4, 0]),
      part(new THREE.BoxGeometry(0.36, 1.7, 1.0), 0x9a9a92, [1.1, 0.85, 0.5]),
      part(new THREE.BoxGeometry(0.5, 0.5, 0.36), 0x9a9a92, [0.9, 1.55, -1.1]),
      part(new THREE.IcosahedronGeometry(0.26, 0), 0x8a8a8a, [0.3, 0.2, 0.6]),
      part(new THREE.IcosahedronGeometry(0.2, 0), 0x8a8a8a, [-0.5, 0.16, 0.9]),
      part(new THREE.IcosahedronGeometry(0.3, 0), 0x7f8a70, [0.7, 0.22, -0.3], [1, 0.6, 1]),
    ]));
    this.geometries.set(PropKind.Tower, merge([
      part(new THREE.BoxGeometry(2.2, 0.4, 2.2), 0x7a7a7a, [0, 0.2, 0]),
      part(new THREE.BoxGeometry(1.6, 4.6, 1.6), 0x8f8f8f, [0, 2.7, 0]),
      part(new THREE.BoxGeometry(2.3, 0.3, 2.3), 0x6e6e6e, [0, 5.15, 0]),
      part(new THREE.BoxGeometry(2.3, 0.4, 0.15), 0x7a7a7a, [0, 5.5, 1.08]),
      part(new THREE.BoxGeometry(2.3, 0.4, 0.15), 0x7a7a7a, [0, 5.5, -1.08]),
      part(new THREE.BoxGeometry(0.15, 0.4, 2.3), 0x7a7a7a, [1.08, 5.5, 0]),
      part(new THREE.BoxGeometry(0.15, 0.4, 2.3), 0x7a7a7a, [-1.08, 5.5, 0]),
      part(new THREE.ConeGeometry(1.5, 1.2, 4), 0x4f5a66, [0, 5.9, 0], [1, 1, 1], [0, Math.PI / 4, 0]),
      part(new THREE.BoxGeometry(0.1, 1.0, 0.6), 0x2a1a10, [0.82, 0.9, 0]),
      part(new THREE.BoxGeometry(0.1, 0.5, 0.2), 0x2a1a10, [0.82, 3.2, 0]),
      part(new THREE.BoxGeometry(0.1, 0.5, 0.2), 0x2a1a10, [-0.82, 4.0, 0]),
    ]));
    this.geometries.set(PropKind.Campfire, merge([
      ...[0, 1.57, 3.14, 4.71].map((a) => part(new THREE.IcosahedronGeometry(0.18, 0), 0x7a7a7a, [Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55])),
      part(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 5), 0x5a3a22, [0, 0.1, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
      part(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 5), 0x5a3a22, [0, 0.18, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
      part(new THREE.ConeGeometry(0.26, 0.6, 5), 0xff7a1a, [0, 0.45, 0]),
      part(new THREE.ConeGeometry(0.15, 0.45, 5), 0xffd23a, [0.08, 0.5, 0.05]),
      part(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6), 0x6b4a2b, [1.1, 0.16, 0.5], [1, 1, 1], [0, 0.6, Math.PI / 2]),
      part(new THREE.BoxGeometry(0.6, 0.06, 0.9), 0x8a6a4a, [-1.0, 0.03, -0.6]),
    ]));
    this.geometries.set(PropKind.GiantTree, merge([
      part(new THREE.CylinderGeometry(0.55, 0.85, 3.4, 7), 0x5a3f28, [0, 1.7, 0]),
      part(new THREE.BoxGeometry(1.2, 0.5, 0.4), 0x5a3f28, [0.8, 0.25, 0.3], [1, 1, 1], [0, 0.4, 0]),
      part(new THREE.BoxGeometry(1.2, 0.5, 0.4), 0x5a3f28, [-0.7, 0.25, -0.5], [1, 1, 1], [0, 2.3, 0]),
      part(new THREE.BoxGeometry(1.0, 0.5, 0.4), 0x5a3f28, [-0.3, 0.25, 0.8], [1, 1, 1], [0, 4.0, 0]),
      part(new THREE.IcosahedronGeometry(2.5, 1), 0x3f9a3a, [0, 4.4, 0]),
      part(new THREE.IcosahedronGeometry(1.7, 1), 0x4aa844, [1.6, 3.7, 0.9]),
      part(new THREE.IcosahedronGeometry(1.5, 1), 0x3a8f36, [-1.4, 4.0, -0.8]),
      part(new THREE.IcosahedronGeometry(1.3, 1), 0x4aa844, [-0.6, 3.4, 1.5]),
    ]));

    this.geometries.set(PropKind.Stall, merge([
      part(new THREE.BoxGeometry(1.8, 0.12, 0.9), 0x8a6a4a, [0, 0.8, 0]),
      part(new THREE.BoxGeometry(1.7, 0.7, 0.8), 0x6b4a2b, [0, 0.4, 0]),
      part(new THREE.BoxGeometry(0.08, 2.0, 0.08), 0x5a4632, [-0.8, 1.0, -0.4]),
      part(new THREE.BoxGeometry(0.08, 2.0, 0.08), 0x5a4632, [0.8, 1.0, -0.4]),
      part(new THREE.BoxGeometry(0.08, 1.7, 0.08), 0x5a4632, [-0.8, 0.85, 0.5]),
      part(new THREE.BoxGeometry(0.08, 1.7, 0.08), 0x5a4632, [0.8, 0.85, 0.5]),
      part(new THREE.BoxGeometry(2.0, 0.06, 1.2), 0xd94a4a, [0, 1.85, 0.05], [1, 1, 1], [0.28, 0, 0]),
      part(new THREE.IcosahedronGeometry(0.14, 0), 0xd23f3f, [-0.5, 0.94, 0.1]),
      part(new THREE.IcosahedronGeometry(0.14, 0), 0xf5c542, [-0.2, 0.94, -0.15]),
      part(new THREE.IcosahedronGeometry(0.14, 0), 0x6fae4b, [0.2, 0.94, 0.15]),
      part(new THREE.BoxGeometry(0.4, 0.3, 0.3), 0xc9a26a, [0.55, 1.0, 0]),
    ]));
    this.geometries.set(PropKind.Sign, merge([
      part(new THREE.BoxGeometry(0.08, 1.4, 0.08), 0x5a4632, [0, 0.7, 0]),
      part(new THREE.BoxGeometry(0.7, 0.4, 0.06), 0xd9b57c, [0, 1.25, 0]),
      part(new THREE.BoxGeometry(0.5, 0.05, 0.08), 0x8a2a2a, [0, 1.3, 0]),
      part(new THREE.BoxGeometry(0.35, 0.05, 0.08), 0x8a2a2a, [0, 1.18, 0]),
    ]));

    this.geometries.set(PropKind.Willow, merge([
      part(new THREE.CylinderGeometry(0.15, 0.23, 1.2, 6), 0x5a4632, [0, 0.6, 0]),
      part(new THREE.IcosahedronGeometry(1.05, 1), 0x6a9a3c, [0, 1.45, 0], [1, 0.55, 1]),
      part(new THREE.IcosahedronGeometry(0.65, 1), 0x5f8c36, [0, 1.0, 0], [1.05, 0.9, 1.05]),
    ]));
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const g of this.glows.values()) g.dispose();
    this.material.dispose();
  }
}

type WindowSpec = [[number, number, number], [number, number, number]];
const HOUSE_WINDOWS: WindowSpec[] = [
  [[0.08, 0.42, 0.42], [1.22, 1.15, 0.75]],
  [[0.08, 0.42, 0.42], [1.22, 1.15, -0.75]],
  [[0.42, 0.42, 0.08], [0, 1.15, 1.22]],
  [[0.42, 0.42, 0.08], [-0.4, 1.15, -1.22]],
];
const CHURCH_WINDOWS: WindowSpec[] = [
  [[0.08, 0.9, 0.3], [1.32, 1.8, 0.6]],
  [[0.08, 0.9, 0.3], [1.32, 1.8, -0.6]],
  [[0.3, 0.9, 0.08], [0.4, 1.5, 1.12]],
  [[0.3, 0.9, 0.08], [-0.4, 1.5, 1.12]],
  [[0.3, 0.9, 0.08], [0.4, 1.5, -1.12]],
  [[0.3, 0.9, 0.08], [-0.4, 1.5, -1.12]],
];

interface HouseStyle { wall: number; roof: number; trim: number; roofType: 'gable' | 'flat' | 'steep' }

/** Small cottage on a 3x3 footprint; door faces +x. */
function house(st: HouseStyle): THREE.BufferGeometry {
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
function church(st: HouseStyle): THREE.BufferGeometry {
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
function prism(w: number, h: number, d: number, hex: number, pos: [number, number, number]): THREE.BufferGeometry {
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

function part(
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

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('prop merge failed');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return g;
}
