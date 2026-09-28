import * as THREE from 'three';
import type { SceneGraph } from '../core/scenegraph';

/** Build one Three scene from the engine's neutral fixed-scene description. */
export function mountSceneGraph(graph: SceneGraph): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(graph.background);
  const resources: Array<THREE.BufferGeometry | THREE.Material> = [];
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
      geometry.setAttribute('color', new THREE.BufferAttribute(node.geometry.colours, 3));
      geometry.computeBoundingSphere();
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = node.receiveShadow;
      scene.add(mesh);
      resources.push(geometry, material);
    }
  }
  return { scene, dispose: () => { for (const resource of resources) resource.dispose(); } };
}
