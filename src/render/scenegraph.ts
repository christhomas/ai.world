import * as THREE from 'three';
import type { SceneGraph } from '../core/scenegraph';

/** Build one Three scene from the engine's neutral fixed-scene description. */
export function mountSceneGraph(graph: SceneGraph, waterMaterial?: THREE.Material): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(graph.background);
  const resources: Array<THREE.BufferGeometry | THREE.Material> = [];
  let litMaterial: THREE.MeshLambertMaterial | null = null;
  for (const node of graph.nodes) {
    if (node.kind === 'ambient') {
      scene.add(new THREE.AmbientLight(node.colour, node.intensity));
    } else if (node.kind === 'hemisphere') {
      scene.add(new THREE.HemisphereLight(node.sky, node.ground, node.intensity));
    } else if (node.kind === 'point') {
      const light = new THREE.PointLight(node.colour, node.intensity, node.distance, node.decay);
      light.position.set(...node.position);
      scene.add(light);
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(node.geometry.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(node.geometry.normals, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(node.geometry.colors, 3));
      if (node.geometry.flow) geometry.setAttribute('flow', new THREE.BufferAttribute(node.geometry.flow, 1));
      if (node.geometry.indices) geometry.setIndex(new THREE.BufferAttribute(node.geometry.indices, 1));
      geometry.computeBoundingSphere();
      if (!litMaterial && node.material === 'lit-vertex-colours') {
        litMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        resources.push(litMaterial);
      }
      const material = node.material === 'water' ? waterMaterial : litMaterial;
      if (!material) throw new Error(`scene graph has no material for ${node.material}`);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = node.castShadow ?? false;
      mesh.receiveShadow = node.receiveShadow;
      mesh.renderOrder = node.renderOrder ?? 0;
      scene.add(mesh);
      resources.push(geometry);
    }
  }
  return { scene, dispose: () => { for (const resource of resources) resource.dispose(); } };
}
