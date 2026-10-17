import { describe, expect, it } from 'vitest';
import { ChunkMesher } from './chunkmesher';
import { generateRoadGraph } from '../world/roadtree';
import { TerrainSampler } from '../world/terrain';
import { buildChunkMesh } from '../world/mesher';
import { tilesOf } from '../world/tiles';
import { propsOf } from '../world/propstream';
import { packChunk } from '../world/chunkparcel';
import { Tellings, boundsOf } from '../world/patchwork';
import { partsOf, samplerIn } from '../world/endless';
import { PATCHES_PER_WORKER, type WorkerRequest, type WorkerResponse } from '../world/messages';

const sampler = new TerrainSampler(generateRoadGraph(7));
const init: WorkerRequest = { type: 'init', seed: sampler.seed, graph: sampler.graph,
  hydro: sampler.hydro, structures: sampler.structures };
function endpoint() {
  const replies: WorkerResponse[] = [], transfers: Transferable[][] = [];
  const jobs = new ChunkMesher((reply, transfer) => { replies.push(reply); transfers.push(transfer); });
  jobs.receive(init);
  expect(replies).toEqual([{ type: 'ready' }]);
  return { jobs, replies, transfers };
}
function populated(reply: WorkerResponse): Extract<WorkerResponse, { empty: false }> {
  expect(reply.type).toBe('chunk');
  if (reply.type !== 'chunk' || reply.empty) throw new Error('Expected populated terrain');
  return reply;
}

describe('production terrain jobs without a browser worker', () => {
  it('preserves real generated geometry, collision tiles and all nine prop scalars', () => {
    const { jobs, replies, transfers } = endpoint();
    const chunk = sampler.generateChunk(0, 0);
    const expected = buildChunkMesh(chunk, sampler.seed);
    expect(expected.land?.indices.length).toBeGreaterThan(0);
    const props = [...propsOf(chunk, sampler.seed)];
    expect(props.length).toBeGreaterThan(0);
    jobs.receive({ type: 'gen', id: 3, cx: 0, cz: 0 });
    const reply = populated(replies[1]);
    expect(reply).toMatchObject({ id: 3, cx: 0, cz: 0, grown: true });
    expect(reply.mesh).toEqual(expected.land);
    expect(reply.water).toEqual(expected.water);
    expect(reply).toMatchObject(tilesOf(chunk));
    expect(reply.props).toEqual(Float32Array.from(props.flatMap(p =>
      [p.kind, p.x, p.y, p.z, p.rot, p.scale, p.stretch, p.lean, p.tint])));
    const arrays = [reply.mesh.positions, reply.mesh.normals, reply.mesh.colors, reply.mesh.indices,
      reply.props, reply.heights, reply.types, reply.waters, reply.biomes,
      ...(reply.water ? [reply.water.positions, reply.water.normals, reply.water.colors, reply.water.indices,
        ...(reply.water.flow ? [reply.water.flow] : [])] : [])];
    expect(transfers[1]).toEqual(arrays.map(array => array.buffer));
    expect(new Set(transfers[1]).size).toBe(transfers[1].length);
  });

  it('meshes changed authoritative tiles instead of regenerating them locally', () => {
    const { jobs, replies } = endpoint();
    const chunk = sampler.generateChunk(0, 0);
    chunk.height[chunk.size + 1] += 5;
    chunk.corners.fill(8, (chunk.size + 1) * 4, (chunk.size + 2) * 4);
    jobs.receive({ type: 'mesh', id: 4, cx: 0, cz: 0, chunk: packChunk(chunk) });
    const reply = populated(replies[1]);
    expect(reply.grown).toBe(false);
    expect(reply.heights[0]).toBe(chunk.height[chunk.size + 1]);
    expect(reply.mesh).toEqual(buildChunkMesh(chunk, sampler.seed).land);
    expect(reply.mesh).not.toEqual(buildChunkMesh(sampler.generateChunk(0, 0), sampler.seed).land);
  });

  it('keeps patch samplers bounded and clears them when another world initializes', () => {
    const { jobs, replies } = endpoint();
    const within = boundsOf('0,0');
    const parts = partsOf(samplerIn(7, within));
    for (let i = 0; i <= PATCHES_PER_WORKER; i++) {
      jobs.receive({ type: 'patch', patch: `patch:${i}`, seed: 7, within, ...parts });
    }
    // the oldest has gone, and a chunk painted from it is said to be lost rather than never answered
    jobs.receive({ type: 'gen', id: 1, cx: 0, cz: 0, patch: 'patch:0' });
    expect(replies[1]).toEqual({ type: 'lost', id: 1, cx: 0, cz: 0, patch: 'patch:0' });
    jobs.receive({ type: 'gen', id: 2, cx: 0, cz: 0, patch: `patch:${PATCHES_PER_WORKER}` });
    expect(replies[2]).toMatchObject({ type: 'chunk', id: 2 });
    jobs.receive(init);
    jobs.receive({ type: 'gen', id: 3, cx: 0, cz: 0, patch: `patch:${PATCHES_PER_WORKER}` });
    expect(replies.slice(3)).toEqual([{ type: 'ready' }, { type: 'lost', id: 3, cx: 0, cz: 0, patch: `patch:${PATCHES_PER_WORKER}` }]);
  });

  it('hands a world\'s bytes back with a chunk it could not paint, so they are not lost with it', () => {
    const { jobs, replies, transfers } = endpoint();
    const chunk = packChunk(sampler.generateChunk(0, 0));
    jobs.receive({ type: 'mesh', id: 4, cx: 0, cz: 0, chunk, patch: 'never-told' });
    expect(replies[1]).toEqual({ type: 'lost', id: 4, cx: 0, cz: 0, patch: 'never-told', chunk });
    expect(transfers[1]).toEqual([chunk]);
  });

  it('drops the square the main thread drops, whatever order they are told and painted from in', () => {
    /*
     * The main thread decides from `Tellings` whether a worker must be told about a square before a
     * chunk is painted from it; the worker keeps its own few and drops one when told a new one. They
     * have to drop the same one. They did not: a square painted from again was the newest to the main
     * thread and still the oldest here, so it went, and the next chunk from it was never answered —
     * one worker at a time, until on 2026-10-17 there were none and the hero stood on nothing.
     */
    const { jobs, replies } = endpoint();
    const told = new Tellings<string>(PATCHES_PER_WORKER);
    const within = boundsOf('0,0');
    const parts = partsOf(samplerIn(7, within));
    let state = 7, id = 10;
    for (let n = 0; n < 60; n++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const patch = `patch:${state % 7}`;
      if (told.needs('worker', patch)) jobs.receive({ type: 'patch', patch, seed: 7, within, ...parts });
      jobs.receive({ type: 'gen', id: ++id, cx: 0, cz: 0, patch });
    }
    expect(replies.filter((reply) => reply.type === 'lost')).toEqual([]);
    expect(replies.filter((reply) => reply.type === 'chunk')).toHaveLength(60);
  });

  it('ignores every retained request after disposal, including a new init', () => {
    const { jobs, replies } = endpoint();
    jobs.dispose(); jobs.dispose();
    jobs.receive(init);
    jobs.receive({ type: 'gen', id: 1, cx: 0, cz: 0 });
    jobs.receive({ type: 'mesh', id: 2, cx: 0, cz: 0, chunk: packChunk(sampler.generateChunk(0, 0)) });
    expect(replies).toEqual([{ type: 'ready' }]);
  });
});
