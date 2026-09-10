/**
 * Getting off the ground for a moment.
 *
 * The hero could not leave the floor, and the thing that made that worth changing is not acrobatics
 * — it is being stuck. A body is a box and so is everything it bumps into, and in a corner between
 * a barrel and a wall the two boxes leave a pocket a hero can be pushed into and cannot walk out
 * of by any of the three directions a slide tries. From the chair that is the game refusing to move
 * at all, with nothing on the screen to say why, and the only way out is to reload.
 *
 * So: a jump, and one written to be a way over small things rather than a way up. What it clears is
 * measured off the props themselves rather than listed here — see `Footprint.high` — and the line
 * is drawn at `CLEARS`, which is chosen from what the world actually contains.
 *
 * What it deliberately is not: a way onto things. Nothing in this world has a top you can stand on
 * — the ground is the ground and a roof is scenery — so a jump changes what is in your way for a
 * moment and never where the floor is. Landing inside something you half-cleared is possible and
 * is not a trap: being inside a solid is a thing you may always walk out of, by the shortest way
 * out. See `slide` in `entity.ts`.
 */

export const JUMP = {
  /**
   * How high a thing may stand and still be got over, in world units.
   *
   * Measured against the world rather than chosen for the feel of it. What the country and its
   * rooms actually hold, by the top of the part that blocks you: a campfire is 0.75, an anvil 0.64,
   * a crate 0.70, a table 0.76, a bed 0.85, a barrel 0.86, a paddock rail 0.95, a pew 1.00 — and
   * then the next things up are a boulder at 1.14, a shop sign at 1.45, and every wall, tree and
   * house above that. There is a real gap there, and this sits in it.
   *
   * So a hero hops a fence, a bench, a barrel and the clutter of a workshop, and does not hop a
   * boulder, a hedge or a curtain wall. That is the same line a person would draw looking at the
   * things themselves, which is the test of a number like this.
   */
  CLEARS: 1.0,

  /**
   * How high he actually goes, in world units.
   *
   * A hair over what it clears, so the picture and the rule agree: a jump that passed over a
   * paddock rail while visibly going through it would read as the collision being broken, which is
   * exactly the impression this exists to remove.
   */
  RISE: 1.12,

  /**
   * How long the whole arc takes, in seconds.
   *
   * Long enough to carry him across what he is jumping — at a run that is about three tiles, which
   * is a fence and the ground either side of it — and short enough that it is a hop rather than a
   * float. A jump that hangs makes a world feel like the moon.
   */
  TIME: 0.62,

  /**
   * How long after landing before he can go again, in seconds.
   *
   * Small, and not nought. Held down, a jump with no rest at all is a hero who bounces across the
   * county permanently a foot off the ground, which would make every short thing in the world
   * permanently not there.
   */
  REST: 0.12,
} as const;

/**
 * How high off his own ground a jump has him, given what is left of it.
 *
 * A parabola, worked out from the time remaining rather than kept as a velocity: there is no
 * gravity in this game and nothing else falls, so a jump that integrated one would be a physics
 * engine grown for a single hop. Nought at both ends by construction, which is what makes landing
 * exact rather than approximately exact.
 */
export function leapHeight(left: number): number {
  if (left <= 0) return 0;
  const t = Math.max(0, Math.min(1, 1 - left / JUMP.TIME));
  return JUMP.RISE * 4 * t * (1 - t);
}
