import * as THREE from 'three';
import type { AnimalKind, PartDef } from './animals';
import type { Entity } from './entity';

/**
 * Draws every creature through per-part InstancedMesh pools: one pool per (kind, part).
 * A field of forty sheep is ~8 draw calls. Animation is done by rewriting instance matrices.
 */

const CAPACITY = 320;

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

  constructor(readonly kind: AnimalKind, scene: THREE.Scene) {
    for (const def of kind.parts) {
      const geo = makeGeometry(def);
      const mat = new THREE.MeshLambertMaterial({ color: def.tint === undefined ? def.color : 0xffffff });
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
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
      if (p.colorsDirty) {
        for (const part of p.parts) {
          if (part.def.tint === undefined) continue;
          for (let i = 0; i < n; i++) {
            const tints = p.entities[i].tints;
            this.color.setHex(tints[Math.min(part.def.tint, tints.length - 1)]);
            part.mesh.setColorAt(i, this.color);
          }
          if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
        }
        p.colorsDirty = false;
      }
      for (const part of p.parts) part.mesh.count = n;
      if (n === 0) continue;
      for (let i = 0; i < n; i++) {
        const e = p.entities[i];
        const s = e.kind.scale;
        this.pos.set(e.x, e.y + e.bobY, e.z);
        this.quat.setFromAxisAngle(this.up, e.yaw);
        this.scl.set(s, s, s);
        this.root.compose(this.pos, this.quat, this.scl);
        const swing = Math.sin(e.phase) * 0.6 * e.walk;
        for (const part of p.parts) {
          const d = part.def;
          let ax = 0, ay = 0, az = 0;
          switch (d.anim) {
            case 'legL': az = swing; break;
            case 'legR': az = -swing; break;
            case 'armL': az = -swing * 0.8; break;
            case 'armR': az = swing * 0.8; break;
            case 'tail': ay = Math.sin(e.phase * 0.6 + 1) * 0.35; break;
            case 'head': az = e.headPitch + Math.sin(e.phase * 2) * 0.05 * e.walk; break;
            case 'wingL': ax = Math.sin(e.phase) * 0.55 * e.flap; break;
            case 'wingR': ax = -Math.sin(e.phase) * 0.55 * e.flap; break;
          }
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
