import {
  ContentError, fingerprint, inventory, withChanges, type ContentRecord, type ContentWire,
} from '../core/content';
import { DEFAULT_CONTENT } from '../core/contentDefaults';
import { readContent } from './contentCheck';
import { installMotion } from './motion';
import { MODELS, installModels } from './models';
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
 *
 * Returns the creatures whose bodies changed, which is what a renderer has to build again: the
 * parts a creature is drawn with are turned into meshes once, when its first one is drawn.
 */
export function installContent(records: readonly ContentRecord[]): string[] {
  const copied = records.map((record) => ({ ...record, body: structuredClone(record.body) }));
  const { problems, read } = readContent(copied);
  if (!read) throw new ContentError('content install', problems.join('; ') || 'the revision could not be read');
  const drawn = new Map(Object.entries(MODELS).map(([id, parts]) => [id, JSON.stringify(parts)]));
  installMotion(read.motion);
  installModels(read.models);
  installProperties(read.properties, read.people, read.tuning);
  installBehaviours(read.behaviourFiles, read.trees);
  rebuildKinds();
  installSpawning(read.spawning);
  installSpawns(read.spawns);
  const ids = new Set([...drawn.keys(), ...Object.keys(MODELS)]);
  return [...ids].filter((id) => drawn.get(id) !== (MODELS[id] ? JSON.stringify(MODELS[id]) : undefined));
}

let bundled: { records: ContentRecord[]; print: string } | null = null;
const theBundle = (): { records: ContentRecord[]; print: string } => {
  if (!bundled) {
    const records = inventory(DEFAULT_CONTENT);
    bundled = { records, print: fingerprint(records) };
  }
  return bundled;
};

/** The fingerprint of the content this build carries, which a client says as it joins a world. */
export function bundledContent(): string {
  return theBundle().print;
}

/**
 * Install what a server says it runs: its changes laid over this build's own bundle.
 *
 * Returns the creatures whose bodies changed, for the renderer to build again, or null when the
 * server's changes are relative to a different bundle. That page is a different build from its
 * server and can only be put right by loading it again; laying another bundle's changes over this
 * one would be a third set of content that neither end runs.
 */
export function installFromServer(bundle: string, changed: readonly ContentWire[], deleted: readonly string[]): string[] | null {
  const own = theBundle();
  if (bundle !== own.print) return null;
  return installContent(withChanges(own.records, changed, deleted));
}
