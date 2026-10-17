// The proof's counterpart of an Owned executor / JSC queue. Only wire strings cross this thread.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

if (!isMainThread) {
  const bare = { crypto: { randomUUID } };
  runInNewContext(workerData.source, bare, { timeout: 120000 });
  runInNewContext("globalThis.engine = AiWorldJobEngine.create('bare-jobs')", bare);
  parentPort.on('message', (text) => {
    bare.__request = text;
    parentPort.postMessage(runInNewContext('engine.request(__request)', bare, { timeout: 120000 }));
  });
  parentPort.postMessage('ready');
}

export async function jobThread(source) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { source } });
  let failure;
  let inbox = [];
  const meshes = new Set();
  let completed = 0;
  const ready = new Promise((resolve, reject) => {
    worker.on('error', (error) => { failure = error; reject(error); });
    worker.on('message', (text) => {
      if (text === 'ready') { resolve(); return; }
      const reply = JSON.parse(text);
      meshes.delete(reply.sequence);
      completed++;
      inbox.push(text);
    });
  });
  await ready;
  // A failed assertion in the main proof must not leave a thread keeping the process alive.
  worker.unref();
  return {
    get pendingMeshes() { return meshes.size; },
    get completed() { return completed; },
    take() {
      if (failure) throw failure;
      const replies = inbox;
      inbox = [];
      return replies.length ? `[${replies.join(',')}]` : null;
    },
    send(commands) {
      for (const text of commands ?? []) {
        const command = JSON.parse(text);
        if (command.kind === 'chunks' && ['gen', 'mesh'].includes(command.message?.type)) meshes.add(command.sequence);
        worker.postMessage(text);
      }
    },
    close() { return worker.terminate(); },
  };
}
