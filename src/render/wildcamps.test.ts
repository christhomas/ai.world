import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import { CampField } from './wildcamps';
import { MountedThreePipeline } from './pipeline';

/** Every mesh WebGL would actually draw: shown itself, and under nothing hidden. */
const drawn = (scene: THREE.Scene): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  scene.traverseVisible((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  return meshes;
};

describe('neutral wild camp drawing', () => {
  it('records component poses and visibility, including a ruined emptied camp', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    const field = new CampField(scene, graph);
    const camp = { x: 7, z: -2, ruined: true };

    field.update([camp], () => false, () => 3);
    const nodes = graph.nodes.filter((node) => node.kind === 'mesh');
    const visible = nodes.filter((node) => node.kind === 'mesh' && node.visible);
    expect(visible.length).toBeGreaterThan(1);
    const tent = visible[0];
    expect(tent.kind).toBe('mesh');
    if (tent.kind === 'mesh') {
      expect(tent.world?.[12]).toBeCloseTo(7);
      expect(tent.world?.[13]).toBeCloseTo(3.18);
      expect(tent.world?.[14]).toBeCloseTo(-2);
    }

    field.update([camp], () => true, () => 3);
    const afterEmptying = graph.nodes.filter((node) => node.kind === 'mesh' && node.visible);
    expect(afterEmptying.length).toBe(visible.length - 1);

    field.update([], () => false, () => 0);
    expect(graph.nodes.filter((node) => node.kind === 'mesh' && node.visible)).toHaveLength(0);
    field.dispose();
    expect(graph.nodes).toHaveLength(0);
  });

  it('draws the whole camp when a slot that was drawn hidden is shown again', () => {
    const scene = new THREE.Scene();
    const graph = new SceneGraph(0);
    graph.camera = { projection: new THREE.Matrix4().toArray(), world: new THREE.Matrix4().toArray(), orthographic: true };
    const webgl = new MountedThreePipeline(scene, () => {}, graph);
    const field = new CampField(scene, graph);
    // the pool is built hidden, and a frame goes out before there is any camp to show
    webgl.draw(graph.frame());
    expect(drawn(scene)).toHaveLength(0);

    field.update([{ x: 7, z: -2, ruined: false }], () => false, () => 3);
    webgl.draw(graph.frame());
    // tent, ridgepole, seven stones, the dead fire and the bundle — not the bundle on its own
    expect(drawn(scene)).toHaveLength(11);

    field.update([], () => false, () => 0);
    webgl.draw(graph.frame());
    field.update([{ x: 7, z: -2, ruined: true }], () => true, () => 3);
    webgl.draw(graph.frame());
    expect(drawn(scene)).toHaveLength(10);
    field.dispose();
  });
});
