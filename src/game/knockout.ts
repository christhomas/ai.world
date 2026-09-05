/**
 * Being knocked out, and waking up somewhere else.
 *
 * The hero cannot die. Running out of hearts takes some of your money and puts you down in the
 * nearest village, which is the right shape for a game you are meant to keep playing — but it was
 * being told in a line of flashed text that is gone in three seconds. You would come round in a
 * street you did not recognise, poorer, with nothing on screen saying why, which reads as the game
 * having broken rather than as having lost a fight.
 *
 * So a knockout is a moment you have to close, and it says the three things you need: what got
 * you, what it cost, and where you are now. It is the same information that was always there. The
 * difference is that it waits for you.
 */

/** Somewhere with a name that the hero can be carried to. */
export interface Refuge {
  name: string;
  x: number;
  z: number;
}

/**
 * Who picks you up. The nearest village by plain distance — nobody is carrying an unconscious
 * stranger across a mountain range when there is a closer roof.
 *
 * Null when there is no village at all, which happens on a seed whose islands never grew one.
 * The caller must cope rather than assume: waking nowhere is better than crashing, and a crash
 * here is the one bug in this whole path a player cannot recover from.
 */
export function carriedTo(villages: readonly Refuge[], x: number, z: number): Refuge | null {
  let best: Refuge | null = null;
  let nearest = Infinity;
  for (const village of villages) {
    const away = Math.hypot(village.x - x, village.z - z);
    if (away < nearest) { nearest = away; best = village; }
  }
  return best;
}

/** What a knockout took off you, given what you were carrying. */
export function costOf(gold: number, most: number): number {
  return Math.max(0, Math.min(most, gold));
}

/** What happened, in the order you want to hear it. */
export function saidOfKnockout(cause: string, woke: Refuge | null, lost: number, below: boolean): string[] {
  const pages: string[] = [];
  pages.push(`${cause} put you down.`);
  if (below) {
    pages.push(woke
      ? `Somebody dragged you up into the daylight and left you outside. You are alive.`
      : `You come round on the surface with no memory of the climb.`);
  } else {
    pages.push(woke
      ? `You come round in ${woke.name}, laid out where somebody found room for you.`
      : `You come round where you fell. There was nobody near enough to carry you anywhere.`);
  }
  pages.push(lost > 0
    ? `Your purse is ${lost} gold lighter. Whoever picked you up did not do it for nothing.`
    : `You had nothing worth taking, which is the one advantage of it.`);
  return pages;
}
