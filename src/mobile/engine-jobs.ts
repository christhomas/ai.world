import type { ChunkJobHost } from '../world/chunkjobs';
import type { CountryGrowthJob } from '../world/country-jobs';
import type { WorkerResponse } from '../world/messages';
import type { CountryReply } from '../world/countrymessages';
import type { JobTimes } from '../platform/headless-game';
import { decodeJob, encodeJob, type JobCommand, type JobReply } from './job-wire';

interface OwnedJob {
  kind: JobReply['kind'];
  receive(message: WorkerResponse | CountryReply): void;
  failed(message: string): void;
  pending: Set<number>;
}

/**
 * The game's end of its native jobs context. Sending only queues data; neither creating a job nor
 * moving the game clock runs CPU work. The app delivers replies before a later game request.
 */
export class EngineJobs {
  private nextId = 0;
  private sequence = 0;
  private retired = false;
  private readonly live = new Map<number, OwnedJob>();
  private outgoing: { id: number; text: string }[] = [];
  readonly times: JobTimes = {};

  constructor(private readonly now: () => number) {}

  readonly chunks: ChunkJobHost = {
    concurrency: 1,
    now: () => this.now(),
    create: (receive) => {
      const id = this.own('chunks', (message) => receive(message as WorkerResponse),
        (message) => { throw new Error(`Ground job failed: ${message}`); });
      return {
        postMessage: (message) => this.send({ id, sequence: ++this.sequence, kind: 'chunks', type: 'message', message }),
        terminate: () => this.close(id),
      };
    },
  };

  country(): CountryGrowthJob {
    let listening: ((message: CountryReply) => void) | null = null;
    let failed: (() => void) | null = null;
    const id = this.own('country', (message) => listening?.(message as CountryReply), () => failed?.());
    return {
      send: (message) => this.send({ id, sequence: ++this.sequence, kind: 'country', type: 'message', message }),
      listen: (reply, failure) => {
        listening = reply; failed = failure;
        return () => { listening = null; failed = null; };
      },
      stop: () => { listening = null; failed = null; this.close(id); },
    };
  }

  take(): string[] {
    const commands = this.outgoing.map((command) => command.text);
    this.outgoing = [];
    return commands;
  }

  deliver(text: string): void {
    if (this.retired) return;
    for (const reply of decodeJob<JobReply[]>(text)) {
      const job = this.live.get(reply.id);
      if (!job || job.kind !== reply.kind || !job.pending.delete(reply.sequence)) continue;
      const time = (this.times[reply.kind] ??= { runs: 0, ms: 0, longest: 0 });
      time.runs++;
      time.ms += reply.took;
      time.longest = Math.max(time.longest, reply.took);
      if (reply.error !== undefined) job.failed(reply.error);
      else for (const message of reply.messages) {
        if (this.live.get(reply.id) !== job) break;
        job.receive(message);
      }
    }
  }

  dispose(): void {
    this.retired = true;
    this.live.clear();
    this.outgoing = [];
  }

  private own(kind: OwnedJob['kind'], receive: OwnedJob['receive'], failed: OwnedJob['failed']): number {
    if (this.retired) throw new Error('Game jobs retired');
    const id = ++this.nextId;
    this.live.set(id, { kind, receive, failed, pending: new Set() });
    return id;
  }

  private send(command: JobCommand): void {
    const job = this.live.get(command.id);
    if (this.retired || !job) return;
    job.pending.add(command.sequence);
    // Match postMessage's snapshot: later mutations in the game cannot change an already sent job.
    this.outgoing.push({ id: command.id, text: encodeJob(command) });
  }

  private close(id: number): void {
    const job = this.live.get(id);
    if (!job) return;
    this.live.delete(id);
    // Work still on this side of the bridge need not be done just to throw its answer away.
    this.outgoing = this.outgoing.filter((command) => command.id !== id);
    this.outgoing.push({ id, text: encodeJob({ id, sequence: ++this.sequence, kind: job.kind, type: 'close' }) });
  }
}
