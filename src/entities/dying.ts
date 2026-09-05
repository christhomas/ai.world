import type { Entity } from './entity';
import { DYING_LASTS } from './motion';

/**
 * Going down.
 *
 * A killed creature used to leave the world on the frame it died, which read as things blinking
 * out of a fight rather than being beaten in one: you never saw what you had done, and a swing
 * that killed and a swing that missed looked much the same. So a body now stays for as long as it
 * takes to fall — it topples, sinks through the ground, and is taken away once it is out of
 * sight, which is also what hands it over to the carcass lying underneath without either of them
 * being seen to appear.
 *
 * The line worth holding is between dying and being removed. Dying is something that happens to a
 * creature and is watched; removal is bookkeeping — a chunk unloading, a host saying a monster is
 * gone — and should be instant. Only the first of those comes through here.
 */

/**
 * A creature has been killed. It keeps its body for the length of the collapse and does nothing
 * else with it: nothing acts, is talked to, is hit again, or counts as alive while `dying` runs.
 *
 * Its pace is dropped rather than left as it was, so the walk stops with it and the collapse is
 * not fighting a stride still running underneath. Calling it twice is harmless: whatever killed
 * something first owns how it falls, and a second arrow does not restart it.
 */
export function startDying(e: Entity): void {
  if (e.dying > 0) return;
  e.dead = true;
  e.dying = DYING_LASTS;
  e.walk = 0;
  e.flap = 0;
  e.strike = 0;
  // a blow that was half thrown when it died does not land. Without this a wolf shot out of the
  // air still bites you on the way down, which is the sort of thing that reads as the game
  // cheating even when the arithmetic is fair
  e.winding = 0;
  e.warned = false;
  e.target = null;
}

/**
 * Count the fallen down, and take away whatever has finished falling.
 *
 * Runs over everything rather than only what is near the hero, on purpose: a creature killed as
 * the hero walks away would otherwise stop counting part way down and lie there for ever in a
 * field nobody visits. Both the outer and inner lists are copied because `remove` edits them.
 */
export function buryTheFallen(
  crowds: Iterable<Entity[]>, dt: number, remove: (e: Entity) => void,
): void {
  for (const list of [...crowds]) {
    for (const e of [...list]) {
      if (e.dying <= 0) continue;
      e.dying -= dt;
      if (e.dying <= 0) { e.dying = 0; remove(e); }
    }
  }
}
