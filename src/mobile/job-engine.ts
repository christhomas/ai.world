import './host-globals';
import { ChunkMesher } from '../workers/chunkmesher';
import { answerCountry } from '../world/country-answer';
import { decodeJob, encodeJob, type JobCommand, type JobReply } from './job-wire';

/** The second bundled context, owned by one game and run on its own native thread. */
export function create(_session: string): { request(text: string): string } {
  const meshers = new Map<number, ChunkMesher>();
  let messages: JobReply['messages'] = [];
  let sequence = 0;
  return {
    request(text) {
      const command = decodeJob<JobCommand>(text);
      const started = Date.now();
      messages = [];
      let error: string | undefined;
      try {
        if (!Number.isSafeInteger(command.id) || command.id < 1 || !Number.isSafeInteger(command.sequence)
          || command.sequence <= sequence || (command.kind !== 'chunks' && command.kind !== 'country')) {
          throw new Error('Invalid or out-of-order job command');
        }
        sequence = command.sequence;
        if (command.type === 'close') {
          meshers.get(command.id)?.dispose();
          meshers.delete(command.id);
        } else if (command.type !== 'message') throw new Error('Unknown job command');
        else if (command.kind === 'country') {
          const reply = answerCountry(command.message, Date.now);
          if (reply) messages.push(reply);
        } else {
          let mesher = meshers.get(command.id);
          if (!mesher) {
            if (meshers.size >= 1) throw new Error('Ground job capacity reached');
            mesher = new ChunkMesher((reply) => messages.push(reply));
            meshers.set(command.id, mesher);
          }
          mesher.receive(command.message);
        }
      } catch (failure) {
        messages = [];
        error = String(failure);
      }
      const reply = encodeJob({ id: command.id, sequence: command.sequence, kind: command.kind,
        messages, took: Date.now() - started, ...(error === undefined ? {} : { error }) } satisfies JobReply);
      // The context keeps its samplers, but not the last chunk's geometry as well as the game's.
      messages = [];
      return reply;
    },
  };
}
