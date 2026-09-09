import { MODELS, modelFile } from './models';
import { PROPERTIES, creature, type CreatureProperties } from './properties';
import type { PartDef } from './rigs';

/**
 * Every creature in the game, joined from the two halves it is kept in.
 *
 * What a creature *is* — its pace, its bite, what it is worth — is a table of numbers argued about
 * far more often than any code, and it lives in `properties/`. The body it is drawn with is a
 * shape, read by looking at it, and it lives in `models/creatures/`, a file each. Neither is in a
 * source file any more, and this is the seam: a body with no properties beside it, or properties
 * with no body, fails at load rather than quietly appearing as a creature with no speed or not
 * appearing at all.
 *
 * This file used to hold the bodies as well, and was five hundred lines of arithmetic. The rigs
 * went out for the reason the properties did before them, and one more that only applies to them:
 * the character builder asks Claude to change a rig, and "it is the `wolf:` entry somewhere in
 * `src/entities/`, find it" is a worse instruction than `models/creatures/wolf.json`.
 */

// half the game asks this file what a part or a behaviour is; both are checked where the files
// that use them are read, so the types come back through here rather than moving every import
export type { Behaviour } from './properties';
export type { AnimRole, PartDef, PartShape } from './rigs';

/** A creature entire: what it is, out of `properties/`, and the body it is drawn with. */
export interface AnimalKind extends CreatureProperties {
  parts: PartDef[];
  /**
   * How much ground it stands on: half its length nose to tail, half its width.
   *
   * Measured from `parts` by `creature()` and scaled with the creature, so its size, its shape and
   * what it blocks are one fact that cannot come apart. Nothing else may set it.
   */
  readonly body: { readonly hw: number; readonly hd: number };
}

/**
 * The bestiary, in the order the models are listed in.
 *
 * Every model is a kind and every kind is a model — there is no list of names here to fall out of
 * step with the directory, which is what a table of thirty-five hand-written entries eventually
 * does. What one is called is the file it is in.
 */
export const KINDS: Record<string, AnimalKind> = Object.fromEntries(
  Object.entries(MODELS).map(([id, parts]) => [id, creature(id, parts)]),
);

// A creature written into properties/ that nothing draws would never appear in the world, and the
// file would go on looking as though it had. `creature` catches the other way round, so between
// them the two directories have to agree about what exists.
for (const id of Object.keys(PROPERTIES)) {
  if (!KINDS[id]) throw new Error(`properties/: "${id}" has properties but there is no ${modelFile(id)} to draw it with, so nothing in the game would ever show it`);
}
