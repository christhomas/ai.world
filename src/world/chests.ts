import { mulberry32 } from '../core/rng';

/**
 * What is in a chest, which is a fact about the world rather than a decision anybody makes.
 *
 * A vault is regrown from its seed every time somebody walks into it, so the chest on the third
 * floor of Redhollow holds what it holds on every screen in the country. Nobody rolls for it; it is
 * already decided, and opening the lid is only how you find out. That is the whole argument for
 * moving it out of the page: a rule the page *computes* can be computed by the world too, and then
 * the world can answer "yes, and here is what was in it" instead of being told.
 *
 * Which is the point of the exercise. A client that decides what it found is a client that can
 * decide it found a hundred gold and a sword, and the only reason this one cannot is that nobody has
 * tried. The seed says what is there; both halves read the same seed the same way.
 *
 * What is NOT here: whether you are allowed to open it — near enough, not already open, not locked
 * behind a door you have no key for. That is about a person standing somewhere at a moment, and it
 * belongs with whoever is holding the hero.
 */

/** The chest itself, as the map drew it. */
export interface ChestKind {
  /** A big one, which is the kind with something worth carrying in it. */
  big: boolean;
  /** This is the one with the key to the treasure room on this floor. Absent on the ones that are not. */
  key?: boolean;
}

/** What was in it. */
export interface ChestHoard {
  gold: number;
  /** The treasure-room key. What the lock is called is the caller's business. */
  key: boolean;
  /** One thing worth carrying, from a big chest, or nothing. */
  prize: string | null;
}

/**
 * What a big chest can hold.
 *
 * Item ids rather than items: this layer knows what a thing is called and nothing else about it,
 * because the price of it, the picture of it and what it does when you drink it all live with the
 * rules. A list of strings crosses a layer; an item does not.
 */
export const BIG_CHEST_PRIZES = [
  'potion', 'steelsword', 'ironshield', 'helm', 'jerkin', 'mail', 'greaves',
  'charm', 'lantern', 'rope', 'map', 'gem',
];

/** How much a chest is worth, which is most of a run down a hole. */
export const CHEST = {
  /** A small one: a purse, not a fortune. */
  SMALL_GOLD: 12,
  SMALL_SPREAD: 30,
  /** A big one, which is what the locked room at the bottom is for. */
  BIG_GOLD: 80,
  BIG_SPREAD: 70,
};

/**
 * Open it, on paper.
 *
 * `seed` is the *anchor's* seed — the vault's, out of the manifest — and not the world's. Asking for
 * the wrong one is a bug this file has already had: every floor of every vault rolled the same gold
 * and the same prize for the same index, quietly, because a chest that gives you something looks
 * exactly like a chest that worked.
 *
 * `owns` keeps a big chest from handing over a second of something you are already carrying, with
 * two exceptions that are worth having twice. Handed in rather than reached for, because whoever is
 * asking knows what they have and this file never should.
 */
export function whatAChestHolds(
  seed: number,
  index: number,
  chest: ChestKind,
  owns: (item: string) => boolean,
): ChestHoard {
  // `+ index + 1` so the first chest of a vault is not the vault's own seed, which would make the
  // chest and the floor it stands on roll off the same number
  const roll = mulberry32(seed + index + 1);
  const gold = chest.big
    ? CHEST.BIG_GOLD + Math.floor(roll() * CHEST.BIG_SPREAD)
    : CHEST.SMALL_GOLD + Math.floor(roll() * CHEST.SMALL_SPREAD);

  let prize: string | null = null;
  if (chest.big) {
    // a potion is drunk and a gem is sold, so a second one is worth having; a shield is not
    const worth = BIG_CHEST_PRIZES.filter((item) => !owns(item) || item === 'potion' || item === 'gem');
    prize = worth[Math.floor(roll() * worth.length)] ?? null;
  }
  return { gold, key: chest.key === true, prize };
}
