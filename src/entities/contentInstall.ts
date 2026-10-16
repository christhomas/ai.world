import { ContentError, type ContentRecord } from '../core/content';
import { readContent } from './contentCheck';
import { installMotion } from './motion';
import { installModels } from './models';
import { installProperties } from './properties';
import { installBehaviours } from './behaviours';
import { rebuildKinds } from './animals';
import { installSpawning } from './spawning';
import { installSpawns } from './spawns';

/**
 * Make the game run on a published content revision instead of the bundled JSON (#624).
 *
 * Everything is read and checked first, by the game's own readers, so a revision that would not
 * load is refused here with nothing changed. Only then is each table replaced, in place: the same
 * objects the rest of the game already holds — an entity's kind, a model's parts, a module's
 * re-export of a table — are given their new contents, rather than new objects being made that
 * nothing holds yet. A creature already in the world therefore walks at its new speed from its
 * next step, and decides with its new tree from its next tick.
 *
 * The bodies are copied before anything is read, so no installed table shares an object with the
 * records it came from — least of all with the bundled JSON a catalogue is seeded from.
 *
 * JavaScript runs one thing at a time, so a call between two ticks is between two ticks. What it
 * does not do is tell a client; a host that has clients sends them the revision as well.
 */
export function installContent(records: readonly ContentRecord[]): void {
  const copied = records.map((record) => ({ ...record, body: structuredClone(record.body) }));
  const { problems, read } = readContent(copied);
  if (!read) throw new ContentError('content install', problems.join('; ') || 'the revision could not be read');
  installMotion(read.motion);
  installModels(read.models);
  installProperties(read.properties, read.people, read.tuning);
  installBehaviours(read.behaviourFiles, read.trees);
  rebuildKinds();
  installSpawning(read.spawning);
  installSpawns(read.spawns);
}
