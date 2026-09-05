import * as THREE from 'three';
import { worldView } from '../render/scene';
import type { AnimRole, AnimalKind, PartDef } from './animals';
import type { Entity } from './entity';
import { bodyLean, bodyMotion, cycleTurn, limbTurn, strikeAt } from './motion';

/**
 * Draws every creature through per-part InstancedMesh pools: one pool per (kind, part).
 * A field of forty sheep is ~8 draw calls. Animation is done by rewriting instance matrices.
 *
 * Only what the camera can see is written, packed at the front of each buffer. A part with
 * nobody in shot has a count of zero, which three.js skips without issuing a draw at all, so the
 * twenty-odd kinds alive around a player cost draws only for the few actually on screen. The
 * scene says where the camera is looking; a scene nobody has told (an interior, a dungeon) draws
 * the lot, as it always did.
 */

const CAPACITY = 320;
const SHADOW_VOLUME = 0.012;
const HURT_COLOR = new THREE.Color(0xffffff);

/**
 * Euler angles for an animated part: the walk cycle, with whatever blow is being thrown laid over
 * the top of it, so somebody who swings while running does both rather than snapping out of their
 * stride to hit something. Both come from animations/motion.json.
 */
function partRotation(role: AnimRole | undefined, e: Entity): [number, number, number] {
  const cycle = cycleTurn(role, e);
  const at = strikeAt(e.blow, e.strike);
  if (at === 0) return cycle;
  const thrown = limbTurn(role, e.blow, at, e.offhandBlow);
  return thrown === null ? cycle : [cycle[0], cycle[1], cycle[2] + thrown];
}

function partVolume(p: PartDef): number {
  switch (p.shape) {
    case 'box': return p.size[0] * p.size[1] * p.size[2];
    case 'cyl': return Math.PI * p.size[0] * p.size[0] * p.size[1];
    case 'cone': return Math.PI * p.size[2] * p.size[2] * p.size[1] / 3;
    case 'ico': return (4 / 3) * Math.PI * p.size[0] ** 3;
  }
}

interface PartRuntime {
  def: PartDef;
  mesh: THREE.InstancedMesh;
  pivot: THREE.Vector3;
  fromPivot: THREE.Vector3;   // offset - pivot
  staticRot: THREE.Matrix4 | null;
  /** Instances written this frame; the mesh draws exactly this many. */
  count: number;
  /**
   * Buffer slot to the creature in it. A slot changes hands as creatures come in and out of
   * shot, and `entities` order is fixed (behaviours read a creature's slot for its place in a
   * herd), so this is what picking reads and what says when a colour has gone stale.
   */
  drawn: Array<Entity | undefined>;
  /** Whether the creature in each slot was drawn hurt, so a flash that ends is noticed. */
  hot: Uint8Array;
  /** Set when any colour in this part changed, so the buffer is only uploaded when it must be. */
  recoloured: boolean;
}

class KindPool {
  readonly parts: PartRuntime[] = [];
  readonly entities: Entity[] = [];
  colorsDirty = false;

  constructor(readonly kind: AnimalKind, scene: THREE.Scene) {
    for (const def of kind.parts) {
      const geo = makeGeometry(def);
      const mat = new THREE.MeshLambertMaterial({ color: def.tint === undefined ? def.color : 0xffffff });
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.count = 0;
      // only chunky parts cast shadows; legs, ears and beaks are not worth a shadow-pass draw call
      mesh.castShadow = partVolume(def) >= SHADOW_VOLUME;
      mesh.receiveShadow = true;
      // the instances written are the ones in shot, so there is nothing left for three to cull
      mesh.frustumCulled = false;
      // a pool sits at the origin and stays there; only the instances inside it ever move
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      const pivot = def.pivot ? new THREE.Vector3(...def.pivot) : new THREE.Vector3(...def.offset);
      const fromPivot = new THREE.Vector3(...def.offset).sub(pivot);
      const staticRot = def.rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...def.rot)) : null;
      const part: PartRuntime = {
        def, mesh, pivot, fromPivot, staticRot,
        count: 0, drawn: [], hot: new Uint8Array(CAPACITY), recoloured: false,
      };
      mesh.userData.pool = this;
      mesh.userData.part = part;
      this.parts.push(part);
    }
  }
}

function makeGeometry(p: PartDef): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (p.shape) {
    case 'box': g = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]); break;
    case 'cyl': g = new THREE.CylinderGeometry(p.size[0], p.size[2], p.size[1], 6); break;
    case 'cone': g = new THREE.ConeGeometry(p.size[2], p.size[1], 6); break;
    case 'ico': g = new THREE.IcosahedronGeometry(p.size[0], 0); break;
  }
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  flat.computeVertexNormals();
  flat.deleteAttribute('uv');
  return flat;
}

export class EntityRenderer {
  private readonly pools = new Map<string, KindPool>();
  private readonly root = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();
  private readonly r = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** The axis a body pitches about, which is the one the legs already swing on. */
  private readonly side = new THREE.Vector3(0, 0, 1);
  private readonly facing = new THREE.Vector3(1, 0, 0);
  private readonly tilt = new THREE.Quaternion();

  constructor(private readonly scene: THREE.Scene) {}

  private pool(kind: AnimalKind): KindPool {
    let p = this.pools.get(kind.id);
    if (!p) { p = new KindPool(kind, this.scene); this.pools.set(kind.id, p); }
    return p;
  }

  add(e: Entity): boolean {
    const p = this.pool(e.kind);
    if (p.entities.length >= CAPACITY) { e.slot = -1; return false; }
    e.slot = p.entities.length;
    p.entities.push(e);
    p.colorsDirty = true;
    return true;
  }

  remove(e: Entity): void {
    if (e.slot < 0) return;
    const p = this.pool(e.kind);
    const i = e.slot;
    const last = p.entities.pop()!;
    if (last !== e) { p.entities[i] = last; last.slot = i; }
    e.slot = -1;
    p.colorsDirty = true;
  }

  /** The meshes a click can land on: the ones with anything drawn in them. */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of this.pools.values()) for (const part of p.parts) if (part.count > 0) out.push(part.mesh);
    return out;
  }

  /** Whoever owns the instance a ray hit, or null if the hit was on nothing living. */
  entityAt(hit: THREE.Intersection): Entity | null {
    const part = hit.object.userData.part as PartRuntime | undefined;
    if (!part || hit.instanceId === undefined || hit.instanceId >= part.count) return null;
    return part.drawn[hit.instanceId] ?? null;
  }

  get count(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.entities.length;
    return n;
  }

  /**
   * Rewrite the instance buffers from entity state. Call once per frame after entities moved.
   *
   * Creatures nobody can see are skipped before any of the matrix work, and the ones that are
   * left are packed into the front of each buffer, so both the maths and the draw are paid for
   * only what is on screen.
   */
  update(): void {
    const view = worldView(this.scene);
    const reach = view ? view.radius * view.radius : 0;
    for (const p of this.pools.values()) {
      const n = p.entities.length;
      // a creature's palette can change under a slot without the slot changing hands, so add and
      // remove ask for a full rewrite; every other reason to recolour is caught slot by slot
      const recolour = p.colorsDirty;
      p.colorsDirty = false;
      for (const part of p.parts) { part.count = 0; part.recoloured = recolour; }
      for (let i = 0; i < n; i++) {
        const e = p.entities[i];
        // indoors creatures used to be parked below the world; not drawing them is the same
        // sight for none of the work, and a ray cannot reach them either way
        if (e.indoors) continue;
        if (view) {
          const dx = e.x - view.x, dz = e.z - view.z;
          if (dx * dx + dz * dz > reach) continue;
        }
        const s = e.kind.scale;
        // how the whole body carries itself: the bob of a stride, the roll onto each foot, the
        // lean into a run. Rig units, so it scales with the animal like any part offset does.
        const body = bodyMotion(e);
        this.pos.set(e.x, e.y + e.bobY + body.bob * s, e.z);
        this.quat.setFromAxisAngle(this.up, e.yaw);
        // one blow moves the whole body rather than a limb: a bear that only waved a paw would
        // not read as a bear. It sits on top of the body's own lean, so somebody who swings
        // while running does both at once.
        const lean = body.lean + (e.strike > 0 ? bodyLean(e.blow, strikeAt(e.blow, e.strike)) : 0);
        if (lean !== 0) {
          this.tilt.setFromAxisAngle(this.side, lean);
          this.quat.multiply(this.tilt);
        }
        if (body.roll !== 0) {
          this.tilt.setFromAxisAngle(this.facing, body.roll);
          this.quat.multiply(this.tilt);
        }
        this.scl.set(s, s, s);
        this.root.compose(this.pos, this.quat, this.scl);
        for (const part of p.parts) {
          const d = part.def;
          // a hidden part simply takes no slot: the hero's own hat costs nothing under a helm
          if (d.tag && e.hiddenTags.has(d.tag)) continue;
          const [ax, ay, az] = partRotation(d.anim, e);
          this.m.copy(this.root);
          if (ax !== 0 || ay !== 0 || az !== 0) {
            this.t.makeTranslation(part.pivot.x, part.pivot.y, part.pivot.z);
            this.m.multiply(this.t);
            this.euler.set(ax, ay, az);
            this.r.makeRotationFromEuler(this.euler);
            this.m.multiply(this.r);
            this.t.makeTranslation(part.fromPivot.x, part.fromPivot.y, part.fromPivot.z);
            this.m.multiply(this.t);
          } else {
            this.t.makeTranslation(d.offset[0], d.offset[1], d.offset[2]);
            this.m.multiply(this.t);
          }
          if (part.staticRot) this.m.multiply(part.staticRot);
          const k = part.count++;
          part.mesh.setMatrixAt(k, this.m);
          if (d.tint === undefined) continue;
          const hot = e.hurt > 0 ? 1 : 0;
          if (part.drawn[k] !== e || part.hot[k] !== hot) {
            part.drawn[k] = e;
            part.hot[k] = hot;
            part.recoloured = true;
            this.writeColour(part, k, e);
          } else if (recolour) {
            this.writeColour(part, k, e);
          }
        }
      }
      for (const part of p.parts) {
        const mesh = part.mesh;
        mesh.count = part.count;
        // a count of zero draws nothing either way, but three finds that out only after walking
        // the mesh, sorting it into the render list and offering it to the shadow pass as well;
        // hidden, it is passed over at the one point where passing over it is free
        mesh.visible = part.count > 0;
        if (part.count === 0) continue;
        // only the slots in use are uploaded: a pool is sized for a crowd that is usually not
        // there, and posting the whole buffer every frame costs more than the maths that filled it
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, part.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (part.recoloured && mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, part.count * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  /** The colour one creature wears in one slot, washed towards white while it is smarting. */
  private writeColour(part: PartRuntime, index: number, e: Entity): void {
    const tint = part.def.tint as number;
    this.color.setHex(e.tints[Math.min(tint, e.tints.length - 1)]);
    if (e.hurt > 0) this.color.lerp(HURT_COLOR, 0.7);
    part.mesh.setColorAt(index, this.color);
  }

  dispose(): void {
    for (const p of this.pools.values()) {
      for (const part of p.parts) {
        this.scene.remove(part.mesh);
        part.mesh.geometry.dispose();
        (part.mesh.material as THREE.Material).dispose();
        part.mesh.dispose();
      }
    }
    this.pools.clear();
  }
}
