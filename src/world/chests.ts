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
  /**
   * This one went down with a ship, which is a different thing from having been left in a hole.
   *
   * A wreck is where a cargo was, and that is the whole of the argument for treating it apart: what
   * is in a barrow is what somebody buried, and what is in a hold is what somebody was selling.
   * Down here it means two things — every chest in a wreck carries a piece of that cargo, where a
   * cave's small ones carry a purse and nothing else, and the strongbox in the flooded hold is
   * worth what a merchant would insure rather than what a robber would bury.
   *
   * Which matters because getting at it costs something. A wreck's hold is a fight against a
   * roster that does not thin out with depth, and the salvage is on an island in water you cannot
   * swim, reached on a line of stones with false ones scattered either side. A dive that ended in
   * a cave's purse would be a dive nobody makes twice.
   */
  salvage?: boolean;
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

/**
 * What a ship was carrying, which is the other half of what a wreck is for.
 *
 * Gold is the answer every hole in the ground already gives, and answering a swim with more of it
 * is why the hold was worth going into exactly once. These are goods — furs out of the north,
 * metal out of a mine, hides off somebody's winter — and every one of them is something you carry
 * up the ladder and sell, rather than something you put on.
 *
 * Which is also why nothing here is filtered against what the hero already owns. A shield is worth
 * having once; a bale of furs is worth having every time, and a hold full of the same cargo is
 * what a hold full of cargo looks like. That the list needs no `owns` at all is the useful part
 * rather than a shortcut: it means the page and the world agree about a salvage chest without the
 * page having to be believed about its own pack.
 */
export const SALVAGE = ['hide', 'pelt', 'silverore', 'foxfur', 'bearpelt', 'nugget', 'gem'];

/** How much a chest is worth, which is most of a run down a hole. */
export const CHEST = {
  /** A small one: a purse, not a fortune. */
  SMALL_GOLD: 12,
  SMALL_SPREAD: 30,
  /** A big one, which is what the locked room at the bottom is for. */
  BIG_GOLD: 80,
  BIG_SPREAD: 70,
  /**
   * And the same two out of a wreck, where the coin is the lesser half of what you came up with.
   *
   * Roughly double a cave's, and deliberately not more than that. What is meant to make the dive
   * worth making is the cargo beside the coin rather than the coin itself — a wreck that simply
   * paid better would be a cave with a longer walk to it, and the difference this is trying to
   * draw is between a place that pays and a place that is worth going to.
   */
  SALVAGE_GOLD: 26,
  SALVAGE_SPREAD: 44,
  /** The captain's strongbox, on the island in the flooded hold: what the whole crossing is for. */
  HOLD_GOLD: 150,
  HOLD_SPREAD: 110,
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
  const salvage = chest.salvage === true;
  const [purse, spread] = chest.big
    ? (salvage ? [CHEST.HOLD_GOLD, CHEST.HOLD_SPREAD] : [CHEST.BIG_GOLD, CHEST.BIG_SPREAD])
    : (salvage ? [CHEST.SALVAGE_GOLD, CHEST.SALVAGE_SPREAD] : [CHEST.SMALL_GOLD, CHEST.SMALL_SPREAD]);
  const gold = purse + Math.floor(roll() * spread);

  /*
   * And what came up with it.
   *
   * Two lists, and which one is read is a question about the chest rather than about the place. A
   * big chest is somebody's strongbox wherever it is standing — the captain's is still a strongbox
   * — so it hands over gear, and is careful not to hand over a second of something already being
   * worn. A crate in a hold is a piece of a cargo, so it hands over goods and does not care what
   * anybody has: the next crate holds what the next crate holds.
   *
   * A salvage crate is the only small chest in the game that holds anything but coin, and that is
   * most of what makes a wreck worth the swim rather than a cave with a boat on top of it.
   */
  let prize: string | null = null;
  if (chest.big) {
    // a potion is drunk and a gem is sold, so a second one is worth having; a shield is not
    const worth = BIG_CHEST_PRIZES.filter((item) => !owns(item) || item === 'potion' || item === 'gem');
    prize = worth[Math.floor(roll() * worth.length)] ?? null;
  } else if (salvage) {
    prize = SALVAGE[Math.floor(roll() * SALVAGE.length)] ?? null;
  }
  return { gold, key: chest.key === true, prize };
}
