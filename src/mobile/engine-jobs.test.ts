import { describe, expect, it } from 'vitest';
import { EngineJobs } from './engine-jobs';
import { create } from './job-engine';
import { decodeJob, encodeJob, type JobReply } from './job-wire';
import { StepClock } from './host-globals';
import { ChunkMesher } from '../workers/chunkmesher';
import { TerrainSampler } from '../world/terrain';
import { generateRoadGraph } from '../world/roadtree';
import { packChunk } from '../world/chunkparcel';
import { answerCountry } from '../world/country-answer';
import { rebuildPatch } from '../world/endless';
import { boundsOf } from '../world/patchwork';
import type { WorkerRequest, WorkerResponse } from '../world/messages';
import type { CountryReply, CountryRequest } from '../world/countrymessages';

const sampler = new TerrainSampler(generateRoadGraph(7));
const init: WorkerRequest = { type: 'init', seed: sampler.seed, graph: sampler.graph,
  hydro: sampler.hydro, structures: sampler.structures };

describe('installed game jobs in a separate context', () => {
  it('does no meshing on a game turn, then returns the worker geometry and collision bytes', () => {
    const clock = new StepClock();
    const jobs = new EngineJobs(() => clock.now());
    const received: WorkerResponse[] = [];
    const job = jobs.chunks.create((reply) => received.push(reply));
    const chunk = sampler.generateChunk(0, 0);
    chunk.height[chunk.size + 1] += 5;
    chunk.corners.fill(8, (chunk.size + 1) * 4, (chunk.size + 2) * 4);
    const mesh: WorkerRequest = { type: 'mesh', id: 9, cx: 0, cz: 0, chunk: packChunk(chunk) };
    job.postMessage(init);
    job.postMessage(mesh);
    clock.advanceTo(1000);
    expect(received).toEqual([]);

    const worker = create('jobs');
    const commands = jobs.take();
    expect(commands).toHaveLength(2);
    const replies = commands.map((command) => worker.request(command));
    expect(received).toEqual([]);
    jobs.deliver(`[${replies.join(',')}]`);
    const expected: WorkerResponse[] = [];
    const direct = new ChunkMesher((reply) => expected.push(reply));
    direct.receive(init);
    direct.receive(mesh);
    expect(received).toEqual(expected);
    expect(received[1]).toMatchObject({ type: 'chunk', empty: false, grown: false });
    if (received[1].type === 'chunk' && !received[1].empty) expect(received[1].heights[0]).toBe(chunk.height[chunk.size + 1]);
    // Every array is compared above, including Uint32 indices and the authoritative collision data.
    expect(jobs.times.chunks.runs).toBe(2);
    jobs.deliver(`[${replies.join(',')}]`);
    expect(received).toHaveLength(2);
    direct.dispose();
    job.terminate();
  });

  it('returns the same grown parts as the country worker and rebuilds them into ground', () => {
    const jobs = new EngineJobs(() => 0);
    const worker = create('country');
    const received: CountryReply[] = [];
    const job = jobs.country();
    job.listen((reply) => received.push(reply), () => { throw new Error('Unexpected job failure'); });
    const request: CountryRequest = { type: 'grow', seed: 7, patch: '0,0', layers: [], terrain: [] };
    job.send(request);
    expect(received).toEqual([]);
    jobs.deliver(`[${worker.request(jobs.take()[0])}]`);
    const reply = received[0];
    const expected = answerCountry(request, () => 0);
    expect({ ...reply, took: 0 }).toEqual(expected);
    if (reply.type !== 'grown') throw new Error('Expected a grown patch');
    const rebuilt = rebuildPatch(7, boundsOf('0,0'), reply.parts);
    expect(rebuilt.generateChunk(0, 0).height.length).toBeGreaterThan(0);
    const chunks: WorkerResponse[] = [];
    const ground = jobs.chunks.create((message) => chunks.push(message));
    const patch: WorkerRequest = { type: 'patch', patch: '0,0', seed: 7, within: boundsOf('0,0'), ...reply.parts };
    const gen: WorkerRequest = { type: 'gen', patch: '0,0', id: 10, cx: 0, cz: 0 };
    ground.postMessage(patch);
    ground.postMessage(gen);
    jobs.deliver(`[${jobs.take().map((command) => worker.request(command)).join(',')}]`);
    const expectedChunks: WorkerResponse[] = [];
    const direct = new ChunkMesher((message) => expectedChunks.push(message));
    direct.receive(patch);
    direct.receive(gen);
    expect(chunks).toEqual(expectedChunks);
    expect(chunks[0]).toMatchObject({ type: 'chunk', id: 10 });
    direct.dispose();
    ground.terminate();
    job.stop();
  });

  it('sends lost authoritative bytes back intact', () => {
    const jobs = new EngineJobs(() => 0);
    const worker = create('lost');
    const received: WorkerResponse[] = [];
    const job = jobs.chunks.create((reply) => received.push(reply));
    const bytes = packChunk(sampler.generateChunk(0, 0));
    job.postMessage({ type: 'mesh', id: 4, cx: 0, cz: 0, patch: 'missing', chunk: bytes });
    jobs.deliver(`[${worker.request(jobs.take()[0])}]`);
    expect(received).toEqual([{ type: 'lost', id: 4, cx: 0, cz: 0, patch: 'missing', chunk: bytes }]);
    job.terminate();
  });

  it('fences disposed owners, drops unsent work and releases a mesher before its successor', () => {
    const jobs = new EngineJobs(() => 0);
    const worker = create('owned');
    const received: WorkerResponse[] = [];
    const first = jobs.chunks.create((reply) => received.push(reply));
    first.postMessage(init);
    const late = worker.request(jobs.take()[0]);
    first.postMessage({ type: 'gen', id: 1, cx: 0, cz: 0 });
    first.terminate();
    first.terminate();
    jobs.deliver(`[${late}]`);
    expect(received).toEqual([]);
    const second = jobs.chunks.create((reply) => received.push(reply));
    second.postMessage(init);
    const commands = jobs.take();
    expect(commands.map((command) => JSON.parse(command).type)).toEqual(['close', 'message']);
    jobs.deliver(`[${commands.map((command) => worker.request(command)).join(',')}]`);
    expect(received).toEqual([{ type: 'ready' }]);
    jobs.dispose();
    second.postMessage({ type: 'gen', id: 2, cx: 0, cz: 0 });
    jobs.deliver(`[${late}]`);
    expect(jobs.take()).toEqual([]);
    expect(() => jobs.country()).toThrow('retired');
  });

  it('reports country failure once and throws a ground failure instead of leaving a busy slot', () => {
    const jobs = new EngineJobs(() => 0);
    let failed = 0;
    const country = jobs.country();
    country.listen(() => { throw new Error('Unexpected reply'); }, () => { failed++; country.stop(); });
    country.send({ type: 'grow', seed: 7, patch: '0,0', layers: [], terrain: [] });
    const command = JSON.parse(jobs.take()[0]);
    const failure: JobReply = { ...command, messages: [], took: 1, error: 'interrupted' };
    jobs.deliver(encodeJob([failure]));
    jobs.deliver(encodeJob([failure]));
    expect(failed).toBe(1);
    const ground = jobs.chunks.create(() => {});
    ground.postMessage(init);
    const ask = JSON.parse(jobs.take().at(-1)!);
    expect(() => jobs.deliver(encodeJob([{ ...ask, messages: [], took: 1, error: 'out of memory' }]))).toThrow('Ground job failed');
  });
});

describe('the job wire', () => {
  it('preserves buffer and typed view bytes, including NaNs, infinities and subarray boundaries', () => {
    const floats = new Float32Array([9, NaN, Infinity, -Infinity, -0, 8]);
    const value = { floats: floats.subarray(1, 5), indices: new Uint32Array([0, 0xffffffff]),
      owners: new Int32Array([-1, 7]), types: new Uint8Array([0, 255]), parcel: floats.buffer,
      scalars: [NaN, Infinity, -Infinity, -0] };
    const roundtrip = decodeJob<typeof value>(encodeJob(value));
    expect(roundtrip).toEqual(value);
    expect(new Uint8Array(roundtrip.floats.buffer)).toEqual(new Uint8Array(floats.buffer, 4, 16));
    expect(roundtrip.floats.byteOffset).toBe(0);
    expect(roundtrip.floats.buffer.byteLength).toBe(16);
  });
});
