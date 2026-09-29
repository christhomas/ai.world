import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGraph } from '../core/scenegraph';
import { CampField } from './wildcamps';

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
});
