import { KINDS, type AnimalKind } from './animals';

/**
 * The things in this world that are not wildlife.
 *
 * Every other creature in the game is an animal with a job. It grazes or it hunts, it flees or it
 * does not, and a sword settles the argument either way round. These two are here to be arguments
 * a sword does not settle, so that the kit sold for surviving them, a warding draught, a shield,
 * a head start, has something to be for.
 *
 * The non-obvious decision is the wight's missing hit points. A kind with no `hp` is one that a
 * swing steps straight over, so a blade passing through a spirit is not a special case written
 * into the fight code: it is the absence of one. What does answer a wight is daylight, its own
 * ground, and a draught, and where a wight is at all lives in `game/haunts.ts`, one layer up.
 *
 * This file used to hold their bodies too, in its own copy of the four shape primitives, because
 * they were private to `animals.ts` and could not be reached. Both bodies are files now —
 * `models/creatures/ogre.json` and `wight.json` — and the primitives are shared out of `rigs.ts`,
 * so what is left here is the naming and the one rule that follows from it.
 */

/** The creatures this file names, by the name the kind table knows them under. */
export type MonsterId = 'ogre' | 'wight';

/**
 * The two of them, picked back out of the kind table.
 *
 * The same objects, not copies: something that has met an ogre through `KINDS` and something that
 * reached for it here are holding one creature, which is what stops a fight and a spawner ever
 * disagreeing about how hard it hits. What this adds over `KINDS.ogre` is the type — a caller with
 * a `MonsterId` in hand gets a creature rather than a maybe.
 *
 * The numbers that decide how a fight goes are in `properties/monsters.json`, with the argument for
 * each of them beside it.
 */
export const MONSTER_KINDS: Record<MonsterId, AnimalKind> = {
  ogre: KINDS.ogre,
  wight: KINDS.wight,
};

/** Can a blade reach this creature at all? Anything with no hit points is beyond one. */
export function canBeCut(kind: { hp?: number }): boolean {
  return (kind.hp ?? 0) > 0;
}
