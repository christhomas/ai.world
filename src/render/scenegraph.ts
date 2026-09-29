import * as THREE from 'three';
import type { SceneGraph, SceneNode } from '../core/scenegraph';
import { applyMeshFrame, bindGraphMount } from './graphmount';

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

  add(node: Extract<SceneNode, { kind: 'mesh' }>): THREE.Mesh {
    if (this.meshes.has(node)) throw new Error('scene node is already mounted');
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
    this.graph.add(node);
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
    if (node.kind === 'ambient') {
      const light = new THREE.AmbientLight(node.colour, node.intensity);
      scene.add(light);
      unmounts.push(bindGraphMount(graph, node, (frame) => {
        light.color.setHex(frame.colour ?? 0xffffff); light.intensity = frame.intensity ?? 0;
      }));
    } else if (node.kind === 'hemisphere') {
      const light = new THREE.HemisphereLight(node.sky, node.ground, node.intensity);
      scene.add(light);
      unmounts.push(bindGraphMount(graph, node, (frame) => {
        light.color.setHex(frame.colour ?? 0xffffff);
        light.groundColor.setHex(frame.groundColour ?? 0xffffff);
        light.intensity = frame.intensity ?? 0;
      }));
    } else if (node.kind === 'point') {
      const light = new THREE.PointLight(node.colour, node.intensity, node.distance, node.decay);
      light.position.set(...node.position);
      scene.add(light);
      unmounts.push(bindGraphMount(graph, node, (frame) => {
        light.color.setHex(frame.colour ?? 0xffffff);
        light.intensity = frame.intensity ?? 0;
        light.distance = frame.distance ?? 0;
        light.decay = frame.decay ?? 2;
        light.position.set(frame.world[12], frame.world[13], frame.world[14]);
      }));
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
