import * as THREE from 'three';
import type { PropKind } from '../world/biomes';
import type { PropLibrary } from './props';
import type { MeshData } from '../world/mesher';
import { worldView } from './scene';

/**
 * One prop to draw: which kind, where, facing where, at what size — and the three small
 * differences that stop a wood looking like one tree stamped four hundred times. All of them are
 * rolled from the tile's own hash, so the same forest grows the same way on every machine.
 */
export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale?: number;
  /** Height against width: below 1 is squat, above 1 is a spindly one reaching for the light. */
  stretch?: number;
  /** How far off upright, as 0..1. Nothing in a wood grows perfectly straight. */
  lean?: number;
  /** How light or dark this one is, as 0..1. Half is the colour the model was built in. */
  tint?: number;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const lean = new THREE.Quaternion();
const leanAxis = new THREE.Vector3();
const tint = new THREE.Color();

/** The most a prop leans off upright, in radians. A wood, not a gale. */
const MAX_LEAN = 0.09;
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * How big a prop has to be, in cubic tiles of its bounding box, before its shadow is worth a
 * draw call. A tree or a boulder plainly casts one; a flower, a tuft of grass or a pebble drops
 * a shadow nobody can see, and the shadow pass is the most expensive half of a frame.
 *
 * The same rule creatures use for their parts, in `entities/pool.ts`, at their own scale.
 */
const SHADOW_VOLUME = 0.5;

/**
 * How light or dark one prop stands against the next. Lighter ones lean a little warmer, as
 * foliage in the sun does; darker ones a little cooler, as foliage in its own shade does.
 */
const shadeOf = (t: number): THREE.Color => {
  const shade = 0.85 + t * 0.3;
  return tint.setRGB(shade * (0.98 + t * 0.06), shade, shade * (1.04 - t * 0.08));
};

const worthAShadow = (geometry: THREE.BufferGeometry): boolean => {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return true;
  return (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z) >= SHADOW_VOLUME;
};

/**
 * Where one prop stands, which way it faces and how it is shaped, as the matrix an instance
 * wants. Both ways of drawing props go through this, so a tree put up by a chunk and the same
 * tree put up by a dungeon are the same tree rather than two things that look alike.
 */
function composeInstance(inst: PropInstance, out: THREE.Matrix4): THREE.Matrix4 {
  quat.setFromAxisAngle(UP, inst.rot);
  // a lean is a small tip away from upright, in whatever direction this one happens to face
  const tipped = (inst.lean ?? 0.5) - 0.5;
  leanAxis.set(Math.cos(inst.rot), 0, Math.sin(inst.rot));
  lean.setFromAxisAngle(leanAxis, tipped * 2 * MAX_LEAN);
  quat.premultiply(lean);

  const s = inst.scale ?? 1;
  position.set(inst.x, inst.y, inst.z);
  scale.set(s, s * (inst.stretch ?? 1), s);
  return out.compose(position, quat, scale);
}

/** Sort a stream of props into one list per kind, which is how both drawing paths want them. */
function byKindOf(instances: Iterable<PropInstance>): Map<PropKind, PropInstance[]> {
  const byKind = new Map<PropKind, PropInstance[]>();
  for (const inst of instances) {
    let list = byKind.get(inst.kind);
    if (!list) { list = []; byKind.set(inst.kind, list); }
    list.push(inst);
  }
  return byKind;
}

/**
 * Draw a batch of props as one InstancedMesh per kind, plus a matching unlit mesh for any kind
 * that has a glow (lit windows, torch flames, a forge). Used by chunks, dungeons and interiors,
 * which all draw the same prop library in the same way.
 */
export function addPropInstances(
  parent: THREE.Object3D,
  props: PropLibrary,
  instances: Iterable<PropInstance>,
  glowMaterial: THREE.Material,
  shadows = true,
): void {
  for (const [kind, list] of byKindOf(instances)) {
    const geometry = props.geometries.get(kind);
    if (!geometry) continue;
    const mesh = new THREE.InstancedMesh(geometry, props.material, list.length);
    list.forEach((inst, i) => {
      mesh.setMatrixAt(i, composeInstance(inst, matrix));
      mesh.setColorAt(i, shadeOf(inst.tint ?? 0.5));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows && worthAShadow(geometry);
    mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    parent.add(mesh);

    const glowGeometry = props.glows.get(kind);
    if (!glowGeometry) continue;
    const glow = new THREE.InstancedMesh(glowGeometry, glowMaterial, list.length);
    glow.instanceMatrix.copy(mesh.instanceMatrix);
    glow.instanceMatrix.needsUpdate = true;
    glow.computeBoundingSphere();
    parent.add(glow);
  }
}

/**
 * How far the camera may travel, in tiles, before the batches are packed again.
 *
 * Packing is what decides which props are handed to the GPU, and it is not free, so it is not
 * done every frame. Everything within the view's own radius plus this much is packed, which means
 * the answer stays right until the camera has moved this far — and then it is worked out again.
 */
const REPACK_SLACK = 3;

/** No instance buffer is worth allocating smaller than this; a lone flower would only grow. */
const MIN_CAPACITY = 16;

/**
 * One chunk's props of one kind, already turned into the numbers the GPU wants.
 *
 * Composing a matrix costs a quaternion, two multiplies and a compose; doing that again for every
 * prop in the world every time the camera moved would put the work back on the CPU that this whole
 * exercise is trying to take off the GPU. So it is done once, when the chunk arrives, and packing
 * afterwards is a memcpy of sixteen floats.
 */
interface PackedProps {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
  /** Where each one stands, kept apart from the matrix so the cull reads two numbers, not sixteen. */
  xs: Float32Array;
  zs: Float32Array;
}

/** Everything of one kind, from every chunk that has any, and the meshes that draw them. */
interface KindBatch {
  geometry: THREE.BufferGeometry;
  glowGeometry: THREE.BufferGeometry | undefined;
  parts: Map<string, PackedProps>;
  /** Instances held across every part, which is what the buffer has to be big enough for. */
  total: number;
  mesh: THREE.InstancedMesh | null;
  glow: THREE.InstancedMesh | null;
  capacity: number;
}

function pack(list: PropInstance[]): PackedProps {
  const count = list.length;
  const out: PackedProps = {
    count,
    matrices: new Float32Array(count * 16),
    colors: new Float32Array(count * 3),
    xs: new Float32Array(count),
    zs: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const inst = list[i];
    composeInstance(inst, matrix).toArray(out.matrices, i * 16);
    const shade = shadeOf(inst.tint ?? 0.5);
    out.colors[i * 3] = shade.r;
    out.colors[i * 3 + 1] = shade.g;
    out.colors[i * 3 + 2] = shade.b;
    out.xs[i] = inst.x;
    out.zs[i] = inst.z;
  }
  return out;
}

/**
 * Every prop in the loaded world, drawn as one InstancedMesh per kind rather than one per kind
 * per chunk.
 *
 * Instancing exists to collapse many copies of a thing into a single draw, and a chunk is far too
 * small a unit to do that with: sixteen tiles square holds three or four of any given tree, so a
 * hundred and twenty loaded chunks came out as nine hundred batches averaging three and a half
 * instances each — very nearly the opposite of what instancing is for. Held per kind instead,
 * every oak in sight is one draw call however many chunks they are spread across.
 *
 * What a chunk still decides is which props exist and where; it hands them over as a lump and
 * takes them back when it unloads, and the batch does not care which chunk anything came from
 * beyond needing a name to give the lump back under.
 *
 * Only what the camera can see is packed into the front of each buffer, on the same terms the
 * creature pools use: the scene says where the view is, and anything past its radius is not
 * written, so a kind with nothing in shot costs no draw at all. A scene nobody has told — an
 * interior, a dungeon — draws the lot, as it always did.
 */
export class PropBatch {
  private readonly kinds = new Map<PropKind, KindBatch>();
  private readonly group = new THREE.Group();
  /** Set when a chunk arrived or left, so the next update packs whether the camera moved or not. */
  private dirty = true;
  private packedX = 0;
  private packedZ = 0;
  /** Below zero until the first pack has happened, which is what makes that first one happen. */
  private packedRadius = -1;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly props: PropLibrary,
    private readonly glowMaterial: THREE.Material,
  ) {
    scene.add(this.group);
    // nothing in here ever moves, so the frame need not walk it asking whether anything has
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrixWorld(true);
    this.group.matrixWorldAutoUpdate = false;
  }

  /** Take on one chunk's props, replacing whatever it handed over before. */
  set(key: string, instances: Iterable<PropInstance>): void {
    this.remove(key);
    for (const [kind, list] of byKindOf(instances)) {
      const geometry = this.props.geometries.get(kind);
      if (!geometry) continue;
      let batch = this.kinds.get(kind);
      if (!batch) {
        batch = {
          geometry, glowGeometry: this.props.glows.get(kind),
          parts: new Map(), total: 0, mesh: null, glow: null, capacity: 0,
        };
        this.kinds.set(kind, batch);
      }
      batch.parts.set(key, pack(list));
      batch.total += list.length;
      this.dirty = true;
    }
  }

  /** Give a chunk's props back, because the chunk has gone. */
  remove(key: string): void {
    for (const [kind, batch] of this.kinds) {
      const part = batch.parts.get(key);
      if (!part) continue;
      batch.parts.delete(key);
      batch.total -= part.count;
      this.dirty = true;
      // a kind nobody is growing any more keeps no mesh: an InstancedMesh with nothing in it is
      // still an object the frame walks, sorts and hands to the shadow pass to think about
      if (batch.total === 0) { this.drop(batch); this.kinds.delete(kind); }
    }
  }

  /** Pack what the camera can see. Call once a frame, after the rig has said where it is looking. */
  update(): void {
    const view = worldView(this.scene);
    const moved = view !== null && (
      Math.abs(view.x - this.packedX) > REPACK_SLACK ||
      Math.abs(view.z - this.packedZ) > REPACK_SLACK ||
      view.radius !== this.packedRadius);
    if (!this.dirty && this.packedRadius >= 0 && !moved) return;
    this.dirty = false;
    this.packedX = view ? view.x : 0;
    this.packedZ = view ? view.z : 0;
    this.packedRadius = view ? view.radius : Number.POSITIVE_INFINITY;
    const reach = view ? (view.radius + REPACK_SLACK) ** 2 : Number.POSITIVE_INFINITY;
    for (const batch of this.kinds.values()) this.fill(batch, reach);
  }

  private fill(batch: KindBatch, reach: number): void {
    const mesh = this.meshFor(batch);
    const matrices = mesh.instanceMatrix.array as Float32Array;
    const colors = (mesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
    let n = 0;
    for (const part of batch.parts.values()) {
      for (let i = 0; i < part.count; i++) {
        const dx = part.xs[i] - this.packedX, dz = part.zs[i] - this.packedZ;
        if (dx * dx + dz * dz > reach) continue;
        matrices.set(part.matrices.subarray(i * 16, i * 16 + 16), n * 16);
        colors.set(part.colors.subarray(i * 3, i * 3 + 3), n * 3);
        n++;
      }
    }
    mesh.count = n;
    // three walks a mesh, sorts it and offers it to both passes before finding out it draws
    // nothing; hidden, it is skipped where it is cheapest to skip it
    mesh.visible = n > 0;
    // only the slots in use are uploaded: a buffer is sized for every prop of its kind in the
    // world, and posting the whole thing when a corner of it changed is the expensive way round
    uploaded(mesh.instanceMatrix, n * 16);
    uploaded(mesh.instanceColor as THREE.InstancedBufferAttribute, n * 3);
    if (!batch.glow) return;
    (batch.glow.instanceMatrix.array as Float32Array).set(matrices.subarray(0, n * 16));
    batch.glow.count = n;
    batch.glow.visible = n > 0;
    uploaded(batch.glow.instanceMatrix, n * 16);
  }

  /** The mesh for a kind, made bigger first if the kind has outgrown the one it has. */
  private meshFor(batch: KindBatch): THREE.InstancedMesh {
    if (batch.mesh && batch.capacity >= batch.total) return batch.mesh;
    this.drop(batch);
    // powers of two, so a chunk arriving with one more oak in it than the last does not mean
    // throwing away and rebuilding every oak buffer in the world
    const capacity = Math.max(MIN_CAPACITY, 2 ** Math.ceil(Math.log2(batch.total)));
    const mesh = new THREE.InstancedMesh(batch.geometry, this.props.material, capacity);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.count = 0;
    mesh.castShadow = worthAShadow(batch.geometry);
    mesh.receiveShadow = true;
    // what is written is what is in shot, so there is nothing left for three to cull
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    batch.mesh = mesh;
    batch.capacity = capacity;
    if (batch.glowGeometry) {
      const glow = new THREE.InstancedMesh(batch.glowGeometry, this.glowMaterial, capacity);
      glow.count = 0;
      glow.frustumCulled = false;
      glow.matrixAutoUpdate = false;
      this.group.add(glow);
      batch.glow = glow;
    }
    return mesh;
  }

  private drop(batch: KindBatch): void {
    for (const mesh of [batch.mesh, batch.glow]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    batch.mesh = null;
    batch.glow = null;
    batch.capacity = 0;
  }

  dispose(): void {
    for (const batch of this.kinds.values()) this.drop(batch);
    this.kinds.clear();
    this.scene.remove(this.group);
  }
}

/** Tell three that the first `count` numbers of a buffer changed and the rest did not. */
function uploaded(attribute: THREE.InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}

/** Free the geometries and instance buffers of everything `addPropInstances` put in a group. */
export function disposeInstances(parent: THREE.Object3D): void {
  parent.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
}

/** A three.js mesh from the flat arrays the mesher and workers produce. */
export function meshFromData(data: MeshData, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  if (data.flow) geometry.setAttribute('flow', new THREE.BufferAttribute(data.flow, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, material);
}
