import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import { recordInstances } from './instancegraph';
import { Shafts } from './shafts';
import { Swallows } from './swallows';
import { Updraughts } from './updraughts';

describe('small instanced effects in the neutral frame', () => {
  it('shares live matrices and keeps material intent, order, and draw count', () => {
    const graph = new SceneGraph(0);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.75,
        depthWrite: false, side: THREE.DoubleSide }), 2);
    mesh.count = 0;
    mesh.renderOrder = 1;
    const node = recordInstances(graph, mesh);
    const matrix = new THREE.Matrix4().makeTranslation(2, 3, 4);
    mesh.setMatrixAt(0, matrix);
    node.count = mesh.count = 1;
    graph.camera = { projection: new Array(16).fill(0), world: new Array(16).fill(0), orthographic: true };
    const frame = graph.frame().nodes[0];
    expect((frame.instanceMatrices as Float32Array).buffer).toBe(node.matrices.buffer);
    expect(frame.instanceMatrices?.[12]).toBe(2);
    expect(frame.renderOrder).toBe(1);
    expect(frame.material).toMatchObject({ intent: 'unlit', transparent: true,
      opacity: 0.75, depthWrite: false, side: 'double' });
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it('retires shaft, whirlpool, and thermal records with their adapters', () => {
    const graph = new SceneGraph(0);
    const scene = new THREE.Scene();
    const shafts = new Shafts(scene, 1, graph);
    const swallows = new Swallows(scene, 1, graph);
    const updraughts = new Updraughts(scene, 1, graph);
    expect(graph.nodes).toHaveLength(6);
    shafts.update(0, 0, () => 0, () => true);
    swallows.update(1, 0, 0, () => true);
    updraughts.update(1, 0, 0, () => 0);
    for (const [node, mesh] of graph.nodes.map((node, i) => [node, scene.children[i]] as const)) {
      expect(node.kind).toBe('instances');
      if (node.kind === 'instances' && mesh instanceof THREE.InstancedMesh) {
        expect(node.count).toBe(mesh.count);
        expect(node.matrices).toBe(mesh.instanceMatrix.array);
      }
    }
    shafts.dispose();
    swallows.dispose();
    updraughts.dispose();
    expect(graph.nodes).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
});
