import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import { buildSkyIsland, planSkyIslands } from '../world/skyisland';
import { SkyIslands } from './skyisland';
import type { PropLibrary } from './props';

describe('sky island frame ownership', () => {
  it('streams land and waterfall through the neutral graph and retires both together', () => {
    const [site] = planSkyIslands(3, [{ id: 'isle:1000,0', x: 1000, z: 0, radius: 90 }], []);
    const isle = buildSkyIsland(site, 12345);
    isle.props = [];
    const graph = new SceneGraph(0x8fc1e6);
    const scene = new THREE.Scene();
    const land = new THREE.MeshLambertMaterial({ vertexColors: true });
    const water = new THREE.MeshBasicMaterial();
    const renderer = new SkyIslands(scene, { geometries: new Map(), glows: new Map() } as unknown as PropLibrary,
      water, land, graph);

    renderer.add(isle, () => 0);
    const meshes = graph.nodes.filter((node) => node.kind === 'mesh');
    expect(meshes.map((node) => node.material)).toEqual(['lit-vertex-colours', 'water']);
    expect(scene.children.filter((child) => child instanceof THREE.Mesh)).toHaveLength(2);
    expect(meshes[0]).toMatchObject({ castShadow: true, receiveShadow: true });
    expect(meshes[1]).toMatchObject({ renderOrder: 2 });

    renderer.clear();
    expect(graph.nodes).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
    water.dispose();
    land.dispose();
  });
});
