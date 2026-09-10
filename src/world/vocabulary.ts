import * as deeds from './deeds';
import * as goods from './goods';

/**
 * Everything anybody in this world can do, named in one place.
 *
 * This is the list, and the point of it is that there is only one. Before it there were two
 * vocabularies that shared no words: `entities/verbs.ts`, what a creature can do, driven by a
 * behaviour tree; and `game/interact/`, what the player can do, three thousand lines of menus
 * driven by the Enter key. A villager sold a deer through the first and the hero bought a horse
 * through the second, and no line of code believed those were both a sale.
 *
 * Keeping them apart cost real things, and none of them were tidiness. A watched hunter was
 * credited the price of his meat out of nowhere while an unwatched one was paid his neighbours'
 * money — same man, same deer, two economies. The hero spent gold at fifteen sites that named no
 * payee, so every coin he ever spent left the world, and buying every horse in a county left the
 * county as poor as it started. Twelve places wrote out their own version of "take it from here
 * and add it to there", each free to lose a thing between the two halves.
 *
 * ## What a deed is
 *
 * What an act *does*, apart from who ordered it and how it was drawn. No renderer, no dialogue,
 * no HUD, no chunk manager, no clock — just who is acting, what they are acting on, and what
 * changed. A creature verb is a tick-function wrapping a deed; a menu choice is a menu wrapping
 * the same deed. That is what makes them testable without a browser and drivable without a
 * keyboard, and those two are the whole reason for the exercise.
 *
 * It is also what makes the hero drivable by a behaviour tree, which is the stated goal this is
 * built toward. Nothing here knows or cares whether the hand that called it belonged to a player,
 * a villager, or a script running a playtest.
 *
 * ## The two halves so far
 *
 * **Money** is done. `Holder` makes a rucksack and a purse the same shape, `transfer` is under
 * every coin that moves, and `AWAY` is the rest of the world — a sink *and* a source, because a
 * shopkeeper buying forty pelts is paying out of a city this game never draws. Every payment in
 * the game names a payee now; `game/tills.ts` says who, for the player's side.
 *
 * **Goods** are done. `Pack` makes a rucksack, a strongbox and a hunter's shoulder the same shape,
 * `handOver` moves what was actually taken rather than what was asked for, and `GONE` is the
 * ground, the fire and the river.
 *
 * What is not done is the rest: hiring, building, sowing, skinning, healing, arresting. Those are
 * acts on the world rather than on a purse or a pack, and they are being converted as they are
 * touched rather than in one sitting — see the work list. `vocabulary.test.ts` holds this list to
 * what is actually exported, so a deed cannot be added and left unnamed, or named and left
 * unwritten.
 */

/** The deeds themselves, so a caller has one import rather than three. */
export * from './deeds';
export * from './goods';

/**
 * What each deed is for, in one line, and which half of the world already speaks it.
 *
 * A table rather than a comment because it is checked: every name here has to be a thing this
 * module actually exports, and every deed exported has to be named here. That is the same rule
 * `world/catalogue.test.ts` holds the prop library to, and it is here for the same reason — a
 * vocabulary nobody can enumerate is not a vocabulary, it is a habit.
 */
export const DEEDS: ReadonlyArray<{ deed: string; does: string }> = [
  { deed: 'transfer', does: 'move money from one holder to another; the one place a coin changes hands' },
  { deed: 'buy', does: 'pay a price, all or nothing, because nobody sells four fifths of a horse' },
  { deed: 'sell', does: 'take what the buyer can actually find, because meat does not keep' },
  { deed: 'give', does: 'hand money over for nothing back: a gift, a wage, a share, an estate' },
  { deed: 'handOver', does: 'move things between two packs, moving what was taken and not what was asked' },
  { deed: 'handOverAll', does: 'empty one pack into another without leaving the last one behind' },
];

/** The shapes a deed acts on: somewhere money is kept, and somewhere things are. */
export const HOLDINGS: ReadonlyArray<{ maker: string; is: string }> = [
  { maker: 'holds', is: "anything keeping money in a field called gold: the hero's rucksack, a strongbox" },
  { maker: 'purseOf', is: "a villager's purse, on the register, which outlives the body in the street" },
  { maker: 'AWAY', is: 'the rest of the world: a sink and a source, and never used by accident' },
  { maker: 'packOf', is: 'things kept in a Map, which is the hero\'s pack and most other places' },
  { maker: 'boxOf', is: 'things kept in a plain object: a strongbox, a chest, a pack on the ground' },
  { maker: 'carriedBy', is: 'a shoulder, which holds one kind of thing and drops what it had' },
  { maker: 'GONE', is: 'the ground, the fire, the river: where a thing goes when it leaves the world' },
];

/** Everything this module exports by name, for the test that holds the two lists to each other. */
export function spoken(): string[] {
  return [...Object.keys(deeds), ...Object.keys(goods)];
}
