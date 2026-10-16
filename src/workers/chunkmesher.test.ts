import { describe, expect, it } from 'vitest';
import { ChunkMesher } from './chunkmesher';
import { generateRoadGraph } from '../world/roadtree';
import { TerrainSampler } from '../world/terrain';
import { buildChunkMesh } from '../world/mesher';
import { tilesOf } from '../world/tiles';
import { propsOf } from '../world/propstream';
import { packChunk } from '../world/chunkparcel';
import { boundsOf } from '../world/patchwork';
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
    jobs.receive({ type: 'gen', id: 1, cx: 0, cz: 0, patch: 'patch:0' });
    expect(replies).toHaveLength(1);
    jobs.receive({ type: 'gen', id: 2, cx: 0, cz: 0, patch: `patch:${PATCHES_PER_WORKER}` });
    expect(replies).toHaveLength(2);
    expect(replies[1]).toMatchObject({ type: 'chunk', id: 2 });
    jobs.receive(init);
    jobs.receive({ type: 'gen', id: 3, cx: 0, cz: 0, patch: `patch:${PATCHES_PER_WORKER}` });
    expect(replies).toHaveLength(3);
    expect(replies[2]).toEqual({ type: 'ready' });
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
