import * as THREE from 'three';
import type { PropKind } from '../world/biomes';
import type { PropLibrary } from './props';
import type { MeshData } from '../world/mesher';

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
  const byKind = new Map<PropKind, PropInstance[]>();
  for (const inst of instances) {
    let list = byKind.get(inst.kind);
    if (!list) { list = []; byKind.set(inst.kind, list); }
    list.push(inst);
  }
  for (const [kind, list] of byKind) {
    const geometry = props.geometries.get(kind);
    if (!geometry) continue;
    const mesh = new THREE.InstancedMesh(geometry, props.material, list.length);
    list.forEach((inst, i) => {
      quat.setFromAxisAngle(UP, inst.rot);
      // a lean is a small tip away from upright, in whatever direction this one happens to face
      const tipped = (inst.lean ?? 0.5) - 0.5;
      leanAxis.set(Math.cos(inst.rot), 0, Math.sin(inst.rot));
      lean.setFromAxisAngle(leanAxis, tipped * 2 * MAX_LEAN);
      quat.premultiply(lean);

      const s = inst.scale ?? 1;
      position.set(inst.x, inst.y, inst.z);
      scale.set(s, s * (inst.stretch ?? 1), s);
      matrix.compose(position, quat, scale);
      mesh.setMatrixAt(i, matrix);
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
