import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { MountedThreePipeline, submitGraphFrame } from './pipeline';
import { EntityRenderer } from './entities';
import { Entity, Herd } from '../entities/entity';
import { KINDS } from '../entities/animals';
import { mulberry32 } from '../core/rng';

/**
 * What the live mount costs a frame in which nothing changed: nothing.
 *
 * The scene graph drives the draw, so every mount runs every frame. A mount that writes a flag or
 * marks a buffer dirty whether or not anything moved turns a still frame into a full upload, and
 * nothing in a picture shows it — the pixels are the same, only the frame is slower.
 */
const camera = {
  projection: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.002, 0, 0, 0, -1, 1],
  world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
  orthographic: true,
};

function sheepPools() {
  const graph = new SceneGraph(0x102030);
  graph.camera = camera;
  const scene = new THREE.Scene();
  const renderer = new EntityRenderer(scene, graph);
  const kind = KINDS.sheep;
  const sheep = new Entity(kind, 4, 6, new Herd(kind, 4, 6, 4, 6, 0), 'test', mulberry32(2));
  renderer.add(sheep);
  renderer.update();
  const pools = scene.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const mounted = new MountedThreePipeline(scene, () => {}, graph);
  return { graph, renderer, sheep, pools, draw: () => submitGraphFrame(graph, [mounted]) };
}

describe('an instanced pool the frame did not change', () => {
  it('stays hidden when it is empty', () => {
    const { renderer, sheep, pools, draw } = sheepPools();
    expect(pools.length).toBeGreaterThan(0);
    renderer.remove(sheep);
    renderer.update();
    // the precondition: the pools really are empty and their producer really did hide them
    for (const pool of pools) expect([pool.count, pool.visible]).toEqual([0, false]);
    const versions = pools.map((pool) => pool.instanceMatrix.version);
    draw();
    draw();
    for (const pool of pools) expect([pool.count, pool.visible]).toEqual([0, false]);
    expect(pools.map((pool) => pool.instanceMatrix.version)).toEqual(versions);
    renderer.dispose();
  });

  it('is not uploaded again by the mount when its producer has already posted it', () => {
    const { renderer, pools, draw } = sheepPools();
    expect(pools.some((pool) => pool.count > 0)).toBe(true);
    const versions = pools.map((pool) => pool.instanceMatrix.version);
    const colours = pools.map((pool) => pool.instanceColor?.version);
    draw();
    draw();
    draw();
    expect(pools.map((pool) => pool.instanceMatrix.version)).toEqual(versions);
    expect(pools.map((pool) => pool.instanceColor?.version)).toEqual(colours);
    for (const pool of pools) expect(pool.visible).toBe(pool.count > 0);
    renderer.dispose();
  });
});
