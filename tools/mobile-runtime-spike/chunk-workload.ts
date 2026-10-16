import { ChunkMesher } from '../../src/workers/chunkmesher';
import { packChunk } from '../../src/world/chunkparcel';
import type { ChunkData } from '../../src/world/ground';
import type { WorkerResponse } from '../../src/world/messages';

/** Bounded native CPU proof; the installed render/session composition remains separate. */
export function chunkWorkload(chunk: ChunkData, hash: (text: string) => string): string {
  const replies: WorkerResponse[] = [];
  let transferred = 0;
  const jobs = new ChunkMesher((reply, transfer) => { replies.push(reply); transferred += transfer.length; });
  jobs.receive({ type: 'init', seed: 1, graph: {
    seed: 1, radius: 100, nodes: [], edges: [], towns: [], islands: [], mainlandNodes: 0,
    sectors: [0], sectorOffset: 0,
  }, hydro: { rivers: [], lakes: [] }, structures: {
    doors: [], villages: [], pois: [], all: [], piers: [], signposts: [], caves: [], wrecks: [], derelicts: [], castles: [],
  } });
  jobs.receive({ type: 'mesh', id: 1, cx: chunk.cx, cz: chunk.cz, chunk: packChunk(chunk) });
  const reply = replies[1];
  if (reply?.type !== 'chunk' || reply.empty || reply.grown || reply.mesh.indices.length === 0 || transferred < 9) {
    throw new Error('Native production terrain job did not return owned authoritative mesh buffers');
  }
  jobs.dispose(); jobs.receive({ type: 'gen', id: 2, cx: 0, cz: 0 });
  if (replies.length !== 2) throw new Error('Disposed native terrain job answered retained work');
  return hash(JSON.stringify({ positions: Array.from(reply.mesh.positions), indices: Array.from(reply.mesh.indices),
    props: Array.from(reply.props), heights: Array.from(reply.heights), transferred }));
}
