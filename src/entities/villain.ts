import { KINDS, type AnimalKind } from './animals';

/**
 * The one figure in this world who is neither wildlife nor a thing out of a barrow: a man, and the
 * only man in the game worth being frightened of.
 *
 * Everything else that means you harm is a shape you learn once. A wolf is a wolf, an ogre is
 * weight and a wight is cold, and having met one you have met them all. There is exactly one of
 * him, he turns up perhaps five times in the life of a villager, and the whole point of his rig is
 * that the first time you see that outline across a field you know which of those two kinds of
 * evening you are having. It is in `models/creatures/nettle.json`, with the reasoning for the
 * silhouette written into the file beside the parts that make it.
 *
 * The decision worth explaining here is that he keeps his hit points and the hero's own climb. The
 * wight has neither, and its missing hit points are how a blade passes through it without a line
 * of code anywhere saying so. He is the opposite case on purpose: the sword works, the terrace
 * trick that saves you from an ogre does not, and the fight is a fight you can win. Those numbers
 * and the argument for each of them are in `properties/villain.json`; what happens at the end of a
 * fight he is losing is not this file's business and is deliberately not written here, because a
 * creature kind has no business knowing it is a story. That lives one layer up.
 */

/** The creature this file names, as the kind table and `behaviours/villain.json` know him. */
export type VillainId = 'nettle';

/** Him, picked back out of the kind table — the same object, under a type that says there is one. */
export const VILLAIN_KINDS: Record<VillainId, AnimalKind> = {
  nettle: KINDS.nettle,
};
