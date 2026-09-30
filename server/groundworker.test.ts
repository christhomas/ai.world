import { afterEach, describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { GroundWorker } from './groundworker';

/**
 * A ground worker that goes wrong, and the requests made of it afterwards.
 *
 * The threads here are a few lines of script rather than the real bundle: what is under test is
 * what the simulation's side does when the thread dies or goes quiet, and a real patch would only
 * make that slower to find out.
 */
const DIES = "require('node:worker_threads').parentPort.once('message', () => process.exit(3));";
const SILENT = "require('node:worker_threads').parentPort.on('message', () => {});";
const ANSWERS = `const { parentPort } = require('node:worker_threads');
parentPort.on('message', (asked) => parentPort.postMessage({ id: asked.id, parts: { graph: 'grown ' + asked.patch } }));`;

describe('a ground worker that goes wrong', () => {
  const opened: GroundWorker[] = [];
  afterEach(async () => { for (const worker of opened.splice(0)) await worker.close(); });

  function workerOf(scripts: string[], timeout?: number) {
    let started = 0;
    const worker = new GroundWorker({
      start: () => new Worker(scripts[Math.min(started++, scripts.length - 1)], { eval: true }),
      timeout,
    });
    opened.push(worker);
    return { worker, started: () => started };
  }

  /** How a request ended, or `pending` if it had not by the deadline. */
  async function settled(asked: Promise<unknown>, ms = 3000): Promise<string> {
    return Promise.race([
      asked.then(() => 'resolved', (error: Error) => `rejected: ${error.message}`),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), ms)),
    ]);
  }

  it('refuses every request made after its thread died, rather than leaving them waiting', async () => {
    const { worker, started } = workerOf([DIES]);
    expect(await settled(worker.grow(1, '0,0', [], []))).toMatch(/rejected: .*code 3/);
    expect(await settled(worker.grow(1, '1,0', [], [])), 'the second ask, to a thread already gone').toMatch(/^rejected/);
    expect(started(), 'each ask went to a thread that was alive when it was sent').toBe(2);
  });

  it('starts a new thread after one dies, and the next request is answered', async () => {
    const { worker, started } = workerOf([DIES, ANSWERS]);
    expect(await settled(worker.grow(1, '0,0', [], []))).toMatch(/^rejected/);
    await expect(worker.grow(1, '1,0', [], [])).resolves.toEqual({ graph: 'grown 1,0' });
    expect(started()).toBe(2);
  });

  it('gives up on a thread that never answers, and replaces it', async () => {
    // Long enough for a fresh thread to start and answer on the Pi, short enough to wait out here.
    const { worker, started } = workerOf([SILENT, ANSWERS], 2000);
    expect(await settled(worker.grow(1, '0,0', [], []), 6000)).toMatch(/rejected: .*longer than 2000 ms/);
    await expect(worker.grow(1, '1,0', [], [])).resolves.toEqual({ graph: 'grown 1,0' });
    expect(started(), 'the silent thread was replaced rather than asked again').toBe(2);
  });
});
