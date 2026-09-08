import type { Doorway } from '../world/structures';
import type { Places } from './places';

/**
 * Walking into a door goes in.
 *
 * A door used to be a thing you stood in front of and pressed a key at. That is one rule too many:
 * every other solid in this world is walked into and stops you, so a doorway that also stops you —
 * and then asks for a keystroke — is a door that behaves like a wall with a secret. Walking at it
 * should take you through, the way it does in every game where buildings are worth entering, and
 * the way it does in life.
 *
 * The key still works. It is what you use when you are standing on the step already and would
 * rather not shuffle.
 */

const DOOR = {
  /**
   * How close the hero's feet get to the door before he is through it, in tiles.
   *
   * Smaller than the reach the key uses, because this one fires without being asked: a door you
   * are merely walking past should not swallow you, and the threshold has to be somewhere you have
   * plainly aimed for rather than somewhere you happened to brush.
   */
  STEP: 0.62,
  /**
   * And how far he has to get from every door before walking into one counts again.
   *
   * Coming out of a building leaves you standing one tile beyond the doorway, which is close
   * enough that a step in any direction could round back inside — you would come out of a shop and
   * be in it again before you had finished leaving. So the step is disarmed on arrival and stays
   * disarmed until the hero is clear of every door in the world; then walking at one works again.
   */
  CLEAR: 1.6,
} as const;

/** Somebody who can be at a door: the hero, in the two numbers this cares about. */
export interface AtDoor {
  x: number;
  z: number;
}

/**
 * Watches the hero for a door under his feet.
 *
 * `doors` is read fresh each frame rather than held, because a door can be built: a house the
 * player puts up has one the moment its roof goes on.
 */
export function createDoorsteps(places: Places, doors: () => readonly Doorway[]) {
  /** False from the moment a building is entered or left, until the hero is clear of every door. */
  let armed = false;

  return {
    /** Call once a frame, out of doors, after the hero has been moved. */
    step(hero: AtDoor): void {
      // indoors there is nothing to walk into, and a conversation is not a moment to be teleported
      if (places.indoors || places.underground) { armed = false; return; }

      let nearest = Infinity;
      let onTheStep: Doorway | null = null;
      for (const door of doors()) {
        const away = Math.hypot(door.x - hero.x, door.z - hero.z);
        if (away < nearest) nearest = away;
        if (away <= DOOR.STEP) onTheStep = door;
      }

      if (!armed) {
        if (nearest > DOOR.CLEAR) armed = true;
        return;
      }
      if (!onTheStep) return;
      armed = false;
      places.enterBuilding(onTheStep);
    },

    /** What the step is waiting for, so a test can say why nothing happened. */
    get ready(): boolean { return armed; },
  };
}
