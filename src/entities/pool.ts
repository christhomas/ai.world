import * as THREE from 'three';
import { worldView } from '../render/scene';
import type { AnimRole, AnimalKind, PartDef } from './animals';
import type { Entity } from './entity';
import { bodyLean, bodyMotion, cycleTurn, limbTurn, strikeAt } from './motion';

/**
 * Draws every creature through InstancedMesh pools: one pool per kind, and inside it one mesh for
 * every group of parts that can share a draw. A field of forty sheep is a handful of draw calls.
 * Animation is done by rewriting instance matrices.
 *
 * Only what the camera can see is written, packed at the front of each buffer. A mesh with nobody
 * in shot has a count of zero, which three.js skips without issuing a draw at all, so the
 * twenty-odd kinds alive around a player cost draws only for the few actually on screen. The
 * scene says where the camera is looking; a scene nobody has told (an interior, a dungeon) draws
 * the lot, as it always did.
 *
 * The grouping is the reason a creature is not one draw call per part. Four legs are four boxes
 * of the same size in the same colour standing in four places, and an instanced draw is exactly
 * the thing that puts one shape in many places — so they are one mesh with four instances per
 * animal rather than four meshes with one each. They still swing independently, because a leg's
 * swing lives in its own instance matrix and always did. Widening that from "the same box" to
 * "the same box stretched differently" collapses a body, a neck and a snout together as well,
 * which is what takes the bestiary from three hundred and twenty-eight meshes down to a hundred
 * and fifty.
 */

/** Creatures one pool will hold. Each of its meshes has room for this many of each part it draws. */
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

/** One part of one kind: where it sits on the body, and which mesh draws it. */
interface PartRuntime {
  def: PartDef;
  pivot: THREE.Vector3;
  fromPivot: THREE.Vector3;   // offset - pivot
  staticRot: THREE.Matrix4 | null;
  /**
   * How far the mesh's own shape has to be stretched to become this part, or null when the mesh
   * is already the right size. three.js divides an instance normal by the squared length of each
   * matrix column before transforming it, which is the exact inverse-transpose for the
   * translation-rotation-scale matrices this file writes, so a stretched instance is lit as the
   * shape it looks like rather than as the shape it was cut from.
   */
  scale: THREE.Vector3 | null;
  /** The mesh this part's instances go into, shared with every part built the same way. */
  into: PartMesh;
}

/** One draw call: every part of a kind that can share a shape, a colour and a shadow. */
interface PartMesh {
  mesh: THREE.InstancedMesh;
  /** Parts drawn through it, so the buffer holds this many instances for every creature. */
  parts: number;
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
  /**
   * Which palette colour each slot was painted from. A slot holds a leg one frame and an ear the
   * next once something ahead of it leaves the view, and two parts sharing a mesh may well be
   * painted from different entries of the same palette — without this, that ear keeps the leg's
   * colour for as long as the same animal stays in the slot.
   */
  paint: Int8Array;
  /** Set when any colour in this mesh changed, so the buffer is only uploaded when it must be. */
  recoloured: boolean;
}

class KindPool {
  readonly parts: PartRuntime[] = [];
  readonly meshes: PartMesh[] = [];
  readonly entities: Entity[] = [];
  colorsDirty = false;

  constructor(readonly kind: AnimalKind, scene: THREE.Scene) {
    const grouped = new Map<string, PartDef[]>();
    for (const def of kind.parts) {
      const key = meshKey(def);
      const list = grouped.get(key);
      if (list) list.push(def);
      else grouped.set(key, [def]);
    }
    const built = new Map<string, PartMesh>();
    for (const [key, defs] of grouped) {
      const first = defs[0];
      const geo = unitGeometry(first);
      const mat = new THREE.MeshLambertMaterial({ color: first.tint === undefined ? first.color : 0xffffff });
      const room = CAPACITY * defs.length;
      const mesh = new THREE.InstancedMesh(geo, mat, room);
      mesh.count = 0;
      // only chunky parts cast shadows; legs, ears and beaks are not worth a shadow-pass draw call
      mesh.castShadow = partVolume(first) >= SHADOW_VOLUME;
      mesh.receiveShadow = true;
      // the instances written are the ones in shot, so there is nothing left for three to cull
      mesh.frustumCulled = false;
      // a pool sits at the origin and stays there; only the instances inside it ever move
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      const part: PartMesh = {
        mesh, parts: defs.length, count: 0,
        drawn: [], hot: new Uint8Array(room), paint: new Int8Array(room).fill(-1), recoloured: false,
      };
      mesh.userData.pool = this;
      mesh.userData.part = part;
      built.set(key, part);
      this.meshes.push(part);
    }
    for (const def of kind.parts) {
      const pivot = def.pivot ? new THREE.Vector3(...def.pivot) : new THREE.Vector3(...def.offset);
      const fromPivot = new THREE.Vector3(...def.offset).sub(pivot);
      const staticRot = def.rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...def.rot)) : null;
      this.parts.push({ def, pivot, fromPivot, staticRot, scale: unitScale(def), into: built.get(meshKey(def))! });
    }
  }
}

/**
 * The size of the shape a part is cut from, or null when it is already its own size.
 *
 * Everything in the bestiary is a box, a cylinder, a cone or an icosahedron, and all four are the
 * same shape at every size — so one geometry per shape, stretched per instance, draws them all.
 * The exception is a cylinder with a different radius at each end, which is a taper rather than a
 * stretch and gets a geometry of its own; nothing has one today, and this is here so that adding
 * one is a part definition rather than a bug.
 */
function unitScale(p: PartDef): THREE.Vector3 | null {
  switch (p.shape) {
    case 'box': return new THREE.Vector3(p.size[0], p.size[1], p.size[2]);
    case 'ico': return new THREE.Vector3(p.size[0], p.size[0], p.size[0]);
    case 'cone': return new THREE.Vector3(p.size[2], p.size[1], p.size[2]);
    case 'cyl': return p.size[0] === p.size[2] ? new THREE.Vector3(p.size[0], p.size[1], p.size[0]) : null;
  }
}

/**
 * What decides whether two parts of a kind share a draw: the same shape, the same paint, and the
 * same answer to whether they are worth a shadow. Painted parts group together whatever palette
 * entry they read, because that colour is written per instance; a fixed colour is in the material
 * and so has to match exactly.
 */
function meshKey(p: PartDef): string {
  const shape = unitScale(p) ? p.shape : `${p.shape}:${p.size.join(',')}`;
  const paint = p.tint === undefined ? `c${p.color}` : 'tinted';
  return `${shape}|${paint}|${partVolume(p) >= SHADOW_VOLUME}`;
}

/** The geometry a group of parts is drawn from: one unit shape, or the exact one for a taper. */
function unitGeometry(p: PartDef): THREE.BufferGeometry {
  const size = unitScale(p) ? [1, 1, 1] : p.size;
  let g: THREE.BufferGeometry;
  switch (p.shape) {
    case 'box': g = new THREE.BoxGeometry(size[0], size[1], size[2]); break;
    case 'cyl': g = new THREE.CylinderGeometry(size[0], size[2], size[1], 6); break;
    case 'cone': g = new THREE.ConeGeometry(size[2], size[1], 6); break;
    case 'ico': g = new THREE.IcosahedronGeometry(size[0], 0); break;
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
    for (const p of this.pools.values()) for (const part of p.meshes) if (part.count > 0) out.push(part.mesh);
    return out;
  }

  /** Whoever owns the instance a ray hit, or null if the hit was on nothing living. */
  entityAt(hit: THREE.Intersection): Entity | null {
    const part = hit.object.userData.part as PartMesh | undefined;
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
      for (const part of p.meshes) { part.count = 0; part.recoloured = recolour; }
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
          // the mesh holds one shape at one size; this is what makes it this part's shape
          if (part.scale) this.m.scale(part.scale);
          const into = part.into;
          const k = into.count++;
          into.mesh.setMatrixAt(k, this.m);
          if (d.tint === undefined) continue;
          const hot = e.hurt > 0 ? 1 : 0;
          if (into.drawn[k] !== e || into.hot[k] !== hot || into.paint[k] !== d.tint) {
            into.drawn[k] = e;
            into.hot[k] = hot;
            into.paint[k] = d.tint;
            into.recoloured = true;
            this.writeColour(into, k, e, d.tint);
          } else if (recolour) {
            this.writeColour(into, k, e, d.tint);
          }
        }
      }
      for (const part of p.meshes) {
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
  private writeColour(part: PartMesh, index: number, e: Entity, tint: number): void {
    this.color.setHex(e.tints[Math.min(tint, e.tints.length - 1)]);
    if (e.hurt > 0) this.color.lerp(HURT_COLOR, 0.7);
    part.mesh.setColorAt(index, this.color);
  }

  dispose(): void {
    for (const p of this.pools.values()) {
      for (const part of p.meshes) {
        this.scene.remove(part.mesh);
        part.mesh.geometry.dispose();
        (part.mesh.material as THREE.Material).dispose();
        part.mesh.dispose();
      }
    }
    this.pools.clear();
  }
}
