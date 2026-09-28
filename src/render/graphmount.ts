import * as THREE from 'three';
import type { FrameDescription } from '../core/scene';
import type { SceneGraph, SceneNode } from '../core/scenegraph';

type FrameNode = FrameDescription['nodes'][number];
type Mount = (frame: FrameNode) => void;
const mounts = new WeakMap<SceneGraph, Map<SceneNode, Mount>>();
const parentInverse = new THREE.Matrix4();

/** Keep each retained WebGL object attached to the neutral node that owns its next frame. */
export function bindGraphMount(graph: SceneGraph, node: SceneNode, apply: Mount): () => void {
  let mounted = mounts.get(graph);
  if (!mounted) { mounted = new Map(); mounts.set(graph, mounted); }
  if (mounted.has(node)) throw new Error('neutral node already has a WebGL mount');
  mounted.set(node, apply);
  return () => { if (mounted?.get(node) === apply) mounted.delete(node); };
}

/** Apply exactly the frame submitted to recording before issuing the live WebGL draw. */
export function applyGraphMounts(graph: SceneGraph, frame: FrameDescription): void {
  const mounted = mounts.get(graph);
  if (!mounted) return;
  if (graph.nodes.length !== frame.nodes.length) throw new Error('graph changed during frame submission');
  graph.nodes.forEach((node, at) => mounted.get(node)?.(frame.nodes[at]));
}

export function applyMeshFrame(mesh: THREE.Mesh, frame: FrameNode): void {
  mesh.visible = frame.visible;
  mesh.castShadow = frame.castShadow;
  mesh.receiveShadow = frame.receiveShadow;
  mesh.renderOrder = frame.renderOrder ?? 0;
  const authoredPose = mesh.matrixAutoUpdate;
  mesh.matrix.fromArray(frame.world);
  if (mesh.parent) {
    mesh.parent.updateWorldMatrix(true, false);
    parentInverse.copy(mesh.parent.matrixWorld).invert();
    mesh.matrix.premultiply(parentInverse);
  }
  // Retained producers that animate position/rotation/scale need those values updated as well;
  // forcing matrixAutoUpdate off would freeze their next pose before it reached the graph.
  if (authoredPose) mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.updateMatrixWorld(true);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const paint = frame.material;
  if (!paint || !(material instanceof THREE.MeshBasicMaterial || material instanceof THREE.MeshLambertMaterial)) return;
  material.color.setHex(paint.colour);
  material.transparent = paint.transparent;
  material.opacity = paint.opacity;
  material.depthWrite = paint.depthWrite;
  material.depthTest = paint.depthTest ?? true;
  material.toneMapped = paint.toneMapped ?? true;
  material.side = paint.side === 'double' ? THREE.DoubleSide : paint.side === 'back' ? THREE.BackSide : THREE.FrontSide;
  material.blending = paint.effects.includes('additive-blending') ? THREE.AdditiveBlending : THREE.NormalBlending;
  if (material instanceof THREE.MeshLambertMaterial) {
    material.flatShading = paint.effects.includes('flat-shading');
    material.emissive.setHex(paint.emissive);
  }
}

export function applyInstanceFrame(mesh: THREE.InstancedMesh, frame: FrameNode): void {
  applyMeshFrame(mesh, frame);
  const matrices = frame.instanceMatrices;
  mesh.count = (matrices?.length ?? 0) / 16;
  if (matrices && matrices !== mesh.instanceMatrix.array) {
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
  }
  if (frame.instanceColours && mesh.instanceColor && frame.instanceColours !== mesh.instanceColor.array) {
    mesh.instanceColor.array.set(frame.instanceColours);
    mesh.instanceColor.needsUpdate = true;
  }
}
