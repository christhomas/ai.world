import * as THREE from 'three';
import type { PropKind } from '../world/biomes';
import type { PropLibrary } from './props';
import type { MeshData } from '../world/mesher';

/** One prop to draw: which kind, where, facing where, at what size. */
export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale?: number;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
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
      const s = inst.scale ?? 1;
      position.set(inst.x, inst.y, inst.z);
      scale.set(s, s, s);
      matrix.compose(position, quat, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
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
