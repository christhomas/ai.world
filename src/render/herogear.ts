import * as THREE from 'three';
import { SLOTS, type EquipSlot, type Item } from '../game/items';
import type { GameState } from '../game/state';
import type { Entity } from '../entities/entity';
import { bodyMotion } from '../entities/motion';
import { merge, part } from './geometry';

/**
 * What the hero is wearing, drawn on the hero. The rig itself lives in the shared instanced pool,
 * so gear is a small group of ordinary meshes that follows the hero and swings with their arms.
 * A worn helm hides the hero's own hat; a worn body piece recolours nothing, it sits over the tunic.
 */

type Build = () => THREE.BufferGeometry;

/** Where each slot hangs relative to the hero's feet, and whether it swings with an arm. */
interface Mount { offset: [number, number, number]; swing?: 'armL' | 'armR' }

const MOUNTS: Record<EquipSlot, Mount> = {
  head: { offset: [0, 1.5, 0] },
  body: { offset: [0, 0.95, 0] },
  hand: { offset: [0.06, 0.86, -0.3], swing: 'armR' },
  offhand: { offset: [0.06, 0.9, 0.3], swing: 'armL' },
  feet: { offset: [0, 0.05, 0] },
  trinket: { offset: [-0.02, 0.72, 0.2] },
};

const blade = (length: number, colour: number, guard: number): Build => () => merge([
  part(new THREE.BoxGeometry(0.07, length, 0.14), colour, [0, length / 2 - 0.1, 0]),
  part(new THREE.BoxGeometry(0.1, 0.08, 0.34), guard, [0, -0.06, 0]),
  part(new THREE.BoxGeometry(0.08, 0.26, 0.09), 0x5a3f28, [0, -0.22, 0]),
]);

const shield = (colour: number, boss: number): Build => () => merge([
  part(new THREE.BoxGeometry(0.09, 0.62, 0.46), colour, [0, 0.1, 0]),
  part(new THREE.BoxGeometry(0.05, 0.16, 0.46), boss, [0.05, 0.1, 0]),
  part(new THREE.IcosahedronGeometry(0.09, 0), boss, [0.06, 0.1, 0]),
]);

/** One shape per item that is worth seeing on the body. Items without an entry simply do not show. */
const GEAR: Record<string, Build> = {
  cap: () => merge([part(new THREE.BoxGeometry(0.36, 0.16, 0.36), 0x8a6a3d, [0, 0.06, 0]), part(new THREE.BoxGeometry(0.2, 0.05, 0.16), 0x6b4a2b, [0.22, 0.02, 0])]),
  helm: () => merge([
    part(new THREE.BoxGeometry(0.38, 0.24, 0.38), 0x9aa2ac, [0, 0.08, 0]),
    part(new THREE.BoxGeometry(0.4, 0.06, 0.4), 0x7a828c, [0, -0.05, 0]),
    part(new THREE.BoxGeometry(0.06, 0.2, 0.12), 0x7a828c, [0.19, 0.06, 0]),
  ]),
  tunic: () => merge([part(new THREE.BoxGeometry(0.26, 0.42, 0.38), 0xb8894a, [0, 0, 0])]),
  jerkin: () => merge([
    part(new THREE.BoxGeometry(0.27, 0.44, 0.39), 0x6b4a2b, [0, 0, 0]),
    part(new THREE.BoxGeometry(0.29, 0.07, 0.41), 0x4a3222, [0, -0.16, 0]),
  ]),
  mail: () => merge([
    part(new THREE.BoxGeometry(0.28, 0.46, 0.4), 0x8f97a2, [0, 0, 0]),
    part(new THREE.BoxGeometry(0.3, 0.05, 0.42), 0x6f7782, [0, 0.1, 0]),
    part(new THREE.BoxGeometry(0.3, 0.05, 0.42), 0x6f7782, [0, -0.06, 0]),
  ]),
  stick: () => merge([part(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 5), 0x6b4a2b, [0, 0.25, 0])]),
  sword: blade(0.7, 0xc8ccd4, 0xb8a04a),
  steelsword: blade(0.85, 0xe2e8f0, 0xc8b45a),
  axe: () => merge([
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 5), 0x5a3f28, [0, 0.28, 0]),
    part(new THREE.BoxGeometry(0.1, 0.3, 0.34), 0xb8c0cc, [0.02, 0.62, 0.1]),
    part(new THREE.BoxGeometry(0.08, 0.16, 0.14), 0x9aa2ac, [0.02, 0.56, -0.06]),
  ]),
  shield: shield(0x8a6a3d, 0x9aa2ac),
  ironshield: shield(0x9aa2ac, 0xd8dce4),
  lantern: () => merge([
    part(new THREE.BoxGeometry(0.16, 0.2, 0.16), 0x6b5a3d, [0, 0, 0]),
    part(new THREE.BoxGeometry(0.12, 0.14, 0.12), 0xffd27a, [0, 0, 0]),
    part(new THREE.BoxGeometry(0.05, 0.12, 0.05), 0x5a4632, [0, 0.16, 0]),
  ]),
  rod: () => merge([
    part(new THREE.CylinderGeometry(0.02, 0.03, 1.1, 5), 0xb8945a, [0, 0.4, 0], [1, 1, 1], [0, 0, -0.5]),
    part(new THREE.BoxGeometry(0.06, 0.08, 0.06), 0x5a4632, [0.1, 0.02, 0]),
  ]),
  boots: () => merge([
    part(new THREE.BoxGeometry(0.18, 0.14, 0.26), 0x5a3f28, [0, 0, 0.1]),
    part(new THREE.BoxGeometry(0.18, 0.14, 0.26), 0x5a3f28, [0, 0, -0.1]),
  ]),
  greaves: () => merge([
    part(new THREE.BoxGeometry(0.2, 0.3, 0.28), 0x9aa2ac, [0, 0.1, 0.1]),
    part(new THREE.BoxGeometry(0.2, 0.3, 0.28), 0x9aa2ac, [0, 0.1, -0.1]),
  ]),
  charm: () => merge([part(new THREE.IcosahedronGeometry(0.1, 0), 0x6fae4b, [0, 0, 0])]),
  map: () => merge([part(new THREE.BoxGeometry(0.06, 0.18, 0.24), 0xe8dcc0, [0, 0, 0])]),
  rope: () => merge([part(new THREE.TorusGeometry(0.12, 0.04, 4, 8), 0xb8945a, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0])]),
};

/** Items whose presence hides part of the hero's own rig. */
const HIDES: Record<string, string> = { cap: 'hat', helm: 'hat' };

export class HeroGear {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly worn = new Map<EquipSlot, { mesh: THREE.Mesh; id: string; mount: Mount }>();
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private shownVersion = -1;

  constructor(scene: THREE.Object3D) {
    scene.add(this.group);
  }

  /** Move the gear onto a different scene, following the hero indoors or underground. */
  attachTo(scene: THREE.Object3D): void {
    scene.add(this.group);
  }

  private geometryFor(item: Item): THREE.BufferGeometry | null {
    const build = GEAR[item.id];
    if (!build) return null;
    let geometry = this.cache.get(item.id);
    if (!geometry) { geometry = build(); this.cache.set(item.id, geometry); }
    return geometry;
  }

  /** Rebuild when the equipment changed, then follow the hero every frame. */
  update(state: GameState, hero: Entity): void {
    if (state.version !== this.shownVersion) {
      this.shownVersion = state.version;
      this.rebuild(state, hero);
    }
    const swing = Math.sin(hero.phase) * 0.6 * hero.walk;
    const scale = hero.kind.scale;
    for (const [slot, worn] of this.worn) {
      const [ox, oy, oz] = worn.mount.offset;
      // the arm swing is a rotation about the shoulder, so held things travel with the hand
      let x = ox, y = oy, z = oz;
      if (worn.mount.swing) {
        const angle = worn.mount.swing === 'armR' ? swing * 0.8 : -swing * 0.8;
        const shoulderY = 1.14;
        const dy = oy - shoulderY;
        y = shoulderY + dy * Math.cos(angle);
        x = ox - dy * Math.sin(angle);
      }
      const cos = Math.cos(hero.yaw), sin = Math.sin(hero.yaw);
      worn.mesh.position.set(
        hero.x + (x * cos + z * sin) * scale,
        hero.y + hero.bobY + (y + bodyMotion(hero).bob) * scale,
        hero.z + (-x * sin + z * cos) * scale,
      );
      worn.mesh.rotation.y = hero.yaw;
      worn.mesh.scale.setScalar(scale);
      void slot;
    }
  }

  private rebuild(state: GameState, hero: Entity): void {
    hero.hiddenTags.clear();
    for (const [, worn] of this.worn) this.group.remove(worn.mesh);
    this.worn.clear();
    for (const slot of SLOTS) {
      const item = state.worn(slot);
      if (!item) continue;
      const hide = HIDES[item.id];
      if (hide) hero.hiddenTags.add(hide);
      const geometry = this.geometryFor(item);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.worn.set(slot, { mesh, id: item.id, mount: MOUNTS[slot] });
    }
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.material.dispose();
  }
}
