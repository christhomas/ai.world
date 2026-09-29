import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import { BOAT_PARTS, putBoatIn } from './boat';
import { putFerriesOut } from './ferries';
import { MountedThreePipeline } from './pipeline';

describe('boats in the neutral frame', () => {
  it('uses one part definition and one pose for the live boat and recording', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const boat = putBoatIn(scene, graph);
    const node = graph.nodes[0];
    expect(node).toMatchObject({ kind: 'prop-batch', parts: BOAT_PARTS, placements: [] });
    expect((scene.children[0] as THREE.Group).children).toHaveLength(BOAT_PARTS.length);
    boat.setPose(12, 3, -5, 0.4);
    boat.visible = true;
    expect(node.kind === 'prop-batch' && node.placements).toEqual([{ x: 12, y: 3, z: -5, rot: 0.4 }]);
    expect(scene.children[0].position.toArray()).toEqual([12, 3, -5]);
    boat.visible = false;
    expect(node.kind === 'prop-batch' && node.placements).toEqual([]);
  });

  it('records every ferry using its scheduled pose', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const [ferry] = putFerriesOut(['crossing'], scene, graph);
    ferry.visual.setPose(-4, 2, 9, 1.2);
    const node = graph.nodes[0];
    expect(node.kind === 'prop-batch' && node.placements).toEqual([{ x: -4, y: 2, z: 9, rot: 1.2 }]);
    expect(scene.children[0].rotation.y).toBeCloseTo(1.2);
    if (node.kind !== 'prop-batch') throw new Error('ferry has no neutral pose');
    node.placements[0].x = 34;
    graph.camera = { projection: new THREE.Matrix4().toArray(), world: new THREE.Matrix4().toArray(), orthographic: true };
    new MountedThreePipeline(scene, () => {}, graph).draw(graph.frame());
    expect(scene.children[0].position.x).toBe(34);
  });
});
