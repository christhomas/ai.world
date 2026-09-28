import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import type { Pod } from '../game/whales';
import { WhaleSchool } from './whales';

describe('whales in the neutral frame', () => {
  it('records each visible whale part and animated splash ring with native matching transforms', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const school = new WhaleSchool(scene, graph);
    const pod: Pod = { id: 'pod', x: 20, z: -8, size: 1, favourite: 0, at: 0, seed: 7 };
    school.update([pod], 4, 0.1);
    const visible = graph.nodes.filter((node) => node.kind === 'mesh' && node.visible);
    expect(visible).toHaveLength(7);
    const native = scene.children[0] as THREE.Group;
    scene.updateMatrixWorld(true);
    expect(visible[0].kind === 'mesh' && visible[0].world).toEqual((native.children[0] as THREE.Mesh).matrixWorld.toArray());

    school.splash(21, -9);
    school.update([], 5, 0.4);
    const ring = graph.nodes.find((node) => node.kind === 'mesh' && node.visible);
    expect(ring).toMatchObject({ materialState: { intent: 'unlit', transparent: true, depthWrite: false } });
    expect(ring?.kind === 'mesh' && ring.materialState?.opacity).toBeLessThan(0.5);
    school.dispose();
    expect(graph.nodes).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
});
