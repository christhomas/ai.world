import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { mountSceneGraph } from './scenegraph';

describe('neutral scene graph adapter', () => {
  it('mounts plain mesh and light descriptions without giving the graph Three objects', () => {
    const graph = new SceneGraph(0x0d1018);
    graph.add({ kind: 'ambient', colour: 0xffe9cc, intensity: 1.35 });
    graph.add({ kind: 'hemisphere', sky: 0xfff0d8, ground: 0x4a3a2a, intensity: 0.9 });
    graph.add({ kind: 'point', colour: 0xffd9a0, intensity: 14, distance: 20, decay: 1.4, position: [2, 4.5, 3] });
    graph.add({
      kind: 'mesh', material: 'lit-vertex-colours', receiveShadow: true,
      geometry: {
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
        normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
        colours: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1),
      },
    });
    const mounted = mountSceneGraph(graph);
    expect((mounted.scene.background as THREE.Color).getHex()).toBe(0x0d1018);
    expect(mounted.scene.children.map((node) => node.type)).toEqual([
      'AmbientLight', 'HemisphereLight', 'PointLight', 'Mesh',
    ]);
    const point = mounted.scene.children[2] as THREE.PointLight;
    expect(point.position.toArray()).toEqual([2, 4.5, 3]);
    expect(point.decay).toBe(1.4);
    const mesh = mounted.scene.children[3] as THREE.Mesh;
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.geometry.getAttribute('color').count).toBe(3);
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(graph.nodes.every((node) => !('isObject3D' in node))).toBe(true);
    mounted.dispose();
  });
});
