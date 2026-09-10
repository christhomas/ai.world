import * as THREE from 'three';

/**
 * What is lying in the grass, drawn as the thing it is.
 *
 * Everything a body left behind used to be the same object: a rolled bundle with a brown lump
 * beside it, whether it was a dead deer with its hide still on, a purse of gold, or a hunter's
 * pack. So the country was dotted with identical brown things and the only way to find out what any
 * of them was, was to walk over and press a key.
 *
 * That is the wrong way round for a game you play by looking. What is on the ground should say what
 * it is from across a field: a carcass reads as a carcass, coins read as coins, a folded hide reads
 * as a hide. The rule is one sentence — *what you see is what goes into the pack* — and it is worth
 * stating because the moment it is broken the world starts lying to the player about itself.
 *
 * Built as a small pool of each kind, moved to wherever the drops are. There are never many: a body
 * lasts a quarter of an hour and the far ones are not drawn at all.
 */

/** How many of each kind are drawn at once. Past this, the far ones simply are not shown. */
const POOL = 10;

/** What a drop is, as the eye needs it. */
export type DropKind = 'carcass' | 'hide' | 'gold' | 'pack';

export interface Drop {
  x: number;
  z: number;
  kind: DropKind;
  /** What it was, when that decides the colour: a fox's hide is not a bear's. */
  of?: string;
}

/** The colour of a hide, by what it came off. A pelt is the animal, lying flat. */
const FUR: Record<string, number> = {
  wolf: 0x7d7266, fox: 0xb4622c, bear: 0x4b3524, deer: 0x9a6b3f, boar: 0x554034,
  rabbit: 0xb9ab97, goat: 0xa89a86, sheep: 0xe4ded2, elk: 0x8a6238, whale: 0x3d4a5a,
};
const HIDE_DEFAULT = 0x8a6f52;

export class DropField {
  private readonly pools = new Map<DropKind, THREE.Group[]>();

  constructor(private readonly scene: THREE.Scene) {
    for (const kind of ['carcass', 'hide', 'gold', 'pack'] as DropKind[]) {
      const made: THREE.Group[] = [];
      for (let i = 0; i < POOL; i++) {
        const one = build(kind);
        one.visible = false;
        scene.add(one);
        made.push(one);
      }
      this.pools.set(kind, made);
    }
  }

  /** Put the drawn drops where the drops are, and hide the rest. */
  update(drops: readonly Drop[], heightAt: (x: number, z: number) => number | null): void {
    const used = new Map<DropKind, number>();
    for (const drop of drops) {
      const pool = this.pools.get(drop.kind);
      if (!pool) continue;
      const at = used.get(drop.kind) ?? 0;
      if (at >= POOL) continue;
      used.set(drop.kind, at + 1);
      const one = pool[at];
      one.visible = true;
      one.position.set(drop.x, heightAt(drop.x, drop.z) ?? 0, drop.z);
      // no two lie the same way, and the same one lies the same way every frame
      one.rotation.y = (drop.x * 7 + drop.z * 13) % Math.PI;
      if (drop.kind === 'hide' || drop.kind === 'carcass') paint(one, FUR[drop.of ?? ''] ?? HIDE_DEFAULT);
    }
    for (const [kind, pool] of this.pools) {
      for (let i = used.get(kind) ?? 0; i < POOL; i++) pool[i].visible = false;
    }
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      for (const one of pool) {
        this.scene.remove(one);
        one.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
      }
    }
  }
}

/** Recolour the parts of a drop that take the animal's own colour, leaving the rest alone. */
function paint(group: THREE.Group, hex: number): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.furred) (mesh.material as THREE.MeshLambertMaterial).color.setHex(hex);
  });
}

function furred(mesh: THREE.Mesh): THREE.Mesh {
  mesh.userData.furred = true;
  return mesh;
}

function build(kind: DropKind): THREE.Group {
  switch (kind) {
    case 'carcass': return buildCarcass();
    case 'hide': return buildHide();
    case 'gold': return buildGold();
    case 'pack': return buildPack();
  }
}

/**
 * A body on its side: a barrel of a ribcage, a head down in the grass, four legs out straight.
 *
 * Deliberately readable rather than accurate. It is seen from forty tiles up at a fixed angle and
 * what it has to say is "something died here and it still has its hide on", which is a long low
 * shape with legs sticking out of it. The colour comes from the animal.
 */
function buildCarcass(): THREE.Group {
  const group = new THREE.Group();
  const hide = new THREE.MeshLambertMaterial({ color: HIDE_DEFAULT, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a3a2c, flatShading: true });

  const body = furred(new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 2, 6), hide));
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.26;
  body.castShadow = true;
  group.add(body);

  const head = furred(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), hide));
  head.position.set(0.48, 0.17, 0.04);
  group.add(head);

  // four legs, out sideways the way a fallen animal's are
  for (const [lx, lz] of [[0.22, 0.2], [0.22, -0.2], [-0.2, 0.2], [-0.2, -0.2]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), dark);
    leg.position.set(lx, 0.1, lz * 1.4);
    leg.rotation.x = lz > 0 ? 0.5 : -0.5;
    group.add(leg);
  }
  return group;
}

/** A hide taken off and folded: flat, wider than it is thick, with the fur side up. */
function buildHide(): THREE.Group {
  const group = new THREE.Group();
  const pelt = new THREE.MeshLambertMaterial({ color: HIDE_DEFAULT, flatShading: true });
  const fold = furred(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.44), pelt));
  fold.position.y = 0.05;
  fold.castShadow = true;
  group.add(fold);
  const top = furred(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.34), pelt));
  top.position.set(0.02, 0.14, 0.01);
  top.rotation.y = 0.2;
  group.add(top);
  return group;
}

/** Coins: a spill of them, flat on the ground, in a colour nothing else in this world is. */
function buildGold(): THREE.Group {
  const group = new THREE.Group();
  const coin = new THREE.MeshLambertMaterial({ color: 0xf0c33c, flatShading: true });
  const shape = new THREE.CylinderGeometry(0.1, 0.1, 0.035, 8);
  const spill: Array<[number, number, number]> = [
    [0, 0.02, 0], [0.13, 0.02, 0.08], [-0.1, 0.02, 0.11], [0.05, 0.055, 0.03], [-0.06, 0.02, -0.1],
  ];
  for (const [x, y, z] of spill) {
    const one = new THREE.Mesh(shape, coin);
    one.position.set(x, y, z);
    one.rotation.set(0.1, x * 9, 0.06);
    one.castShadow = true;
    group.add(one);
  }
  return group;
}

/** A person's pack: a rolled bundle and a strap, which is what it always was. */
function buildPack(): THREE.Group {
  const group = new THREE.Group();
  const cloth = new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true });
  const strap = new THREE.MeshLambertMaterial({ color: 0x3f3126, flatShading: true });

  const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 2, 6), cloth);
  roll.rotation.z = Math.PI / 2;
  roll.position.y = 0.22;
  roll.castShadow = true;
  group.add(roll);

  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.045, 4, 8), strap);
  tie.rotation.y = Math.PI / 2;
  tie.position.y = 0.22;
  group.add(tie);
  return group;
}

/**
 * What is on the ground, as the eye needs it, from what the game is holding.
 *
 * A pure function so the rule can be checked without a renderer, and one place so the rule is said
 * once: a body with its hide still on is a carcass drawn in that animal's colour; a pack that is
 * nothing but coin is coin; a pack with a pelt in it is a hide; anything else is somebody's
 * belongings. What you see is what goes into the pack.
 */
export function dropsFor(
  bodies: readonly { x: number; z: number; kind: string }[],
  packs: readonly { x: number; z: number; gold: number; items: readonly string[] }[],
): Drop[] {
  const out: Drop[] = bodies.map((body) => ({ x: body.x, z: body.z, kind: 'carcass', of: body.kind }));
  for (const pack of packs) {
    const pelt = pack.items.some((id) => id === 'pelt' || id === 'fur' || id.endsWith('hide'));
    const kind: DropKind = pelt ? 'hide' : pack.items.length === 0 && pack.gold > 0 ? 'gold' : 'pack';
    out.push({ x: pack.x, z: pack.z, kind });
  }
  return out;
}
