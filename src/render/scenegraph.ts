import * as THREE from 'three';
import type { SceneGraph, SceneNode } from '../core/scenegraph';
import { applyMeshFrame, bindGraphMount, bindLightMount, lightColourOf } from './graphmount';

const mountedScenes = new WeakMap<SceneGraph, THREE.Scene>();

/** The WebGL adapter for a neutral graph; callers outside rendering only keep the graph. */
export function sceneForGraph(graph: SceneGraph): THREE.Scene {
  const scene = mountedScenes.get(graph);
  if (!scene) throw new Error('scene graph has no mounted WebGL adapter');
  return scene;
}

export function attachSceneGraph(graph: SceneGraph, scene: THREE.Scene): () => void {
  if (mountedScenes.has(graph)) throw new Error('scene graph is already mounted');
  mountedScenes.set(graph, scene);
  return () => { mountedScenes.delete(graph); };
}

/** Mount and retire streamed neutral mesh nodes without leaking WebGL objects into their owner. */
export class ThreeGraphBridge {
  private readonly meshes = new Map<SceneNode, THREE.Mesh>();
  private readonly unmounts = new Map<SceneNode, () => void>();

  constructor(
    private readonly graph: SceneGraph,
    private readonly scene: THREE.Scene,
    private readonly litMaterial: THREE.Material,
    private readonly waterMaterial: THREE.Material,
    private readonly solidMaterial?: THREE.Material,
  ) {}

  add(node: Extract<SceneNode, { kind: 'mesh' }>, retained = false): THREE.Mesh {
    if (this.meshes.has(node)) throw new Error('scene node is already mounted');
    if (retained && !this.graph.nodes.includes(node)) throw new Error('retained scene node is not owned by the graph');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(node.geometry.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(node.geometry.normals, 3));
    if (node.geometry.colors) geometry.setAttribute('color', new THREE.BufferAttribute(node.geometry.colors, 3));
    if (node.geometry.flow) geometry.setAttribute('flow', new THREE.BufferAttribute(node.geometry.flow, 1));
    if (node.geometry.sea) geometry.setAttribute('sea', new THREE.BufferAttribute(node.geometry.sea, 1));
    if (node.geometry.indices) geometry.setIndex(new THREE.BufferAttribute(node.geometry.indices, 1));
    geometry.computeBoundingSphere();
    const material = node.material === 'water' ? this.waterMaterial
      : node.material === 'lit-solid' ? this.solidMaterial : this.litMaterial;
    if (!material) throw new Error(`scene graph has no material for ${node.material}`);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = node.castShadow ?? false;
    mesh.receiveShadow = node.receiveShadow;
    mesh.renderOrder = node.renderOrder ?? 0;
    mesh.frustumCulled = node.frustumCulled ?? true;
    mesh.matrixAutoUpdate = false;
    if (node.world) mesh.matrix.fromArray(node.world);
    mesh.updateMatrixWorld(true);
    mesh.matrixWorldAutoUpdate = Boolean(node.world);
    if (!retained) this.graph.add(node);
    this.meshes.set(node, mesh);
    this.unmounts.set(node, bindGraphMount(this.graph, node, (frame) => applyMeshFrame(mesh, frame)));
    this.scene.add(mesh);
    return mesh;
  }

  /** Move a retained adapter from the graph's current transform. */
  sync(node: Extract<SceneNode, { kind: 'mesh' }>): void {
    const mesh = this.meshes.get(node);
    if (!mesh) throw new Error('scene node is not mounted');
    if (node.world) mesh.matrix.fromArray(node.world);
    mesh.updateMatrixWorld(true);
  }

  remove(node: SceneNode): void {
    const mesh = this.meshes.get(node);
    if (!mesh) return;
    this.scene.remove(mesh);
    this.unmounts.get(node)?.();
    this.unmounts.delete(node);
    mesh.geometry.dispose();
    this.meshes.delete(node);
    this.graph.remove(node);
  }

  dispose(): void { for (const node of this.meshes.keys()) this.remove(node); }
}

/** Build one Three scene from the engine's neutral fixed-scene description. */
export function mountSceneGraph(graph: SceneGraph, waterMaterial?: THREE.Material): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  const detach = attachSceneGraph(graph, scene);
  scene.background = new THREE.Color(graph.background);
  const resources: Array<THREE.BufferGeometry | THREE.Material> = [];
  const unmounts: Array<() => void> = [];
  let litMaterial: THREE.MeshLambertMaterial | null = null;
  for (const node of graph.nodes) {
    if (node.kind === 'ambient' || node.kind === 'hemisphere' || node.kind === 'point') {
      const light = node.kind === 'ambient' ? new THREE.AmbientLight(lightColourOf(node.colour), node.intensity)
        : node.kind === 'hemisphere'
          ? new THREE.HemisphereLight(lightColourOf(node.sky), lightColourOf(node.ground), node.intensity)
          : new THREE.PointLight(lightColourOf(node.colour), node.intensity, node.distance, node.decay);
      if (node.kind === 'point') light.position.set(...node.position);
      scene.add(light);
      unmounts.push(bindLightMount(graph, node, light));
    } else if (node.kind === 'mesh') {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(node.geometry.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(node.geometry.normals, 3));
      if (node.geometry.colors) geometry.setAttribute('color', new THREE.BufferAttribute(node.geometry.colors, 3));
      if (node.geometry.flow) geometry.setAttribute('flow', new THREE.BufferAttribute(node.geometry.flow, 1));
      if (node.geometry.sea) geometry.setAttribute('sea', new THREE.BufferAttribute(node.geometry.sea, 1));
      if (node.geometry.indices) geometry.setIndex(new THREE.BufferAttribute(node.geometry.indices, 1));
      geometry.computeBoundingSphere();
      if (!litMaterial && node.material === 'lit-vertex-colours') {
        litMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        resources.push(litMaterial);
      }
      const material = node.material === 'water' ? waterMaterial
        : node.material === 'lit-solid' ? new THREE.MeshLambertMaterial({ color: node.colour ?? 0xffffff }) : litMaterial;
      if (!material) throw new Error(`scene graph has no material for ${node.material}`);
      if (node.material === 'lit-solid') resources.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = node.castShadow ?? false;
      mesh.receiveShadow = node.receiveShadow;
      mesh.renderOrder = node.renderOrder ?? 0;
      mesh.frustumCulled = node.frustumCulled ?? true;
      if (node.world) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(node.world); mesh.updateMatrixWorld(true); }
      scene.add(mesh);
      unmounts.push(bindGraphMount(graph, node, (frame) => applyMeshFrame(mesh, frame)));
      resources.push(geometry);
    }
  }
  return { scene, dispose: () => {
    detach(); for (const unmount of unmounts) unmount();
    for (const resource of resources) resource.dispose();
  } };
}
