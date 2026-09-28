import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { mountSceneGraph, ThreeGraphBridge } from './scenegraph';

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
        colors: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1),
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

  it('preserves indexed flowing water and shares the fixed terrain material', () => {
    const graph = new SceneGraph(0x102030);
    const geometry = {
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
      normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
      colors: Float32Array.of(1, 0, 0, 1, 0, 0, 1, 0, 0),
      indices: Uint32Array.of(0, 1, 2),
      flow: Float32Array.of(0, 0.5, 1),
    };
    graph.add({ kind: 'mesh', geometry, material: 'lit-vertex-colours', castShadow: true, receiveShadow: true });
    graph.add({ kind: 'mesh', geometry, material: 'lit-vertex-colours', receiveShadow: false });
    graph.add({ kind: 'mesh', geometry, material: 'water', receiveShadow: false, renderOrder: 2 });
    const waterMaterial = new THREE.MeshBasicMaterial();
    const mounted = mountSceneGraph(graph, waterMaterial);
    const meshes = mounted.scene.children as THREE.Mesh[];
    expect(meshes[0].material).toBe(meshes[1].material);
    expect(meshes[0].castShadow).toBe(true);
    expect(meshes[2].material).toBe(waterMaterial);
    expect(meshes[2].renderOrder).toBe(2);
    expect(meshes[2].geometry.index?.array).toEqual(geometry.indices);
    expect(meshes[2].geometry.getAttribute('flow').array).toEqual(geometry.flow);
    mounted.dispose();
    waterMaterial.dispose();
  });

  it('streams terrain through graph ownership and retires both representations together', () => {
    const graph = new SceneGraph(0x102030);
    const scene = new THREE.Scene();
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const water = new THREE.MeshBasicMaterial();
    const bridge = new ThreeGraphBridge(graph, scene, lit, water);
    const node = {
      kind: 'mesh' as const, material: 'lit-vertex-colours' as const,
      castShadow: true, receiveShadow: true,
      geometry: {
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
        normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
        colors: Float32Array.of(1, 0, 0, 1, 0, 0, 1, 0, 0),
        indices: Uint32Array.of(0, 1, 2),
      },
    };
    bridge.add(node);
    expect(graph.nodes).toEqual([node]);
    expect(scene.children).toHaveLength(1);
    expect((scene.children[0] as THREE.Mesh).castShadow).toBe(true);
    bridge.remove(node);
    expect(graph.nodes).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    lit.dispose();
    water.dispose();
  });

  it('moves a water surface from its graph transform without losing sea shader attributes', () => {
    const graph = new SceneGraph(0x102030);
    const scene = new THREE.Scene();
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const water = new THREE.MeshBasicMaterial();
    const bridge = new ThreeGraphBridge(graph, scene, lit, water);
    const node = {
      kind: 'mesh' as const, material: 'water' as const, receiveShadow: false, renderOrder: 1,
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1],
      geometry: {
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
        normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
        colors: Float32Array.of(1, 0, 0, 1, 0, 0, 1, 0, 0),
        sea: Float32Array.of(1, 1, 1), flow: Float32Array.of(0, 0, 0),
      },
    };
    const mesh = bridge.add(node);
    expect(mesh.geometry.getAttribute('sea').array).toBe(node.geometry.sea);
    node.world[12] = 5;
    bridge.sync(node);
    expect(mesh.matrixWorld.elements[12]).toBe(5);
    graph.camera = { projection: new Array(16).fill(0), world: new Array(16).fill(0), orthographic: true };
    expect(graph.frame().nodes[0]).toMatchObject({ world: node.world, renderOrder: 1 });
    bridge.dispose();
    lit.dispose();
    water.dispose();
  });
});
