import * as THREE from 'three';
import type { AnimRole, AnimalKind, PartDef } from './animals';
import type { Entity } from './entity';
import { bodyLean, cycleTurn, limbTurn, strikeAt } from './motion';

/**
 * Draws every creature through per-part InstancedMesh pools: one pool per (kind, part).
 * A field of forty sheep is ~8 draw calls. Animation is done by rewriting instance matrices.
 */

const CAPACITY = 320;
const SHADOW_VOLUME = 0.012;
const HURT_COLOR = new THREE.Color(0xffffff);
/** A zero-scale matrix: the shape is still in the buffer but covers no pixels. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

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
}

class KindPool {
  readonly parts: PartRuntime[] = [];
  readonly entities: Entity[] = [];
  colorsDirty = false;
  hurtDirty = false;

  constructor(readonly kind: AnimalKind, scene: THREE.Scene) {
    for (const def of kind.parts) {
      const geo = makeGeometry(def);
      const mat = new THREE.MeshLambertMaterial({ color: def.tint === undefined ? def.color : 0xffffff });
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.count = 0;
      // only chunky parts cast shadows; legs, ears and beaks are not worth a shadow-pass draw call
      mesh.castShadow = partVolume(def) >= SHADOW_VOLUME;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.pool = this;
      scene.add(mesh);
      const pivot = def.pivot ? new THREE.Vector3(...def.pivot) : new THREE.Vector3(...def.offset);
      const fromPivot = new THREE.Vector3(...def.offset).sub(pivot);
      const staticRot = def.rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...def.rot)) : null;
      this.parts.push({ def, mesh, pivot, fromPivot, staticRot });
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

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of this.pools.values()) if (p.entities.length > 0) for (const part of p.parts) out.push(part.mesh);
    return out;
  }

  entityAt(hit: THREE.Intersection): Entity | null {
    const pool = hit.object.userData.pool as KindPool | undefined;
    if (!pool || hit.instanceId === undefined) return null;
    return pool.entities[hit.instanceId] ?? null;
  }

  get count(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.entities.length;
    return n;
  }

  /** Rewrite every instance matrix from entity state. Call once per frame after entities moved. */
  update(): void {
    for (const p of this.pools.values()) {
      const n = p.entities.length;
      if (p.hurtDirty || p.colorsDirty) {
        for (const part of p.parts) {
          if (part.def.tint === undefined) continue;
          for (let i = 0; i < n; i++) {
            const e = p.entities[i];
            this.color.setHex(e.tints[Math.min(part.def.tint, e.tints.length - 1)]);
            if (e.hurt > 0) this.color.lerp(HURT_COLOR, 0.7);
            part.mesh.setColorAt(i, this.color);
          }
          if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
        }
        p.colorsDirty = false;
        p.hurtDirty = p.entities.some((e) => e.hurt > 0);
      }
      if (!p.hurtDirty && p.entities.some((e) => e.hurt > 0)) p.hurtDirty = true;
      for (const part of p.parts) part.mesh.count = n;
      if (n === 0) continue;
      for (let i = 0; i < n; i++) {
        const e = p.entities[i];
        const s = e.kind.scale;
        // indoors: park the rig far below so it is neither seen nor clickable
        this.pos.set(e.x, e.indoors ? -999 : e.y + e.bobY, e.z);
        this.quat.setFromAxisAngle(this.up, e.yaw);
        // one blow moves the whole body rather than a limb: a bear that only waved a paw would
        // not read as a bear
        const lean = e.strike > 0 ? bodyLean(e.blow, strikeAt(e.blow, e.strike)) : 0;
        if (lean !== 0) {
          this.tilt.setFromAxisAngle(this.side, lean);
          this.quat.multiply(this.tilt);
        }
        this.scl.set(s, s, s);
        this.root.compose(this.pos, this.quat, this.scl);
        for (const part of p.parts) {
          const d = part.def;
          if (d.tag && e.hiddenTags.has(d.tag)) {
            // hidden parts are scaled away rather than removed, so the pool stays a flat array
            part.mesh.setMatrixAt(i, HIDDEN);
            continue;
          }
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
          part.mesh.setMatrixAt(i, this.m);
        }
      }
      for (const part of p.parts) part.mesh.instanceMatrix.needsUpdate = true;
    }
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
