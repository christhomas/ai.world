import { assemble, type ContentKind, type ContentRecord } from '../core/content';
import { readModels } from './models';
import { readBehaviourTuning, readProperties } from './properties';
import { compileBehaviours, treeNameIn } from './behaviours';
import { BLOW_NAMES, readMotion } from './motion';
import { readSpawning } from './spawning';
import { readSpawns } from './spawns';

/**
 * Whether a proposed set of content records is one the game could run, asked with the game's own
 * readers.
 *
 * Every reader here is the one the game runs on its bundled files at load: the model reader, the
 * properties reader, the behaviour compiler with the verbs the game declares, the motion checks and
 * both halves of the spawning file. So a model with two shapes on one part, a misspelt verb, a
 * blow longer than four seconds or a spawn weight written as a word is refused before the content
 * catalogue publishes it (#624), with the same message the game would have died with at load.
 *
 * The readers only read: nothing in a record is ever run. A behaviour tree is data handed to a
 * compiler that knows a fixed vocabulary, which is what lets an edit be accepted from a browser.
 *
 * Returns every problem rather than the first, so whoever wrote the edit sees all of it at once.
 */
export function checkContent(records: readonly ContentRecord[]): string[] {
  const problems: string[] = [];
  const attempt = <T>(read: () => T): T | null => {
    try { return read(); } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const files = assemble(records);
  const filesOf = (kind: ContentKind): Record<string, unknown> => Object.fromEntries(
    [...new Set(records.filter((record) => record.kind === kind).map((record) => record.source))].sort()
      .map((source) => [source, files[source]]),
  );
  /** The one file a kind lives in. Somebody deleting every record of it is a problem, not a skip. */
  const fileOf = (kind: ContentKind): { json: unknown } | null => {
    const sources = Object.keys(filesOf(kind));
    if (sources.length === 1) return { json: files[sources[0]] };
    problems.push(`expected the ${kind} records to come from one file, found ${sources.length}`);
    return null;
  };

  const motionFile = fileOf('motion');
  const motion = motionFile && attempt(() => readMotion(motionFile.json));
  // A creature's blow is checked against the proposed motion file, so a blow added in the same edit
  // is usable and one removed is refused. If the motion file itself is broken, the game's own list
  // stands in rather than failing every creature a second time for the same mistake.
  const blows = motion ? Object.keys(motion.BLOWS) : BLOW_NAMES;
  const models = attempt(() => readModels(Object.fromEntries(records.filter((record) => record.kind === 'model')
    .map((record) => [record.id.slice('model:'.length), record.body]))));
  const properties = attempt(() => readProperties(filesOf('creature'), blows));
  const tuning = fileOf('tuning');
  if (tuning) attempt(() => readBehaviourTuning(tuning.json));
  const trees = attempt(() => compileBehaviours(filesOf('behaviour')));
  const spawning = fileOf('spawning');
  if (spawning) {
    attempt(() => readSpawning(spawning.json));
    attempt(() => readSpawns(spawning.json, (kind) => properties?.[kind]?.damage ?? 0));
  }

  if (models && properties) {
    for (const id of Object.keys(models)) {
      if (!properties[id]) problems.push(`model:${id} draws a creature that nothing in properties/ says anything about`);
    }
  }
  if (properties && trees) {
    for (const [id, creature] of Object.entries(properties)) {
      if (treeNameIn(trees, { kind: { id, behaviour: creature.behaviour } }) === null) {
        problems.push(`creature:${id} behaves as "${creature.behaviour}", and no behaviour tree drives that`);
      }
    }
  }
  return problems;
}
