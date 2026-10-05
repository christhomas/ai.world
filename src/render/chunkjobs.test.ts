import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from '../core/scenegraph';
import { ChunkManager } from './chunkManager';
import { PropLibrary } from './props';
import { TerrainSampler } from '../world/terrain';
import { generateRoadGraph } from '../world/roadtree';
import { ChunkMesher } from '../workers/chunkmesher';
import type { WorkerRequest, WorkerResponse } from '../world/messages';
import type { ChunkJobHost } from '../world/chunkjobs';

const sampler = new TerrainSampler(generateRoadGraph(7));
function mounted(concurrency = 1) {
  let now = 0;
  const callbacks: Array<(reply: WorkerResponse) => void> = [];
  const posts: WorkerRequest[] = [];
  const engines: ChunkMesher[] = [];
  const terminations = vi.fn();
  const jobs: ChunkJobHost = { concurrency, now: () => now, create(receive) {
    callbacks.push(receive);
    const engine = new ChunkMesher(receive); engines.push(engine);
    return { postMessage(message) { posts.push(message); }, terminate: terminations };
  } };
  const graph = new SceneGraph(0), scene = new THREE.Scene(), props = new PropLibrary();
  const water = new THREE.MeshBasicMaterial(), glow = new THREE.MeshBasicMaterial();
  const chunks = new ChunkManager(scene, graph, sampler, props, water, glow, undefined, undefined, jobs);
  const drain = () => { while (posts.length) engines[0].receive(posts.shift()!); };
  const cleanup = () => { try { chunks.dispose(); } finally { props.dispose(); water.dispose(); glow.dispose(); } };
  return { chunks, graph, scene, posts, callbacks, terminations, drain, cleanup, time: (value: number) => { now = value; } };
}

describe('owned host chunk jobs', () => {
  it('attempts every job cleanup even when one native termination throws', () => {
    const test = mounted(2);
    test.terminations.mockImplementationOnce(() => { throw new Error('native queue failed'); });
    expect(test.cleanup).toThrow(AggregateError);
    expect(test.terminations).toHaveBeenCalledTimes(2);
    for (const callback of test.callbacks) callback({ type: 'ready' });
    test.chunks.dispose();
    expect(test.terminations).toHaveBeenCalledTimes(2);
    expect(test.chunks.grownDetails().idle).toBe(0);
  });
  it('uses injected jobs and time to draw real terrain without browser worker globals', () => {
    const test = mounted();
    try {
      test.drain(); test.chunks.update(0, 0);
      expect(test.posts).toHaveLength(0);
      test.time(201); test.chunks.update(0, 0); test.drain();
      expect(test.chunks.getTiles(0, 0)).not.toBeNull();
      expect(test.chunks.stats.drawn).toBeGreaterThan(0);
      expect(test.graph.nodes.some(node => node.kind === 'mesh' && node.geometry.positions.length > 0)).toBe(true);
      expect(test.chunks.captureProgress().pending).toBe(0);
    } finally { test.cleanup(); }
  });

  it('retired job callbacks cannot refill the pool or mount terrain after disposal', () => {
    const test = mounted();
    test.drain(); test.chunks.update(0, 0); test.time(201); test.chunks.update(0, 0);
    const request = test.posts.find(message => message.type === 'gen');
    expect(request?.type).toBe('gen');
    if (!request || request.type !== 'gen') throw new Error('Expected queued terrain work');
    test.cleanup();
    test.callbacks[0]({ type: 'ready' });
    test.callbacks[0]({ type: 'chunk', id: request.id, cx: request.cx, cz: request.cz, empty: true, grown: true });
    test.chunks.update(16, 0); test.chunks.deliver(0, 0, new ArrayBuffer(1)); test.chunks.resume();
    expect(test.terminations).toHaveBeenCalledTimes(1);
    expect(test.graph.nodes).toHaveLength(0);
    expect(test.chunks.captureProgress().loaded).toBe(0);
    expect(test.chunks.captureProgress().pending).toBe(0);
    expect(test.chunks.grownDetails().idle).toBe(0);
  });
});
