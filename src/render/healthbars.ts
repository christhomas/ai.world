import * as THREE from 'three';
import type { AnimalKind, PartDef } from '../entities/animals';
import type { Entity } from '../entities/entity';

/**
 * What a creature has left, shown over its head while it is being hit.
 *
 * The game had no way of telling you that a blow landed. A wolf flashes white for a third of a
 * second and there the news ended: whether it was nearly finished or barely scratched, whether the
 * last swing did anything at all, whether it was worth standing your ground — none of it was
 * visible, so a fight was a guess with an animation on top. A bar that drains answers all of that
 * with one glance and no interface at all.
 *
 * Only while it is being fought. A field of forty sheep with a bar over every one is a spreadsheet
 * rather than a country, so a bar appears when something is hurt and goes away again when it has
 * been left alone — see `BAR_TIME` in `properties/behaviour.json`. That also keeps this cheap in the case that matters: the
 * usual number on screen is nought, and the meshes are hidden entirely rather than drawn empty.
 *
 * Two instanced meshes and no text. The back is the whole bar, the fill is what is left of it, and
 * both are unlit quads turned to face the camera — which is handed in rather than found, because a
 * dungeon and an interior have no rig to have written a view on their scene and their creatures
 * bleed the same as anybody's.
 */

/** How the bar is drawn and for how long. Rig units, so it sits over a bear as it does over a hare. */
export const BAR = {
  /**
   * How wide and how tall, as a share of the height of the picture.
   *
   * Of the screen rather than of the world, which is the one decision in here worth arguing about.
   * A bar an eighth of a tile tall is a bar you cannot read: measured on a village at the zoom the
   * game is usually played at, it came out twenty pixels by two, which reads as a stray dark line
   * over somebody's head rather than as a number going down. And a bar that is a size in the world
   * is a different size on the screen every time the camera moves, so the one you tuned close up is
   * a scratch when you pull back to look at a field.
   *
   * It is interface, not scenery: the thing it is telling you is the same whatever the zoom, so it
   * is the same size whatever the zoom. The camera is orthographic, so that is one multiplication —
   * the frustum is a known number of world units tall and the screen is a known number of pixels,
   * and a share of the one is a fixed share of the other.
   *
   * Five per cent by eight tenths of one, which is about forty pixels by six on an eight-hundred
   * pixel picture: legible at a glance, and not a placard over a sheep.
   */
  WIDE: 0.05,
  TALL: 0.008,
  /** How far above the top of the head it floats, in world units, so it is not worn as a hat. */
  ABOVE: 0.22,
  /** How much bigger the back is than the fill, as a share of the picture: the outline. */
  EDGE: 0.0035,
} as const;

/** How far in front of its own back the fill sits, in world units. Enough to settle the argument. */
const TOWARD = 0.01;

/** The most bars that can be on screen at once. Past this the fight is not the thing to look at. */
const AT_ONCE = 96;

const BACK = new THREE.Color(0x101418);
/** Full, and empty. Green through amber to red says how bad it is without a number. */
const HALE = new THREE.Color(0x63d94d);
const SPENT = new THREE.Color(0xe0362b);

/** How tall a part reaches above the root, in rig units. */
function partTop(p: PartDef): number {
  const half = p.shape === 'ico' ? p.size[0] : p.size[1] / 2;
  return p.offset[1] + half;
}

/**
 * How high a creature's head is, in rig units, worked out from the parts it is drawn as.
 *
 * Measured rather than listed, for the reason `footprints.ts` gives about its own table: a second
 * place the truth is written is a place it can drift, and a creature added to the bestiary without
 * a row in it would wear its bar through its skull with nothing failing.
 */
export function heightOf(kind: AnimalKind): number {
  let top = 0;
  for (const p of kind.parts) top = Math.max(top, partTop(p));
  return top;
}

export class HealthBars {
  private readonly back: THREE.InstancedMesh;
  private readonly fill: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly nudge = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private facing = new THREE.Quaternion();
  private count = 0;
  /**
   * How many world units the picture is tall this frame, which is what turns a share of the screen
   * into a size to draw. One for a camera that is not orthographic, which nothing in this game uses
   * and which would want a distance-dependent answer rather than a frame-wide one.
   */
  private span = 1;

  constructor(scene: THREE.Scene) {
    this.back = this.mesh(scene, BACK, false, 2);
    // white, because what is written per instance *multiplies* the material's own colour: a green
    // material under a half-spent olive instance comes out very nearly black, which is how the
    // first bar in the game managed to be two colours of dark
    this.fill = this.mesh(scene, new THREE.Color(0xffffff), true, 3);
  }

  private mesh(scene: THREE.Scene, colour: THREE.Color, coloured: boolean, order: number): THREE.InstancedMesh {
    const geo = new THREE.PlaneGeometry(1, 1);
    // unlit, so a bar reads the same at midnight as at noon, and no shadow either way
    /*
     * Unlit, and not in the depth argument at all.
     *
     * Unlit so a bar reads the same at midnight as at noon, and casts nothing. `depthTest` off
     * because it is interface rather than scenery: the first version of this obeyed the depth
     * buffer like everything else, and a wolf fought beside a market stall had two thirds of its
     * bar cut away by the stall's roof — the fill still perfectly correct, and unreadable. What it
     * is saying is about the fight and not about where the fight is standing, so it is drawn over
     * the top of the world the way the hearts are.
     */
    const mat = new THREE.MeshBasicMaterial({
      color: colour, depthWrite: false, depthTest: false, toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, AT_ONCE);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // the instances written are the ones in shot, and the mesh itself never moves
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    /*
     * Over the creature rather than through it, and the back before the fill.
     *
     * Both are drawn after everything else, which keeps a bar out of the depth argument with
     * whatever the head it belongs to happens to be in front of. Between the two of them the order
     * has to be *said*: they are a hair apart and write no depth, so which one covers the other
     * would otherwise be decided by three's own front-to-back sort — and the back, being the
     * further of the two, is exactly the one that wins it. Which is how a bar with a perfectly
     * correct fill in it came out plain black.
     */
    mesh.renderOrder = order;
    // said out loud, because a scene full of instanced meshes is otherwise a scene where a bar
    // reads as a creature part to anything counting draws — `render/perf.test.ts` does exactly that
    mesh.userData.bar = true;
    if (coloured) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(AT_ONCE * 3), 3);
    scene.add(mesh);
    return mesh;
  }

  /** A new frame: nothing written yet, and this is the way the camera is looking. */
  begin(camera: THREE.Camera): void {
    this.count = 0;
    this.facing = camera.quaternion;
    const ortho = camera as THREE.OrthographicCamera;
    this.span = ortho.isOrthographicCamera ? Math.abs(ortho.top - ortho.bottom) : 1;
  }

  /**
   * One creature's bar, if it has earned one.
   *
   * `s` is the creature's own scale, so the bar clears the top of the animal it belongs to rather
   * than the top of the rig it was drawn from.
   */
  add(e: Entity, top: number, s: number): void {
    // the hero has hearts, a HUD and a death screen: a bar over his own head as well would be
    // saying the same thing twice, in the one place he is already looking
    if (e.bar <= 0 || e.dead || e.kind.id === 'hero') return;
    if (this.count >= AT_ONCE) return;
    const most = e.kind.hp ?? 1;
    const left = Math.max(0, Math.min(1, e.hp / most));
    const at = this.count++;

    const wide = BAR.WIDE * this.span, tall = BAR.TALL * this.span, edge = BAR.EDGE * this.span;
    const y = e.y + e.bobY + top * s + BAR.ABOVE;
    this.pos.set(e.x, y, e.z);
    this.scl.set(wide + edge * 2, tall + edge * 2, 1);
    this.m.compose(this.pos, this.facing, this.scl);
    this.back.setMatrixAt(at, this.m);

    // the fill drains from the right, which means it is narrower *and* sits further left by half of
    // what it lost — in the camera's own sideways, not the world's, or a bar would slide off its
    // own back as the view turned
    // a hair toward the camera as well as sideways: the two quads are otherwise coplanar, and which
    // of two coplanar things is in front is a question the depth buffer answers differently every
    // frame
    this.nudge.set(-(1 - left) * wide / 2, 0, TOWARD).applyQuaternion(this.facing);
    this.pos.set(e.x + this.nudge.x, y + this.nudge.y, e.z + this.nudge.z);
    this.scl.set(Math.max(1e-4, wide * left), tall, 1);
    this.m.compose(this.pos, this.facing, this.scl);
    this.fill.setMatrixAt(at, this.m);
    this.fill.setColorAt(at, this.colour.copy(SPENT).lerp(HALE, left));
  }

  /** The frame is written: post what there is, and hide the meshes when there is nothing. */
  done(): void {
    for (const mesh of [this.back, this.fill]) {
      mesh.count = this.count;
      mesh.visible = this.count > 0;
      if (this.count === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, this.count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** How many are up, which is what a test asks and what the debug line can say. */
  get showing(): number { return this.count; }

  dispose(): void {
    for (const mesh of [this.back, this.fill]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
  }
}
