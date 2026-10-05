import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createEntityScene, EntityRenderer } from './entities';
import { entityRendererFor } from './entities-mount';
import { attachSceneGraph } from './scenegraph';
import { SceneGraph } from '../core/scenegraph';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { mulberry32 } from '../core/rng';
import { entitySceneWorkload } from '../../tools/mobile-runtime-spike/entity-workload';

describe('portable production creature scenes', () => {
  it('matches every used animation and health-bar buffer in the production browser constructor', () => {
    const actual = entitySceneWorkload();
    const browser = entitySceneWorkload((graph, view) => {
      const scene = new THREE.Scene();
      Object.defineProperty(scene.userData, 'worldView', { get: view });
      return new EntityRenderer(scene, graph);
    });
    expect(actual).toBe(browser);
    const frames = JSON.parse(actual);
    expect(frames).toHaveLength(4);
    expect(frames[0].bars).toBe(1);
    expect(frames[0].nodes.some((node: { count: number }) => node.count > 0)).toBe(true);
    expect(frames[1].bars).toBe(0);
    expect(frames[3].count).toBe(2);
  });

  it('cannot recreate pooled buffers from an add or update after disposal', () => {
    const graph = new SceneGraph(0);
    const renderer = createEntityScene(graph);
    const kind = KINDS.wolf;
    const wolf = new Entity(kind, 0, 0, new Herd(kind, 0, 0, 0, 0, 0), 'retired', mulberry32(3));
    expect(renderer.add(wolf)).toBe(true);
    renderer.update();
    expect(graph.nodes.some(node => node.kind === 'instances' && node.count > 0)).toBe(true);
    renderer.dispose(); renderer.dispose();
    expect(wolf.slot).toBe(-1);
    expect(renderer.add(wolf)).toBe(false);
    renderer.update(); renderer.remove(wolf);
    expect(renderer.count).toBe(0);
    expect(renderer.pickables()).toEqual([]);
    expect(graph.nodes).toEqual([]);
    const next = createEntityScene(new SceneGraph(0));
    expect(next.add(wolf)).toBe(true);
    expect(renderer.add(wolf)).toBe(false);
    renderer.remove(wolf);
    expect(wolf.slot).toBe(0);
    expect(next.count).toBe(1);
    next.dispose();
  });

  it('keeps the browser mount using the same producer and owning neutral nodes', () => {
    const graph = new SceneGraph(0), scene = new THREE.Scene();
    const detach = attachSceneGraph(graph, scene);
    const renderer = entityRendererFor(graph);
    expect(renderer).toBeInstanceOf(EntityRenderer);
    expect(graph.nodes).toHaveLength(2); // Existing health-bar buffers.
    expect(scene.children).toHaveLength(2);
    renderer.dispose(); detach();
    expect(scene.children).toHaveLength(0);
    expect(graph.nodes).toHaveLength(0);
  });
});
