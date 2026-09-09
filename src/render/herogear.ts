import * as THREE from 'three';
import { ITEMS, SLOTS, type EquipSlot, type Item } from '../game/items';
import type { GameState } from '../game/state';
import type { Entity } from '../entities/entity';
import { bodyMotion } from '../entities/motion';
import { merge, part } from './geometry';
import { dressed, isDressing } from './worn';

/**
 * What the hero is carrying, drawn in his hands. The rig itself lives in the shared instanced pool,
 * so this is a small group of ordinary meshes that follows the hero and swings with his arms.
 *
 * What he is *wearing* is not here, and used not to be true: armour was a set of boxes hung over
 * the body, cut a hundredth of a unit proud of whatever they covered so the two surfaces would not
 * fight over the same pixels. A man in a costume rather than a man in armour. Worn pieces now
 * repaint the hero's own parts — `worn.ts` — and what is left here is what genuinely is a thing
 * held: a sword, a shield, a lantern, a torch, and the skirt of a garment, which is the one part of
 * clothing that has to move on its own.
 */

type Build = () => THREE.BufferGeometry;

/** Where each slot hangs relative to the hero's feet, and whether it swings with an arm. */
interface Mount { offset: [number, number, number]; swing?: 'armL' | 'armR' }

/*
 * Where each slot hangs, and the two that matter are the hands.
 *
 * They used to be at y 0.86 and z 0.3 — but the hand is a block centred at 0.72, a tenth of a unit
 * across, reaching out to 0.31. So a sword, a lantern and the hero's own walking stick were all
 * gripped a seventh of a unit above the fist and a little beyond its outer face: not held,
 * hovering alongside. On the turnaround sheet the stick stands beside him like a fence post with
 * nobody's hand on it, which is exactly what it was.
 *
 * They are in the hand now. The head mount moved up with the head, which rose when the villagers
 * were given a neck.
 */
const MOUNTS: Record<EquipSlot, Mount> = {
  head: { offset: [0, 1.54, 0] },
  body: { offset: [0, 0.89, 0] },
  hand: { offset: [0.06, 0.68, -0.25], swing: 'armR' },
  offhand: { offset: [0.06, 0.68, 0.25], swing: 'armL' },
  feet: { offset: [0, 0.05, 0] },
  trinket: { offset: [-0.02, 0.66, 0.2] },
};

const blade = (length: number, colour: number, guard: number): Build => () => merge([
  part(new THREE.BoxGeometry(0.07, length, 0.14), colour, [0, length / 2 - 0.1, 0]),
  part(new THREE.BoxGeometry(0.1, 0.08, 0.34), guard, [0, -0.06, 0]),
  part(new THREE.BoxGeometry(0.08, 0.26, 0.09), 0x5a3f28, [0, -0.22, 0]),
]);

/**
 * A shield a man is carrying, rather than a door he is standing behind.
 *
 * It was 0.62 tall by 0.46 across, hung a tenth of a unit above the fist. Written out in the
 * hero's own measurements that is a board from his hip to his collarbone and as wide as his
 * shoulder beam — and because it hangs a quarter of a unit nearer the camera than he does,
 * perspective pushes its top edge up over his chin. On the turnaround sheet the front view of the
 * hero in iron is a shield with a face peering over it. It was cut when the camera sat further
 * back, where a plank that size was a readable silhouette rather than the whole man.
 *
 * Roughly three quarters as tall and three quarters as wide, which is half the area, and lowered
 * so it rides on the forearm rather than reaching for the shoulder: it now covers him from the
 * belt to the middle of the chest. Smaller than this and the boss is the only part still legible
 * from sixty feet up, which is a shield that has turned into a dinner plate; larger and the face
 * goes again, since the face is the thing the extra height takes first.
 */
const shield = (colour: number, boss: number): Build => () => merge([
  part(new THREE.BoxGeometry(0.08, 0.44, 0.34), colour, [0, 0.08, 0]),
  part(new THREE.BoxGeometry(0.05, 0.12, 0.34), boss, [0.045, 0.08, 0]),
  part(new THREE.IcosahedronGeometry(0.07, 0), boss, [0.05, 0.08, 0]),
]);

/** One shape per item that is worth seeing on the body. Items without an entry simply do not show. */
const GEAR: Record<string, Build> = {
  // gripped a third of the way up, the way a walking stick is, so the foot of it reaches the ground
  stick: () => merge([part(new THREE.CylinderGeometry(0.045, 0.055, 0.86, 5), 0x6b4a2b, [0, 0.16, 0])]),
  sword: blade(0.7, 0xc8ccd4, 0xb8a04a),
  steelsword: blade(0.85, 0xe2e8f0, 0xc8b45a),
  axe: () => merge([
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 5), 0x5a3f28, [0, 0.28, 0]),
    part(new THREE.BoxGeometry(0.1, 0.3, 0.34), 0xb8c0cc, [0.02, 0.62, 0.1]),
    part(new THREE.BoxGeometry(0.08, 0.16, 0.14), 0x9aa2ac, [0.02, 0.56, -0.06]),
  ]),
  /**
   * A pickaxe, which has been an item in this game for a long time and has never been drawn.
   *
   * `pick` sits in `items.ts` with a price and the `hew` ability, and nothing anywhere had a shape
   * for it — so a hero carrying one carried nothing you could see, and the miners the villages send
   * underground every day were going to need one in their hands.
   *
   * A head that is a point at one end and a flat at the other, which is the whole silhouette of a
   * pick and is what tells it from the war axe two entries up: an axe is a wedge with its mass out
   * to one side, a pick is a bar through a haft. Read from above at this camera's distance that
   * difference is the only one there is, so the head is longer than an axe's and thinner.
   */
  pick: () => merge([
    part(new THREE.CylinderGeometry(0.042, 0.05, 0.82, 5), 0x6b4a2b, [0, 0.24, 0]),
    // the bar, lying across the haft, with the two ends doing different jobs
    part(new THREE.BoxGeometry(0.07, 0.07, 0.52), 0x9aa2ac, [0.01, 0.6, 0]),
    // the point, tapering: this is the end that goes into the rock
    part(new THREE.ConeGeometry(0.05, 0.16, 4), 0xb8c0cc, [0.01, 0.6, 0.32], [1, 1, 1], [Math.PI / 2, 0, 0]),
    // and the flat, for prising what the point has loosened
    part(new THREE.BoxGeometry(0.06, 0.11, 0.1), 0xb8c0cc, [0.01, 0.6, -0.31]),
    // the collar where the head is wedged on, which is what stops it reading as a stick with a bar
    part(new THREE.BoxGeometry(0.075, 0.09, 0.12), 0x5a4632, [0, 0.6, 0]),
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
  charm: () => merge([part(new THREE.IcosahedronGeometry(0.1, 0), 0x6fae4b, [0, 0, 0])]),
  map: () => merge([part(new THREE.BoxGeometry(0.06, 0.18, 0.24), 0xe8dcc0, [0, 0, 0])]),
  rope: () => merge([part(new THREE.TorusGeometry(0.12, 0.04, 4, 8), 0xb8945a, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0])]),
  /**
   * A torch, cut and bound rather than bought: a cane shaft, two ties of cord, and a bowl of pitch
   * at the top with the fire in it. Held in the off hand after dark, which is where the light of
   * the world at night now comes from.
   */
  torch: () => merge([
    part(new THREE.CylinderGeometry(0.035, 0.045, 0.78, 6), 0xa8834e, [0, 0.2, 0]),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.045, 6), 0x5e4a2e, [0, 0.34, 0]),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.045, 6), 0x5e4a2e, [0, 0.10, 0]),
    part(new THREE.CylinderGeometry(0.11, 0.06, 0.14, 6), 0x4a3a24, [0, 0.63, 0]),
  ]),
};

/**
 * The flame, which is not lit by anything and must not be.
 *
 * Everything else the hero carries is a Lambert surface that takes its brightness from the sun and
 * from the torch itself. A flame drawn that way is a dull orange cone in the middle of the light it
 * is supposedly casting, which reads as a mistake — so this one is drawn flat at full colour, the
 * way the window glows already are.
 */
const FLAME: Build = () => merge([
  part(new THREE.ConeGeometry(0.085, 0.26, 6), 0xffb43c, [0, 0.13, 0]),
  part(new THREE.ConeGeometry(0.045, 0.15, 6), 0xfff0a8, [0, 0.10, 0]),
]);

/**
 * How the torch is carried: out to the side of the off hand, and leaned away from the body.
 *
 * Held straight up it puts the fire directly over the hero's hat, which from this camera is the
 * picture the torch was meant to replace — a light apparently coming out of his head. Leaning it
 * out and holding it wide sets the flame beside him instead, where you can see it is a thing he is
 * carrying.
 */
const TORCH = {
  /**
   * Where the fist is, in hero units.
   *
   * The same place a shield hangs, and for the same reason: that is where the rig's hand actually
   * is. Held further out it was a torch floating beside a man with his arms at his sides — which
   * is what "he does not appear to be holding it" means.
   */
  HAND: [0.06, 0.71, 0.25] as [number, number, number],
  /** How far the shaft leans away from the body, in radians. It is the lean that clears the hat. */
  LEAN: 0.6,
  /** And how far up the shaft the fire sits. */
  REACH: 0.66,
};

/** The off hand with a torch in it — the fire is fixed to the shaft rather than hung separately. */
const TORCH_HAND: Mount = { offset: TORCH.HAND, swing: 'armL' };

/**
 * The skirt of a garment, which is the part of it that moves.
 *
 * A tunic drawn as one box is a sandwich board: it is the same shape standing still and at a dead
 * run, and a figure whose clothes never move reads as a figure carved out of one piece. The chest
 * of it does stay still — it is pulled in at a belt — so what is wanted is the hem below the belt
 * hung on its own hinge, trailing behind as he walks and swaying with his stride.
 *
 * Only the body slot has one. A boot does not flutter.
 */
const HEMS: Record<string, Build> = {
  tunic: () => merge([
    part(new THREE.BoxGeometry(0.3, 0.2, 0.38), 0xb8894a, [0, -0.1, 0]),
    part(new THREE.BoxGeometry(0.31, 0.035, 0.39), 0x8a6438, [0, -0.195, 0]),   // a darker edge
  ]),
  jerkin: () => merge([part(new THREE.BoxGeometry(0.31, 0.18, 0.39), 0x6b4a2b, [0, -0.09, 0])]),
  mail: () => merge([
    part(new THREE.BoxGeometry(0.32, 0.16, 0.4), 0x8f97a2, [0, -0.08, 0]),
    part(new THREE.BoxGeometry(0.33, 0.035, 0.41), 0x6f7782, [0, -0.155, 0]),
  ]),
  /**
   * Plate has a fauld rather than a skirt, and the difference is its length.
   *
   * Everything else here is cloth or ring hung off a belt, and it is as long as it wants to be
   * because it drapes. A fauld is a stack of steel lames over the hip that stops well above the
   * knee — it has to, or the man in it cannot sit on a horse. Given mail's length on the same hinge
   * it swings like a bell, which is the one thing a plate skirt must never look like, so this one
   * is half the drop and it hangs a fraction wider, the way a lame overlaps the one above it.
   */
  plate: () => merge([
    part(new THREE.BoxGeometry(0.34, 0.09, 0.42), 0x9aa2ac, [0, -0.045, 0]),
    part(new THREE.BoxGeometry(0.35, 0.03, 0.43), 0x7b838e, [0, -0.105, 0]),
  ]),
};

/**
 * How a hem behaves, in radians and in hero units.
 *
 * Skirt physics would be a rope of springs and a great deal of book-keeping for a thing seen from
 * sixty feet up. Two rotations do the whole job: it trails behind by how fast he is going, and it
 * sways side to side on the same phase his legs swing on, so the cloth and the stride agree. A
 * standing hero's hem is still, because a hem that waves while its owner stands about is a flag.
 */
const HEM = {
  /** Where it is hinged: the belt, in hero units. */
  WAIST: 0.68,
  /** How far it trails behind at a full walk. */
  TRAIL: 0.42,
  /** And how far it swings either way, on the legs' own phase. */
  SWAY: 0.16,
  /** A breath of movement while standing, so the cloth is cloth rather than board. */
  IDLE: 0.022,
} as const;

/**
 * Items whose presence hides part of the hero's own rig.
 *
 * The hat is the hero's own, and a helm is not worn over one. What a helm *is* is the head painted
 * in iron, which `worn.ts` does — so all that is needed here is to take the green cap off first.
 */
const HIDES: Record<string, string> = { cap: 'hat', helm: 'hat' };

/** How high the shoulder the arms swing from is, in hero units. */
const SHOULDER = 1.14;

/** Scratch for `held`, which runs once per worn thing per frame. */
const HERE = new THREE.Vector3();

export class HeroGear {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  /** The flame is not lit by the world; it is one of the things lighting it. */
  private readonly flameMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly worn = new Map<EquipSlot, { mesh: THREE.Mesh; id: string; mount: Mount }>();
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private shownVersion = -1;
  /** The hero these colours were put on, so a new one is dressed rather than left as he was born. */
  private dressed: Entity | null = null;
  /** The tool in his hand this moment, which is not something the save knows about. */
  private inHand: string | null = null;
  /** The skirt of whatever is worn on the body, hung on its own hinge at the waist. */
  private hem: THREE.Mesh | null = null;
  /** The torch and its flame, made once and shown only after dark. */
  private torch: THREE.Mesh | null = null;
  private flame: THREE.Mesh | null = null;
  /** Where the fire is this frame, for whatever wants to put a light there. */
  private readonly fire = new THREE.Vector3();
  private carrying = false;

  constructor(scene: THREE.Object3D) {
    scene.add(this.group);
  }

  /**
   * Where the light the hero is carrying actually is.
   *
   * The torch when one is out, and the lantern when one is held instead — both hang from the off
   * hand, so both swing with the walk and neither is anywhere near the head, which is where the
   * night light used to come from for want of anywhere better. Null when the hero is carrying
   * nothing, so a caller can tell "no light" from "a light at the origin".
   */
  lightSource(): THREE.Vector3 | null {
    if (this.carrying) return this.fire;
    const lantern = this.worn.get('offhand');
    return lantern?.id === 'lantern' ? this.fire.copy(lantern.mesh.position) : null;
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

  /**
   * Rebuild when the equipment changed, then follow the hero every frame.
   *
   * `carry` asks for the torch to be out — after dark, and not while a lantern is already doing
   * the job. It is drawn in the off hand and it takes that hand: nobody holds a shield and a torch
   * in the same fist, and hiding the shield for the night is a smaller lie than growing a third
   * arm.
   */
  /**
   * @param holding a tool in the hand *right now*, by item id, or null for an empty one.
   *
   * Tools are not equipment and deliberately so — `items.ts` says outright that there are too many
   * of them to give each a slot, and a shovel is not a thing you wear. But that left the whole of
   * the working half of this game undrawn: a pickaxe has had a price and an ability since long
   * before tonight and there was no way for one to be in anybody's hand, so a hero hewing rock and
   * a hero standing still were the same picture.
   *
   * So what is *worn* comes out of the save, and what is *held* is passed in for the moment it is
   * being used. Both end up on the same mount, because a hand is a hand.
   */
  update(state: GameState, hero: Entity, carry = false, holding: string | null = null): void {
    // the hero himself as well as his kit: he is a new entity after a death or a long journey, and
    // a new entity is painted in the colours he was born in until somebody dresses him again
    if (state.version !== this.shownVersion || hero !== this.dressed || holding !== this.inHand) {
      this.shownVersion = state.version;
      this.dressed = hero;
      this.inHand = holding;
      this.rebuild(state, hero);
    }
    this.carrying = carry;
    if (carry && !this.torch) {
      const build = GEAR.torch;
      this.torch = new THREE.Mesh(build(), this.material);
      this.torch.castShadow = true;
      this.flame = new THREE.Mesh(FLAME(), this.flameMaterial);
      this.group.add(this.torch, this.flame);
    }
    if (this.torch && this.flame) { this.torch.visible = carry; this.flame.visible = carry; }
    const offhand = this.worn.get('offhand');
    if (offhand) offhand.mesh.visible = !carry;
    const swing = Math.sin(hero.phase) * 0.6 * hero.walk;
    const scale = hero.kind.scale;
    for (const [slot, worn] of this.worn) {
      worn.mesh.position.copy(this.held(hero, worn.mount, swing, scale));
      worn.mesh.rotation.y = hero.yaw;
      worn.mesh.scale.setScalar(scale);
      void slot;
    }
    /*
     * The hem, hung at the waist and trailing.
     *
     * Two rotations in the hero's own frame: about local z, which tips it forward and back, and
     * about local x, which swings it side to side. Applied after the yaw, in the same `YXZ` order
     * the torch uses, so a hem trails behind the man rather than behind north.
     *
     * The sway runs on `hero.phase`, which is what the legs swing on — half the rate, because a
     * skirt answers a whole stride rather than each step, and cloth that changed direction on every
     * footfall would flap rather than swing.
     */
    if (this.hem) {
      this.hem.position.set(hero.x, hero.y + hero.bobY + HEM.WAIST * scale, hero.z);
      const trail = -HEM.TRAIL * hero.walk;
      const sway = Math.sin(hero.phase * 0.5) * (HEM.SWAY * hero.walk + HEM.IDLE);
      this.hem.rotation.set(sway, hero.yaw, trail, 'YXZ');
      this.hem.scale.setScalar(scale);
    }

    if (carry && this.torch && this.flame) {
      // the same arm the off-hand gear hangs from, so the torch swings with the walk like the rest
      const hand = this.torch.position.copy(this.held(hero, TORCH_HAND, swing, scale));
      // yaw first and then the lean, so the shaft tips out to the hero's side whichever way he
      // happens to be facing rather than always towards the same corner of the world
      this.torch.rotation.set(TORCH.LEAN, hero.yaw, 0, 'YXZ');
      this.torch.scale.setScalar(scale);
      /*
       * The fire is fixed to the end of the shaft, and has to be worked out from where the shaft
       * ended up rather than hung off a mount of its own.
       *
       * It used to be its own mount, a little higher up. The arm swing is a rotation about the
       * shoulder, so a mount's travel depends on how far it is from the shoulder — and the hand is
       * below the shoulder while the flame is above it. The two therefore swung in opposite
       * directions, and the fire came away from the torch on every step. A flame is not a thing
       * that hangs off a hero; it is a thing on the end of a stick he is holding.
       */
      const up = Math.cos(TORCH.LEAN) * TORCH.REACH * scale;
      const out = Math.sin(TORCH.LEAN) * TORCH.REACH * scale;
      const cos = Math.cos(hero.yaw), sin = Math.sin(hero.yaw);
      this.flame.position.set(hand.x + out * sin, hand.y + up, hand.z + out * cos);
      this.flame.rotation.y = hero.yaw;
      // the fire breathes: a fifteenth either way, which is a flicker rather than a pulse
      this.flame.scale.setScalar(scale * (1 + Math.sin(hero.phase * 5.3) * 0.07));
      this.fire.copy(this.flame.position);
    }
  }

  /**
   * Where a thing hanging from a mount ends up in the world this frame.
   *
   * The arm swing is a rotation about the shoulder, so a held thing travels on an arc with the
   * hand rather than sliding up and down in front of the body. Returns a scratch vector: copy it
   * before calling again.
   */
  private held(hero: Entity, mount: Mount, swing: number, scale: number): THREE.Vector3 {
    const [ox, oy, oz] = mount.offset;
    let x = ox, y = oy;
    if (mount.swing) {
      const angle = mount.swing === 'armR' ? swing * 0.8 : -swing * 0.8;
      const dy = oy - SHOULDER;
      y = SHOULDER + dy * Math.cos(angle);
      x = ox - dy * Math.sin(angle);
    }
    const cos = Math.cos(hero.yaw), sin = Math.sin(hero.yaw);
    return HERE.set(
      hero.x + (x * cos + oz * sin) * scale,
      hero.y + hero.bobY + (y + bodyMotion(hero).bob) * scale,
      hero.z + (-x * sin + oz * cos) * scale,
    );
  }

  private rebuild(state: GameState, hero: Entity): void {
    hero.hiddenTags.clear();
    // what he is wearing, which is what he is made of rather than something drawn over him
    hero.tints = dressed(hero.basePalette, (slot) => state.worn(slot));
    for (const [, worn] of this.worn) this.group.remove(worn.mesh);
    this.worn.clear();
    if (this.hem) { this.group.remove(this.hem); this.hem = null; }
    // the skirt of whatever is on the body, if that garment has one
    const body = state.worn('body');
    const cut = body ? HEMS[body.id] : undefined;
    if (cut) {
      let geometry = this.cache.get(`hem:${body!.id}`);
      if (!geometry) { geometry = cut(); this.cache.set(`hem:${body!.id}`, geometry); }
      this.hem = new THREE.Mesh(geometry, this.material);
      this.hem.castShadow = true;
      this.group.add(this.hem);
    }
    /*
     * The tool in hand, before the worn gear, because it takes the hand.
     *
     * Nobody swings a pick with a sword still in the same fist. A held tool displaces whatever the
     * save says is worn there for as long as it is held, which is the same bargain the torch
     * already strikes with the off hand after dark.
     */
    if (this.inHand) {
      const tool = ITEMS[this.inHand];
      const geometry = tool ? this.geometryFor(tool) : null;
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.worn.set('hand', { mesh, id: tool.id, mount: MOUNTS.hand });
      }
    }

    for (const slot of SLOTS) {
      if (slot === 'hand' && this.inHand) continue;    // the tool has it
      const item = state.worn(slot);
      if (!item) continue;
      const hide = HIDES[item.id];
      if (hide) hero.hiddenTags.add(hide);
      if (isDressing(item)) continue;               // he is wearing it; he is not carrying it
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
