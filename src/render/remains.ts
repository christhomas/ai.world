import * as THREE from 'three';

/**
 * The packs lying in the grass. A small pool of bundles moved to wherever somebody fell, the same
 * trick the whales use: there are never many, and only the near ones are worth drawing.
 */

/** Packs drawn at once. Beyond this the far ones are simply not shown. */
const POOL = 12;

export class PackField {
  private readonly bundles: THREE.Group[] = [];

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const bundle = buildPack();
      bundle.visible = false;
      scene.add(bundle);
      this.bundles.push(bundle);
    }
  }

  /** Put the drawn packs where the packs are, and hide the rest. */
  update(packs: readonly { x: number; z: number }[], heightAt: (x: number, z: number) => number | null): void {
    let drawn = 0;
    for (const pack of packs) {
      if (drawn >= POOL) break;
      const bundle = this.bundles[drawn++];
      bundle.visible = true;
      bundle.position.set(pack.x, heightAt(pack.x, pack.z) ?? 0, pack.z);
      bundle.rotation.y = (pack.x * 7 + pack.z * 13) % Math.PI;   // no two lie the same way
    }
    for (let i = drawn; i < POOL; i++) this.bundles[i].visible = false;
  }

  dispose(): void {
    for (const bundle of this.bundles) {
      this.scene.remove(bundle);
      bundle.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
  }
}

/** A bundle in the grass: a rolled pack, a strap, and something spilled beside it. */
function buildPack(): THREE.Group {
  const group = new THREE.Group();
  const cloth = new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true });
  const strap = new THREE.MeshLambertMaterial({ color: 0x3f3126, flatShading: true });
  const spill = new THREE.MeshLambertMaterial({ color: 0xb8a878, flatShading: true });

  const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 2, 6), cloth);
  roll.rotation.z = Math.PI / 2;
  roll.position.y = 0.22;
  roll.castShadow = true;
  group.add(roll);

  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.045, 4, 8), strap);
  tie.rotation.y = Math.PI / 2;
  tie.position.y = 0.22;
  group.add(tie);

  const dropped = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), spill);
  dropped.position.set(0.42, 0.12, 0.18);
  group.add(dropped);
  return group;
}
