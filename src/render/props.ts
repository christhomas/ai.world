import * as THREE from 'three';
import { PropKind } from '../world/biomes';
import { CHURCH_WINDOWS, HOUSE_WINDOWS, church, house, merge, part, prism, type HouseStyle } from './geometry';

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

    // dungeon furniture: torch hangs from the wall top and reaches into the room (+x)
    this.geometries.set(PropKind.Torch, merge([
      part(new THREE.BoxGeometry(0.12, 0.5, 0.12), 0x4a3a2a, [0.5, -1.35, 0]),
      part(new THREE.BoxGeometry(0.5, 0.08, 0.08), 0x4a3a2a, [0.3, -1.1, 0]),
      part(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 5), 0x6b4a2b, [0.62, -0.95, 0]),
    ]));
    this.glows.set(PropKind.Torch, merge([
      part(new THREE.IcosahedronGeometry(0.16, 0), 0xffffff, [0.62, -0.62, 0], [0.8, 1.4, 0.8]),
    ]));
    this.geometries.set(PropKind.Chest, merge([
      part(new THREE.BoxGeometry(0.8, 0.45, 0.6), 0x7a4a24, [0, 0.225, 0]),
      part(new THREE.BoxGeometry(0.84, 0.2, 0.64), 0x8a5a2e, [0, 0.55, 0]),
      part(new THREE.BoxGeometry(0.86, 0.06, 0.66), 0xc9a24a, [0, 0.46, 0]),
      part(new THREE.BoxGeometry(0.12, 0.14, 0.06), 0xc9a24a, [0, 0.5, 0.33]),
    ]));
    this.geometries.set(PropKind.ChestOpen, merge([
      part(new THREE.BoxGeometry(0.8, 0.45, 0.6), 0x7a4a24, [0, 0.225, 0]),
      part(new THREE.BoxGeometry(0.84, 0.2, 0.64), 0x8a5a2e, [0, 0.72, -0.42], [1, 1, 1], [-1.6, 0, 0]),
      part(new THREE.BoxGeometry(0.7, 0.1, 0.5), 0xf1c40f, [0, 0.45, 0]),
      part(new THREE.IcosahedronGeometry(0.1, 0), 0xffe066, [0.1, 0.55, 0.05]),
    ]));
    this.geometries.set(PropKind.Stairs, merge([
      part(new THREE.BoxGeometry(1.2, 1.2, 1.2), 0x2a2a34, [0, 0.6, -0.7]),
      part(new THREE.BoxGeometry(1.0, 0.25, 0.4), 0x8f8f8f, [0, 0.125, 0.4]),
      part(new THREE.BoxGeometry(1.0, 0.5, 0.4), 0x8f8f8f, [0, 0.25, 0.0]),
      part(new THREE.BoxGeometry(1.0, 0.75, 0.4), 0x8f8f8f, [0, 0.375, -0.4]),
      part(new THREE.BoxGeometry(0.1, 1.4, 0.1), 0x4a3a2a, [-0.65, 0.7, 0.2]),
      part(new THREE.BoxGeometry(0.1, 1.4, 0.1), 0x4a3a2a, [0.65, 0.7, 0.2]),
    ]));

    // --- interior furniture ---
    this.geometries.set(PropKind.Bed, merge([
      part(new THREE.BoxGeometry(0.9, 0.3, 1.9), 0x6b4a2b, [0, 0.25, 0]),
      part(new THREE.BoxGeometry(0.94, 0.22, 1.5), 0xe8e0cc, [0, 0.5, 0.15]),
      part(new THREE.BoxGeometry(0.9, 0.14, 0.45), 0xc0392b, [0, 0.6, 0.5]),
      part(new THREE.BoxGeometry(0.7, 0.16, 0.3), 0xf4f0e6, [0, 0.6, -0.65]),
      part(new THREE.BoxGeometry(0.94, 0.7, 0.12), 0x5a3f28, [0, 0.5, -0.95]),
    ]));
    this.geometries.set(PropKind.Table, merge([
      part(new THREE.BoxGeometry(1.3, 0.12, 1.0), 0x8a6a3d, [0, 0.7, 0]),
      ...[[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]].map(([x, z]) =>
        part(new THREE.BoxGeometry(0.12, 0.7, 0.12), 0x6b4a2b, [x, 0.35, z])),
    ]));
    this.geometries.set(PropKind.Chair, merge([
      part(new THREE.BoxGeometry(0.5, 0.1, 0.5), 0x8a6a3d, [0, 0.45, 0]),
      part(new THREE.BoxGeometry(0.12, 0.7, 0.5), 0x6b4a2b, [-0.2, 0.7, 0]),
      ...[[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].map(([x, z]) =>
        part(new THREE.BoxGeometry(0.08, 0.45, 0.08), 0x6b4a2b, [x, 0.22, z])),
    ]));
    this.geometries.set(PropKind.Hearth, merge([
      part(new THREE.BoxGeometry(1.5, 1.4, 0.7), 0x8a8a8a, [0, 0.7, -0.15]),
      part(new THREE.BoxGeometry(0.9, 0.8, 0.5), 0x2a2118, [0, 0.4, 0.16]),
      part(new THREE.ConeGeometry(0.24, 0.5, 5), 0xff7a1a, [0, 0.35, 0.2]),
      part(new THREE.ConeGeometry(0.14, 0.35, 5), 0xffd23a, [0.06, 0.4, 0.24]),
      part(new THREE.BoxGeometry(1.7, 0.16, 0.85), 0x9a9a9a, [0, 1.45, -0.15]),
    ]));
    this.glows.set(PropKind.Hearth, merge([
      part(new THREE.IcosahedronGeometry(0.22, 0), 0xffffff, [0, 0.4, 0.22], [1, 1.3, 1]),
    ]));
    this.geometries.set(PropKind.Shelf, merge([
      part(new THREE.BoxGeometry(0.9, 0.08, 0.35), 0x8a6a3d, [0, 0.5, 0]),
      part(new THREE.BoxGeometry(0.9, 0.08, 0.35), 0x8a6a3d, [0, 1.0, 0]),
      part(new THREE.BoxGeometry(0.9, 0.08, 0.35), 0x8a6a3d, [0, 1.5, 0]),
      part(new THREE.BoxGeometry(0.1, 1.6, 0.35), 0x6b4a2b, [-0.44, 0.8, 0]),
      part(new THREE.BoxGeometry(0.1, 1.6, 0.35), 0x6b4a2b, [0.44, 0.8, 0]),
      part(new THREE.BoxGeometry(0.16, 0.24, 0.16), 0x6fae4b, [-0.25, 0.66, 0]),
      part(new THREE.BoxGeometry(0.16, 0.24, 0.16), 0xd23f3f, [0.05, 1.16, 0]),
      part(new THREE.BoxGeometry(0.16, 0.2, 0.16), 0xf5c542, [0.28, 1.62, 0]),
    ]));
    this.geometries.set(PropKind.Barrel, merge([
      part(new THREE.CylinderGeometry(0.34, 0.3, 0.8, 8), 0x8a6a3d, [0, 0.4, 0]),
      part(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 8), 0x5a4632, [0, 0.6, 0]),
      part(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 8), 0x5a4632, [0, 0.2, 0]),
      part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), 0x6b4a2b, [0, 0.83, 0]),
    ]));
    this.geometries.set(PropKind.Crate, merge([
      part(new THREE.BoxGeometry(0.7, 0.7, 0.7), 0x9a7a4d, [0, 0.35, 0]),
      part(new THREE.BoxGeometry(0.74, 0.08, 0.08), 0x6b4a2b, [0, 0.55, 0.34]),
      part(new THREE.BoxGeometry(0.74, 0.08, 0.08), 0x6b4a2b, [0, 0.15, 0.34]),
    ]));
    this.geometries.set(PropKind.Forge, merge([
      part(new THREE.BoxGeometry(1.4, 1.0, 1.0), 0x6e6e6e, [0, 0.5, 0]),
      part(new THREE.BoxGeometry(0.9, 0.5, 0.7), 0x2a2118, [0, 0.75, 0.2]),
      part(new THREE.ConeGeometry(0.3, 0.6, 5), 0xff5a1a, [0, 0.9, 0.2]),
      part(new THREE.CylinderGeometry(0.24, 0.3, 1.6, 6), 0x555555, [0, 1.8, -0.2]),
    ]));
    this.glows.set(PropKind.Forge, merge([
      part(new THREE.IcosahedronGeometry(0.26, 0), 0xffffff, [0, 0.95, 0.2], [1, 1.2, 1]),
    ]));
    this.geometries.set(PropKind.Anvil, merge([
      part(new THREE.BoxGeometry(0.5, 0.4, 0.5), 0x5a3f28, [0, 0.2, 0]),
      part(new THREE.BoxGeometry(0.75, 0.22, 0.34), 0x4a4a52, [0, 0.5, 0]),
      part(new THREE.BoxGeometry(0.3, 0.16, 0.3), 0x4a4a52, [0, 0.34, 0]),
      part(new THREE.ConeGeometry(0.14, 0.36, 4), 0x4a4a52, [0.45, 0.5, 0], [1, 1, 1], [0, 0, -Math.PI / 2]),
    ]));
    this.geometries.set(PropKind.WeaponRack, merge([
      part(new THREE.BoxGeometry(0.16, 1.6, 0.16), 0x6b4a2b, [-0.5, 0.8, 0]),
      part(new THREE.BoxGeometry(0.16, 1.6, 0.16), 0x6b4a2b, [0.5, 0.8, 0]),
      part(new THREE.BoxGeometry(1.2, 0.12, 0.16), 0x6b4a2b, [0, 1.5, 0]),
      part(new THREE.BoxGeometry(0.1, 1.0, 0.1), 0xb8b8c0, [-0.28, 0.9, 0.06]),
      part(new THREE.BoxGeometry(0.28, 0.1, 0.1), 0x8a6a3d, [-0.28, 1.3, 0.06]),
      part(new THREE.BoxGeometry(0.1, 1.1, 0.1), 0xb8b8c0, [0.1, 0.95, 0.06]),
      part(new THREE.BoxGeometry(0.5, 0.5, 0.08), 0x8a6a3d, [0.38, 0.9, 0.06]),
    ]));
    this.geometries.set(PropKind.Cauldron, merge([
      part(new THREE.CylinderGeometry(0.42, 0.32, 0.5, 8), 0x3a3a42, [0, 0.45, 0]),
      part(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 8), 0x6fae4b, [0, 0.68, 0]),
      ...[0, 2.1, 4.2].map((a) => part(new THREE.BoxGeometry(0.08, 0.3, 0.08), 0x3a3a42, [Math.cos(a) * 0.3, 0.15, Math.sin(a) * 0.3])),
      part(new THREE.ConeGeometry(0.2, 0.3, 5), 0xff7a1a, [0, 0.15, 0]),
    ]));
    this.glows.set(PropKind.Cauldron, merge([
      part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), 0xffffff, [0, 0.7, 0]),
    ]));
    this.geometries.set(PropKind.Altar, merge([
      part(new THREE.BoxGeometry(1.6, 0.9, 0.8), 0xd8d2c0, [0, 0.45, 0]),
      part(new THREE.BoxGeometry(1.8, 0.14, 0.94), 0xefe9d8, [0, 0.95, 0]),
      part(new THREE.BoxGeometry(0.12, 0.7, 0.12), 0xf1c40f, [0, 1.35, 0]),
      part(new THREE.BoxGeometry(0.5, 0.12, 0.12), 0xf1c40f, [0, 1.45, 0]),
    ]));
    this.geometries.set(PropKind.Pew, merge([
      part(new THREE.BoxGeometry(1.8, 0.14, 0.4), 0x8a6a3d, [0, 0.45, 0]),
      part(new THREE.BoxGeometry(1.8, 0.6, 0.12), 0x6b4a2b, [0, 0.7, -0.2]),
      part(new THREE.BoxGeometry(0.14, 0.45, 0.4), 0x6b4a2b, [-0.8, 0.22, 0]),
      part(new THREE.BoxGeometry(0.14, 0.45, 0.4), 0x6b4a2b, [0.8, 0.22, 0]),
    ]));
    this.geometries.set(PropKind.Candle, merge([
      part(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 6), 0xb8a878, [0, 0.45, 0]),
      part(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6), 0xf4efdc, [0, 1.05, 0]),
    ]));
    this.glows.set(PropKind.Candle, merge([
      part(new THREE.IcosahedronGeometry(0.1, 0), 0xffffff, [0, 1.28, 0], [0.7, 1.4, 0.7]),
    ]));
    this.geometries.set(PropKind.Rug, merge([
      part(new THREE.BoxGeometry(1.9, 0.04, 1.2), 0x8a3a3a, [0, 0.02, 0]),
      part(new THREE.BoxGeometry(1.6, 0.05, 0.9), 0xc0603a, [0, 0.03, 0]),
    ]));

    this.geometries.set(PropKind.CaveMouth, merge([
      part(new THREE.DodecahedronGeometry(1.5, 0), 0x6e6e6e, [-0.5, 0.7, 0], [1, 1.1, 1.3]),
      part(new THREE.DodecahedronGeometry(1.1, 0), 0x7a7a7a, [0.1, 0.5, 1.3], [1, 1, 1]),
      part(new THREE.DodecahedronGeometry(1.1, 0), 0x7a7a7a, [0.1, 0.5, -1.3], [1, 1, 1]),
      part(new THREE.BoxGeometry(0.9, 1.5, 1.5), 0x0a0a10, [0.85, 0.75, 0]),
      part(new THREE.IcosahedronGeometry(0.35, 0), 0x8a8a8a, [1.3, 0.2, 1.0]),
      part(new THREE.IcosahedronGeometry(0.28, 0), 0x8a8a8a, [1.4, 0.16, -0.8]),
    ]));
    this.geometries.set(PropKind.Shipwreck, merge([
      part(new THREE.BoxGeometry(4.2, 0.9, 1.8), 0x5a3f28, [0, 0.45, 0], [1, 1, 1], [0.18, 0, 0.12]),
      part(new THREE.BoxGeometry(1.4, 1.1, 1.5), 0x6b4a2b, [-1.8, 0.7, 0], [1, 1, 1], [0, 0, 0.3]),
      part(new THREE.BoxGeometry(0.16, 0.9, 1.7), 0x4a3222, [1.6, 0.9, 0]),
      part(new THREE.BoxGeometry(0.14, 0.8, 1.6), 0x4a3222, [0.4, 1.0, 0], [1, 1, 1], [0, 0, -0.2]),
      part(new THREE.CylinderGeometry(0.12, 0.16, 3.4, 6), 0x5a3f28, [-0.4, 1.6, 0], [1, 1, 1], [0, 0, 0.7]),
      part(new THREE.BoxGeometry(0.06, 1.2, 1.1), 0xd8d0bc, [-1.4, 1.9, 0], [1, 1, 1], [0, 0, 0.7]),
      part(new THREE.IcosahedronGeometry(0.3, 0), 0x8a8a8a, [2.2, 0.15, 0.7]),
    ]));

    // three stages of growth, shown on any planted square
    this.geometries.set(PropKind.Seedling, merge([
      part(new THREE.BoxGeometry(0.9, 0.06, 0.9), 0x6b4a2b, [0, 0.03, 0]),
      part(new THREE.ConeGeometry(0.05, 0.16, 4), 0x7fc04a, [-0.2, 0.1, -0.2]),
      part(new THREE.ConeGeometry(0.05, 0.16, 4), 0x7fc04a, [0.2, 0.1, 0.15]),
      part(new THREE.ConeGeometry(0.05, 0.16, 4), 0x7fc04a, [0.05, 0.1, -0.05]),
    ]));
    this.geometries.set(PropKind.CropYoung, merge([
      part(new THREE.BoxGeometry(0.9, 0.06, 0.9), 0x6b4a2b, [0, 0.03, 0]),
      ...[[-0.22, -0.2], [0.22, 0.16], [0.02, -0.04], [-0.18, 0.22]].map(([x, z]) =>
        part(new THREE.ConeGeometry(0.09, 0.4, 5), 0x66b23f, [x, 0.22, z])),
    ]));
    this.geometries.set(PropKind.CropRipe, merge([
      part(new THREE.BoxGeometry(0.9, 0.06, 0.9), 0x6b4a2b, [0, 0.03, 0]),
      ...[[-0.22, -0.2], [0.22, 0.16], [0.02, -0.04], [-0.18, 0.22]].map(([x, z]) =>
        part(new THREE.ConeGeometry(0.12, 0.7, 5), 0xd8b73a, [x, 0.38, z])),
      part(new THREE.IcosahedronGeometry(0.13, 0), 0xe8c94a, [0.02, 0.74, -0.04]),
    ]));

    this.geometries.set(PropKind.NoticeBoard, merge([
      part(new THREE.BoxGeometry(0.12, 1.3, 0.12), 0x6b4a2b, [0, 0.65, -0.6]),
      part(new THREE.BoxGeometry(0.12, 1.3, 0.12), 0x6b4a2b, [0, 0.65, 0.6]),
      part(new THREE.BoxGeometry(0.1, 1.0, 1.5), 0x8a6a3d, [0, 1.35, 0]),
      part(new THREE.BoxGeometry(0.13, 1.1, 1.6), 0x5a4632, [-0.02, 1.35, 0]),
      part(new THREE.BoxGeometry(0.06, 0.3, 0.24), 0xf4efdc, [0.07, 1.55, -0.35]),
      part(new THREE.BoxGeometry(0.06, 0.26, 0.2), 0xe8e0cc, [0.07, 1.2, 0.1]),
      part(new THREE.BoxGeometry(0.06, 0.22, 0.26), 0xf4efdc, [0.07, 1.5, 0.42]),
      prism(1.8, 0.35, 0.6, 0xa5502f, [0, 1.9, 0]),
    ]));

    this.geometries.set(PropKind.Signpost, merge([
      part(new THREE.CylinderGeometry(0.09, 0.11, 2.0, 6), 0x6b4a2b, [0, 1.0, 0]),
      part(new THREE.BoxGeometry(0.9, 0.22, 0.06), 0xd9b57c, [0.35, 1.72, 0], [1, 1, 1], [0, 0, 0.04]),
      part(new THREE.BoxGeometry(0.8, 0.2, 0.06), 0xcfa96f, [-0.3, 1.42, 0], [1, 1, 1], [0, Math.PI, -0.04]),
      part(new THREE.BoxGeometry(0.7, 0.18, 0.06), 0xd9b57c, [0.1, 1.12, 0], [1, 1, 1], [0, Math.PI / 2, 0.03]),
      part(new THREE.IcosahedronGeometry(0.12, 0), 0x8a6a3d, [0, 2.05, 0]),
    ]));

    // a hole in the floor with steps going down: the way deeper in
    this.geometries.set(PropKind.Descent, merge([
      part(new THREE.BoxGeometry(1.5, 0.16, 1.5), 0x4a4a52, [0, 0.08, 0]),
      part(new THREE.BoxGeometry(1.1, 0.5, 1.1), 0x07070c, [0, -0.2, 0]),
      part(new THREE.BoxGeometry(1.0, 0.1, 0.3), 0x8f8f8f, [0, -0.02, 0.4]),
      part(new THREE.BoxGeometry(1.0, 0.1, 0.3), 0x7f7f7f, [0, -0.16, 0.1]),
      part(new THREE.BoxGeometry(1.0, 0.1, 0.3), 0x6f6f6f, [0, -0.3, -0.2]),
      part(new THREE.BoxGeometry(0.12, 0.9, 0.12), 0x5a4632, [-0.65, 0.5, 0.6]),
      part(new THREE.BoxGeometry(0.12, 0.9, 0.12), 0x5a4632, [0.65, 0.5, 0.6]),
    ]));

    this.geometries.set(PropKind.Door, merge([
      part(new THREE.BoxGeometry(0.2, 2.2, 0.2), 0x5a4632, [0, 1.1, 0.6]),
      part(new THREE.BoxGeometry(0.2, 2.2, 0.2), 0x5a4632, [0, 1.1, -0.6]),
      part(new THREE.BoxGeometry(0.24, 0.2, 1.4), 0x5a4632, [0, 2.1, 0]),
      part(new THREE.BoxGeometry(0.14, 1.9, 1.0), 0x6b4a2b, [0, 0.95, 0]),
      part(new THREE.BoxGeometry(0.18, 0.12, 1.0), 0x9a8a6a, [0, 1.5, 0]),
      part(new THREE.BoxGeometry(0.18, 0.12, 1.0), 0x9a8a6a, [0, 0.6, 0]),
      part(new THREE.IcosahedronGeometry(0.12, 0), 0xf1c40f, [0.1, 1.05, 0]),
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
