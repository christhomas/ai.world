import type { Doorway } from '../world/structures';
import type { Places } from './places';

/**
 * Walking into a door goes through it, from either side.
 *
 * A door used to be a thing you stood in front of and pressed a key at. That is one rule too many:
 * every other solid in this world is walked into and stops you, so a doorway that also stops you —
 * and then asks for a keystroke — is a door that behaves like a wall with a secret.
 *
 * It was made to work on the way in first, and that turned out to be worse than not doing it at
 * all: a door you can walk through in one direction and must press a key to come back out of is a
 * door with a rule you have to remember, and the rule changes depending on which side of it you
 * are standing. A door is a hole in a wall. It does not know which way you are going.
 *
 * The key still works, both ways. It is what you use when you are standing on the step already and
 * would rather not shuffle.
 */

/*
 * The door itself, taken off the house it is cut into.
 *
 * `house()` in `render/geometry.ts` puts the leaf at 1.22 out from the middle of a cottage, and
 * makes it 0.62 wide and 0.08 thick. The `Doorway` record is not that: it is the tile you stand on
 * to knock, two whole tiles out from the middle — so testing against the record was testing a spot
 * three-quarters of a tile into the street, and the door fired at anybody crossing the front of
 * the building. Which is what was reported, and it was not a tuning problem: it was the wrong
 * point.
 *
 * These are read off the model rather than guessed. If the cottage is ever redrawn, they move.
 */
const DOOR = {
  /** How far out from the middle of a house its door hangs, in tiles. */
  OUT: 1.22,
  /** Half the width of the leaf, along the wall. */
  HALF: 0.31,
  /** And half its thickness, through the wall. */
  THICK: 0.04,
  /**
   * Half the hero, across the shoulders.
   *
   * He collides as a point, so this is not about collision — it is what "the player intersects the
   * door" means when the player is a body a third of a tile wide and the door is a leaf. Without
   * it he would have to put his centre inside eight hundredths of a tile of wood.
   */
  BODY: 0.18,
  /**
   * And how far he has to get from a door before walking into one counts again.
   *
   * This is what keeps a door from being a revolving one. Coming out leaves you standing a tile
   * beyond the doorway and going in puts you a tile inside it — either way close enough that the
   * next step could round straight back through. The step is disarmed by every passage through a
   * door and stays disarmed until the hero is properly clear of the one he is nearest.
   */
  CLEAR: 1.9,
} as const;

/** Somebody who can be at a door: the hero, in the two numbers this cares about. */
export interface AtDoor {
  x: number;
  z: number;
}

/**
 * Is the hero's body overlapping the door leaf?
 *
 * Which way the door faces is not recorded on it and does not need to be: the record's tile lies
 * out from the middle of the building, so the way through is whichever axis the two differ on and
 * the other is the wall. The leaf is then `DOOR.OUT` along that axis from the middle of the house
 * — not at the record, which is a tile further out again.
 *
 * A rectangle overlap, both directions, and nothing else: no radius, no reach, no "near enough".
 */
export function onThreshold(door: Doorway, hero: AtDoor): boolean {
  const cx = door.bx + 0.5, cz = door.bz + 0.5;
  const outX = door.x - cx, outZ = door.z - cz;
  const facingX = Math.abs(outX) >= Math.abs(outZ);
  const way = Math.sign(facingX ? outX : outZ) || 1;
  // where the leaf actually hangs, and how far the hero is from it in the door's own two directions
  const across = (facingX ? hero.x - cx : hero.z - cz) * way - DOOR.OUT;
  const along = facingX ? hero.z - cz : hero.x - cx;
  return Math.abs(across) <= DOOR.THICK + DOOR.BODY && Math.abs(along) <= DOOR.HALF + DOOR.BODY;
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
    /** Call once a frame, after the hero has been moved, wherever he is. */
    step(hero: AtDoor): void {
      // a cave mouth is a different thing with its own prompt, and stairs are not a doorway
      if (places.underground) { armed = false; return; }

      const room = places.indoors;
      if (room) {
        // the same rule from the inside: the one door of the room he is standing in
        if (!armed) { if (room.world.fromDoor(hero.x, hero.z) > DOOR.CLEAR) armed = true; return; }
        // indoors the doorway is a whole tile of the south wall, so the leaf's own depth is the tile
        if (!room.world.inDoorway(hero.x, hero.z, 0.5 + DOOR.BODY, DOOR.HALF + DOOR.BODY)) return;
        armed = false;
        places.leaveBuilding();
        return;
      }

      let nearest = Infinity;
      let onTheStep: Doorway | null = null;
      for (const door of doors()) {
        const away = Math.hypot(door.x - hero.x, door.z - hero.z);
        if (away < nearest) nearest = away;
        if (onThreshold(door, hero)) onTheStep = door;
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
