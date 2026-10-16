import { ChunkMesher } from './chunkmesher';
import type { WorkerRequest } from '../world/messages';

const jobs = new ChunkMesher((reply, transfer) => (self as unknown as Worker).postMessage(reply, transfer));
self.onmessage = (event: MessageEvent<WorkerRequest>) => jobs.receive(event.data);
