/**
 * How long a wreck has lain, and what the fish-folk have had out of her since.
 *
 * The hold was a place before it was a reason. Below the waterline a wreck is flooded, the salvage
 * sits in the water, stepping stones cross it and breath is the price of the short way — all of
 * that is built, and what was still missing was the fish-folk. They were a spawn table: a roster
 * that said twos and threes of them, because a fight in waist-deep water wants numbers. A roster is
 * not a reason. Nothing in the world explained why they were in *this* hull rather than any other,
 * and nothing about them told the player a single thing he did not already know.
 *
 * So they are there for the cargo, and they have been since she went down.
 *
 * That one sentence answers three questions with the same number. A ship that sank last season is
 * still full, so they are thick in her and the dive pays. A ship that went down in somebody's
 * grandfather's time has been carried out of, piece by piece, for forty years: there is little left
 * worth taking and few of them left to guard it. The wreck that is worth robbing is the wreck that
 * is dangerous to rob, and it is the *same fact* — which means a player who looks down into the
 * water and counts shapes already knows what the strongbox is worth before he gets wet.
 *
 * That is the difference between a spawn table and a reason: a table makes a room harder, and a
 * reason makes a room readable.
 *
 * ## Why it is derived and not stored
 *
 * When she sank is a fact about the world rather than about anybody's game, so it comes off the
 * wreck's own anchor seed and every player in a shared world finds the same ship in the same state.
 * Nothing is written down, nothing has to agree with anything, and a wreck that two people open
 * from two directions cannot disagree about its own age — which is exactly the fault the anchor's
 * kind was made to close when the hold was first opened from two doors.
 */

/** What a wreck's age is bounded by, and where the picking stops being worth anybody's while. */
export const WRECK = {
  /** A ship that went down last season. Her cargo is still aboard and so is everything after it. */
  YOUNGEST: 2,
  /** And the oldest anybody remembers, which is old enough that she is a shape on the bottom. */
  OLDEST: 60,
  /**
   * Years after which there is nothing left worth guarding.
   *
   * Short of `OLDEST` on purpose: the last stretch of a wreck's life should be a hull with nothing
   * in it, so that "she is picked clean" is a thing a player can actually find rather than a limit
   * he approaches. A wreck he swims down into and comes back up from empty-handed is the price of
   * the ones that pay, and it is what makes looking before diving worth doing.
   */
  STRIPPED: 45,
  /**
   * The most she is ever thick with, as a multiple of what a floor would hold anyway.
   *
   * Three, because a hold is one room deep and the room is the only one there is: doubling the
   * roster of a whole vault would be a different feature, and doubling the roster of one room is
   * the difference between crossing it and thinking about crossing it.
   */
  THICKEST: 3,
} as const;

/**
 * How long this wreck has been on the bottom, in years.
 *
 * Off the anchor's seed rather than the world's, for the reason the salvage already is: two people
 * opening one hull from two doors have to find the same ship.
 */
export function yearsSheHasLain(seed: number): number {
  // the low bits of a seed are the ones an anchor's own hashing moves most, and an age wants to
  // differ between two wrecks a mile apart rather than between two worlds
  const spread = WRECK.OLDEST - WRECK.YOUNGEST;
  return WRECK.YOUNGEST + Math.abs(Math.floor(seed / 7)) % (spread + 1);
}

/**
 * What is still aboard, as a share of what she went down with.
 *
 * Straight-line rather than curved, and that is a decision worth defending: a curve would make most
 * wrecks similar and a few extreme, and the thing this is for is that every wreck says something
 * different about itself. A flat slope means the shapes in the water are a *scale* a player learns
 * to read rather than two states with a cliff between them.
 */
export function whatIsLeft(years: number): number {
  if (years <= WRECK.YOUNGEST) return 1;
  if (years >= WRECK.STRIPPED) return 0;
  return 1 - (years - WRECK.YOUNGEST) / (WRECK.STRIPPED - WRECK.YOUNGEST);
}

/**
 * How many more of them are down there than a floor would otherwise hold.
 *
 * Rooms rather than a flat number, because a big hull is a bigger room to be surrounded in and the
 * fish-folk gather where the cargo is rather than where the walls are. A stripped wreck gets none:
 * they are not guarding an empty hold, and the player who swims into one and finds it quiet has
 * learned the rule rather than had a lucky roll.
 */
export function howManyGather(left: number, rooms: number): number {
  if (left <= 0) return 0;
  return Math.round(rooms * left * (WRECK.THICKEST - 1));
}

/**
 * How much of a salvage chest's cargo is still in it.
 *
 * Never less than one thing in a wreck that has anything left at all. A chest a player crossed
 * water to reach and found empty is a chest that taught him the mechanic is a lie, where a chest
 * with one hide in it teaches him he came to the wrong ship — which is the same information and a
 * far better afternoon.
 */
export function cargoLeft(left: number, full: number): number {
  if (left <= 0) return 0;
  return Math.max(1, Math.round(full * left));
}

/**
 * What a hull looks like from the deck, before anybody gets wet.
 *
 * The whole point of tying the three numbers together is that the player can read one of them off
 * the water, so the game has to actually say it. It is the only thing here that is words rather
 * than arithmetic, and it belongs beside the rule it describes.
 */
export function saidOfTheWater(left: number): string {
  if (left <= 0) return 'The water below is still and empty. Whatever she carried went out of her a long time ago.';
  if (left < 0.35) return 'A shape or two moves down there. There cannot be much left in her.';
  if (left < 0.7) return 'Shapes move in the water below, and more than a couple of them.';
  return 'The water below is thick with them, and they are not going anywhere. She went down loaded.';
}
