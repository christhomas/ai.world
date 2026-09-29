import * as THREE from 'three';
import type { SceneGraph, SceneNode } from '../core/scenegraph';
import { applyInstanceFrame, bindGraphMount } from './graphmount';

const unmounts = new WeakMap<SceneNode, () => void>();

/** Publish an instanced WebGL adapter's shared buffers as neutral frame data. */
export function recordInstances(graph: SceneGraph, mesh: THREE.InstancedMesh): Extract<SceneNode, { kind: 'instances' }> {
  const material = mesh.material as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  if (!(position?.array instanceof Float32Array) || !(normal?.array instanceof Float32Array)) {
    throw new Error('instanced scene geometry needs float positions and normals');
  }
  const indices = mesh.geometry.index?.array;
  const node: Extract<SceneNode, { kind: 'instances' }> = {
    kind: 'instances',
    geometry: {
      positions: position.array, normals: normal.array,
      indices: indices as Uint16Array | Uint32Array | undefined,
    },
    colour: material.color.getHex(),
    count: mesh.count,
    matrices: mesh.instanceMatrix.array as Float32Array,
    colours: mesh.instanceColor?.array as Float32Array | undefined,
    castShadow: mesh.castShadow,
    receiveShadow: mesh.receiveShadow,
    renderOrder: mesh.renderOrder,
    material: {
      intent: material instanceof THREE.MeshBasicMaterial ? 'unlit' : 'lit',
      colour: material.color.getHex(), emissive: 0,
      vertexColours: material.vertexColors,
      transparent: material.transparent, opacity: material.opacity,
      depthWrite: material.depthWrite, depthTest: material.depthTest,
      toneMapped: material.toneMapped,
      side: material.side === THREE.DoubleSide ? 'double' : material.side === THREE.BackSide ? 'back' : 'front',
      effects: material instanceof THREE.MeshLambertMaterial && material.flatShading ? ['flat-shading'] : [],
    },
  };
  graph.add(node);
  unmounts.set(node, bindGraphMount(graph, node, (frame) => applyInstanceFrame(mesh, frame)));
  return node;
}

export function retireInstances(graph: SceneGraph, node: Extract<SceneNode, { kind: 'instances' }>): void {
  unmounts.get(node)?.();
  unmounts.delete(node);
  graph.remove(node);
}
