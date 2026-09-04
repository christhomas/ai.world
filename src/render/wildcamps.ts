import * as THREE from 'three';

/**
 * Camps out in the country, drawn from a small pool the way the packs are.
 *
 * The whole of T28's story is told here without a word of text: a ridge tent, a ring of stones
 * round a cold fire, and a bundle beside it. A camp that did not survive the night has one side
 * of the canvas down and the ridgepole leaning, and once you have been through it the bundle is
 * gone. Somebody walking past should be able to work out what happened without pressing anything.
 */

/** Camps drawn at once. Beyond this the far ones are simply not shown. */
const POOL = 8;

/** What one camp needs to say for itself. */
export interface DrawnCamp {
  x: number;
  z: number;
  /** A camp its owner did not come back to. */
  ruined: boolean;
}

export class CampField {
  private readonly camps: THREE.Group[] = [];

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const camp = buildCamp();
      camp.visible = false;
      scene.add(camp);
      this.camps.push(camp);
    }
  }

  /**
   * Put the drawn camps where the camps are.
   *
   * @param emptied whether the player has already taken what this camp held
   */
  update<T extends DrawnCamp>(
    camps: readonly T[],
    emptied: (camp: T) => boolean,
    heightAt: (x: number, z: number) => number | null,
  ): void {
    let drawn = 0;
    for (const camp of camps) {
      if (drawn >= POOL) break;
      const group = this.camps[drawn++];
      group.visible = true;
      group.position.set(camp.x, heightAt(camp.x, camp.z) ?? 0, camp.z);
      group.rotation.y = (camp.x * 11 + camp.z * 5) % Math.PI;   // no two pitched the same way

      const [tent, pole, , bundle] = group.children;
      // a torn camp lies open: the canvas down one side and the pole gone over with it
      tent.rotation.z = camp.ruined ? 0.5 : 0;
      tent.position.y = camp.ruined ? 0.18 : 0.3;
      pole.rotation.z = camp.ruined ? 0.42 : 0;
      bundle.visible = !emptied(camp);
    }
    for (let i = drawn; i < POOL; i++) this.camps[i].visible = false;
  }

  dispose(): void {
    for (const camp of this.camps) {
      this.scene.remove(camp);
      camp.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
  }
}

/** A ridge tent, its pole, a cold fire ringed with stones, and a pack beside the door. */
function buildCamp(): THREE.Group {
  const group = new THREE.Group();
  const canvas = new THREE.MeshLambertMaterial({ color: 0xb8ac90, flatShading: true });
  const wood = new THREE.MeshLambertMaterial({ color: 0x5a4632, flatShading: true });
  const stone = new THREE.MeshLambertMaterial({ color: 0x77726b, flatShading: true });
  const ash = new THREE.MeshLambertMaterial({ color: 0x2e2a26, flatShading: true });
  const cloth = new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true });

  // the tent: a prism on its side, which at this scale is a ridge tent and nothing else
  const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.25, 3), canvas);
  tent.rotation.x = Math.PI / 2;
  tent.position.y = 0.3;
  tent.castShadow = true;
  group.add(tent);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 4), wood);
  pole.position.set(0, 0.47, -0.62);
  group.add(pole);

  // the fire, gone out: a ring of stones and a black middle
  const fire = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), stone);
    rock.position.set(Math.cos(angle) * 0.34, 0.06, Math.sin(angle) * 0.34);
    fire.add(rock);
  }
  const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 7), ash);
  embers.position.y = 0.02;
  fire.add(embers);
  fire.position.set(1.15, 0, 0.2);
  group.add(fire);

  const bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 2, 6), cloth);
  bundle.rotation.z = Math.PI / 2;
  bundle.position.set(0.5, 0.16, 0.72);
  bundle.castShadow = true;
  group.add(bundle);
  return group;
}
