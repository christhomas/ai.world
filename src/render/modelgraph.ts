import * as THREE from 'three';
import type { SceneGraph, SceneNode } from '../core/scenegraph';

/**
 * A graph projection for a small assembled model. Primitive geometry and local transforms are
 * flattened into independent mesh records so the portable frame does not need Three object trees.
 * The live objects remain the WebGL adapter; each update publishes their composed world pose and
 * material state into the neutral graph.
 */
export class ModelGraph {
  private readonly nodes: Array<{ mesh: THREE.Mesh; node: Extract<SceneNode, { kind: 'mesh' }> }> = [];
  private readonly world = new THREE.Matrix4();

  constructor(private readonly root: THREE.Object3D, private readonly graph?: SceneGraph) {
    if (!graph) return;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      if (!position || !normal) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const colour = 'color' in material && material.color instanceof THREE.Color
        ? material.color.getHex() : 0xffffff;
      const colours = mesh.geometry.getAttribute('color');
      const vertexColours = 'vertexColors' in material && material.vertexColors === true;
      const node: Extract<SceneNode, { kind: 'mesh' }> = {
        kind: 'mesh', material: vertexColours ? 'lit-vertex-colours' : 'lit-solid', colour,
        geometry: {
          positions: position.array as Float32Array,
          normals: normal.array as Float32Array,
          colors: colours?.array as Float32Array | undefined,
          indices: mesh.geometry.index?.array as Uint16Array | Uint32Array | undefined,
        },
        world: mesh.matrixWorld.toArray(), visible: false,
        castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow,
        effects: material instanceof THREE.MeshLambertMaterial && material.flatShading ? ['flat-shading'] : [],
        materialState: {
          intent: material instanceof THREE.MeshBasicMaterial ? 'unlit' : 'lit',
          colour, vertexColours,
          transparent: material.transparent, opacity: material.opacity,
          depthWrite: material.depthWrite,
          depthTest: material.depthTest,
          toneMapped: material.toneMapped,
          side: material.side === THREE.DoubleSide ? 'double' : material.side === THREE.BackSide ? 'back' : 'front',
          effects: material instanceof THREE.MeshLambertMaterial && material.flatShading ? ['flat-shading'] : [],
        },
      };
      graph.add(node);
      this.nodes.push({ mesh, node });
    });
    this.sync();
  }

  /** Publish the model's current transforms, visibility, and material colours. */
  sync(): void {
    if (!this.graph) return;
    this.root.updateMatrixWorld(true);
    for (const { mesh, node } of this.nodes) {
      this.world.copy(mesh.matrixWorld);
      node.world = this.world.toArray(node.world);
      let visible = true;
      for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) visible &&= parent.visible;
      node.visible = visible;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if ('color' in material && material.color instanceof THREE.Color) {
        node.colour = material.color.getHex();
        node.materialState = { ...node.materialState, colour: node.colour };
      }
    }
  }

  dispose(): void {
    if (!this.graph) return;
    for (const { node } of this.nodes) this.graph.remove(node);
    this.nodes.length = 0;
  }
}
