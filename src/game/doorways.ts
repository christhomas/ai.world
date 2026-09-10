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
 * `house()` in `entities/buildings.ts` puts the leaf at 1.22 out from the middle of a cottage, and
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
  /**
   * And half its thickness, through the wall.
   *
   * Wider than the leaf itself, and wider again since a walker began colliding as a body rather
   * than as a point: the wall stops a hero at 1.26 from the middle of the house *plus his own half
   * width*, so the nearest his middle can get to the leaf is a fifth of a tile further out than it
   * used to be. Measured to the leaf's own eight hundredths, the band of ground where a door can be
   * touched had shrunk to less than a stride, and walking at a door became a thing you could do
   * three times and miss.
   *
   * So this reaches from the leaf out to where a body can actually stand.
   */
  THICK: 0.34,
  /**
   * Half the hero, across the shoulders.
   *
   * He collides as a point, so this is not about collision — it is what "the player intersects the
   * door" means when the player is a body a third of a tile wide and the door is a leaf. Without
   * it he would have to put his centre inside eight hundredths of a tile of wood.
   */
  BODY: 0.18,
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
/**
 * How long a door ignores you after you have just been through it, in seconds.
 *
 * Going through leaves you standing on the far side of the same doorway, so the rule that a door
 * works when you touch it makes it a revolving one: hold a direction and you are in, out, in, out
 * several times a second. Being off the threshold re-arms it, which is enough when you walk away
 * and not enough when you are pressed against the wall beside it — that is the case that was
 * reported, as a door triggering over and over while its owner was nowhere near it.
 *
 * Long enough that a fumbled step cannot go back through, short enough that changing your mind is
 * not a punishment.
 */
export const REST = 5;

/**
 * A castle's gate, as this file needs it: a place to stand and the anchor behind it.
 *
 * The same shape as a doorway and a different thing, which is why it is its own list. A house's
 * door is a leaf in a wall of a building the world knows the middle of; a gatehouse is three tiles
 * of stone with a passage through it, and where you stand to go in was worked out when the castle
 * was laid out — `Castle.gateX`/`gateZ`, two tiles clear of the stonework.
 */
export interface Gateway {
  id: string;
  name: string;
  x: number;
  z: number;
}

/**
 * How near the gate spot counts as being at the gate, in tiles.
 *
 * Wider than a door's leaf on purpose. A doorway is a thing you walk *at*, square on, and the leaf
 * is a hand's breadth of wood; a gate is a passage you walk *into*, and the tile in front of it is
 * where anybody heading for the castle ends up. Three quarters of a tile is that tile and its own
 * edges, and it is well clear of the walls either side, so there is no way to be admitted by
 * brushing the curtain wall.
 */
const GATE_STEP = 0.75;

/** The gates of a world's castles, as a doorstep needs them. */
export function gatesOf(castles: readonly { id: string; name: string; gateX: number; gateZ: number }[]): Gateway[] {
  return castles.map((c) => ({ id: c.id, name: c.name, x: c.gateX, z: c.gateZ }));
}

export function createDoorsteps(
  places: Places,
  doors: () => readonly Doorway[],
  /**
   * The castles, if the world has any and anybody has told this about them.
   *
   * A default of none, because a dungeon floor, an interior and every test in this file have no
   * castles in them and should not have to say so.
   */
  gates: () => readonly Gateway[] = () => [],
  /** A place seen for the first time goes in the journal, the way the gate's own prompt used to. */
  discover: (name: string) => void = () => {},
) {
  /**
   * A door works again as soon as you have stepped off one.
   *
   * Something has to stop a door being a revolving one — going through leaves you standing next to
   * the doorway you just came through, so without a latch the next frame takes you straight back.
   * That used to be a distance: get more than so many tiles from the nearest door and it counts
   * again. It was the wrong rule, and it made the inside of a building unreliable in exactly the
   * way it was reported — a shop is a small room, so a hero who stayed near the counter never got
   * far enough away to re-arm, walked into the door, and nothing happened; wander about a bit and
   * eventually it would work.
   *
   * Standing off the threshold is the whole of the condition. There is no distance in it, so there
   * is no room too small for it, and it cannot be half-satisfied.
   */
  let armed = false;
  /** What is left of the rest a door takes after somebody has been through it, in seconds. */
  let resting = 0;

  return {
    /** Call once a frame, after the hero has been moved, wherever he is. */
    step(hero: AtDoor, dt = 0): void {
      // the rest runs down wherever he is standing, and arming goes on underneath it: walking away
      // from a door while it is resting still counts as having walked away
      if (resting > 0) resting = Math.max(0, resting - dt);

      // a cave mouth is a different thing with its own prompt, and stairs are not a doorway
      if (places.underground) { armed = false; return; }

      const room = places.indoors;
      if (room) {
        // the same rule from the inside; indoors the doorway is a whole tile of the south wall, so
        // the leaf's own thickness is that tile
        const inIt = room.world.inDoorway(hero.x, hero.z, 0.5 + DOOR.BODY, DOOR.HALF + DOOR.BODY);
        if (!armed) { armed = !inIt; return; }
        if (!inIt || resting > 0) return;
        armed = false;
        resting = REST;
        places.leaveBuilding();
        return;
      }

      let onTheStep: Doorway | null = null;
      for (const door of doors()) if (onThreshold(door, hero)) { onTheStep = door; break; }
      /*
       * And a castle gate, which is a door like any other now rather than a conversation.
       *
       * It used to be Enter, and then a dialogue, and then a choice — three deliberate acts to
       * walk through an open arch, when every cottage in the country opens by being walked into.
       * The passage is the way in and standing in it is the whole of the intent.
       *
       * It shares the arming latch and the rest with the doors, and has to: coming out of a castle
       * puts you back on the gate tile, so without them the gate would be a revolving door with a
       * loading screen in it.
       */
      let atTheGate: Gateway | null = null;
      if (!onTheStep) {
        for (const gate of gates()) {
          if (Math.abs(gate.x - hero.x) <= GATE_STEP && Math.abs(gate.z - hero.z) <= GATE_STEP) { atTheGate = gate; break; }
        }
      }

      if (!armed) { armed = onTheStep === null && atTheGate === null; return; }
      if ((!onTheStep && !atTheGate) || resting > 0) return;
      armed = false;
      resting = REST;
      if (atTheGate) {
        discover(atTheGate.name);
        places.enterDungeon(
          { name: atTheGate.name, x: atTheGate.x, z: atTheGate.z, out: [atTheGate.x, atTheGate.z] },
          'castle', atTheGate.id,
        );
        return;
      }
      places.enterBuilding(onTheStep!);
    },

    /** What the step is waiting for, so a test can say why nothing happened. */
    get ready(): boolean { return armed && resting <= 0; },
    /** How long this door will go on ignoring you, in seconds. */
    get resting(): number { return resting; },
  };
}
