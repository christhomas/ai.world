import { describe, expect, it } from 'vitest';
import { createDoorsteps } from './doorways';
import type { Doorway } from '../world/structures';
import type { Places } from './places';

/**
 * Walking into a door goes in.
 *
 * A door used to stop you and then wait for a keystroke, which is one rule more than the rest of
 * the world has: everything else solid is walked into. The awkward half of this is not the going
 * in — it is the coming out. Leaving a building puts the hero one tile beyond the doorway, which
 * is close enough that the next step in any direction could round him straight back inside; he
 * would come out of a shop and be in it again before he had finished leaving.
 */

/**
 * A doorway, and the house it belongs to.
 *
 * The house matters: which way a door faces is not written on it, and does not need to be — the
 * door's tile is one step out from the middle of its building, so the way through is whichever
 * axis the two differ on. `bx`/`bz` here put the house one tile north of the door, so the door
 * faces south and its wall runs east-west.
 */
const door = (x: number, z: number): Doorway =>
  ({ x, z, bx: x - 0.5, bz: z - 2.5, village: 'Testford', kind: 'house' } as Doorway);

/**
 * Where the leaf of that door actually hangs.
 *
 * The `Doorway` record is the tile you stand on to knock — two tiles out from the middle of the
 * house. The door itself is at 1.22, which is most of a tile nearer, and that gap is the whole of
 * what was wrong: the trigger used to sit on the record, out in the street, so it fired at anybody
 * crossing the frontage. Written out here so the tests aim at the door rather than at a number
 * copied from the code they are testing.
 */
const LEAF = (d: Doorway): { x: number; z: number } => ({ x: d.bx + 0.5, z: d.bz + 0.5 + 1.22 });

/**
 * A `Places` with nothing in it but the facts a doorstep asks about.
 *
 * The room it puts you in has a door of its own at the middle of its south wall, because that is
 * what an interior has, and walking at that one from the inside is the other half of the rule.
 */
function rooms(roomDoor: [number, number] = [5, 9]) {
  const entered: Array<[number, number]> = [];
  let left = 0;
  const inside = {
    world: {
      fromDoor: (x: number, z: number) => Math.hypot(roomDoor[0] + 0.5 - x, roomDoor[1] + 0.5 - z),
      // the room's door is the middle of its south wall, so z is the way through and x is the wall
      inDoorway: (x: number, z: number, across: number, along: number) =>
        Math.abs(z - (roomDoor[1] + 0.5)) <= across && Math.abs(x - (roomDoor[0] + 0.5)) <= along,
    },
  };
  const places = {
    indoors: null as unknown,
    underground: null as unknown,
    enterBuilding: (d: Doorway) => { entered.push([d.x, d.z]); places.indoors = inside; },
    leaveBuilding: () => { left++; places.indoors = null; },
  };
  return { places, entered, get left() { return left; }, as: () => places as unknown as Places };
}

describe('walking into a door', () => {
  it('goes in, once the hero has been clear of one', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);

    // it starts disarmed: the very first frame of a world could be anywhere, including a doorstep
    steps.step({ x: 10, z: 10 });
    expect(world.entered, 'not before the hero has been outside one').toEqual([]);

    // walk away, which is what arms it
    steps.step({ x: 14, z: 10 });
    expect(steps.ready).toBe(true);

    // and back, this time arriving on the door itself
    steps.step(LEAF(door(10, 10)));
    expect(world.entered).toEqual([[10, 10]]);
  });

  it('does not swallow somebody walking past', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    // standing on the tile you knock from, which is where the trigger used to be and is not the door
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toEqual([]);
  });

  it('is a doorway and not a frontage', () => {
    // The trigger used to be a circle of radius 0.62 round the door, which is wider than the tile
    // the door is on and reached into both its neighbours; a village street of cottages would take
    // you into each one as you walked along it. A door is wide the way you go through it and narrow
    // along the wall it is cut into.
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 14 });
    const leaf = LEAF(door(10, 10));
    // walking the length of the wall, at the leaf's own distance from the middle of the house
    for (const x of [8.8, 9.2, 10.8, 11.2]) {
      steps.step({ x, z: leaf.z });
      expect(world.entered, `walking past at x=${x}`).toEqual([]);
    }
    // and squarely in the doorway, which is the one place it fires
    steps.step(leaf);
    expect(world.entered).toEqual([[10, 10]]);
  });

  it('does not put the hero back in the building he has just left', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    steps.step(LEAF(door(10, 10)));
    expect(world.entered, 'in').toHaveLength(1);

    // leaving stands him a tile beyond the doorway, and he takes a step or two from there
    world.places.indoors = null;
    for (const at of [{ x: 10, z: 10.4 }, { x: 10, z: 10.1 }, { x: 10.2, z: 10.6 }]) steps.step(at);
    expect(world.entered, 'and stays out').toHaveLength(1);

    // he is let back in once he has actually gone somewhere
    steps.step({ x: 13, z: 13 });
    steps.step(LEAF(door(10, 10)));
    expect(world.entered).toHaveLength(2);
  });

  it('lets him walk back out of the room he walked into', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    steps.step(LEAF(door(10, 10)));
    expect(world.entered, 'in').toHaveLength(1);

    // he arrives a tile inside the room, off the threshold, which is what arms it again
    steps.step({ x: 5.5, z: 8.5 });
    expect(world.left, 'standing inside is not leaving').toBe(0);

    // and walking back at the door takes him out, without pressing anything. He does not have to
    // cross the room first: the old rule made him walk two tiles clear before a door worked again,
    // which in a shop the size of a shop meant the door often did nothing at all
    steps.step({ x: 5.5, z: 9.5 });
    expect(world.left, 'out').toBe(1);
  });

  it('does not put him out through a door he is only walking past inside', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    steps.step(LEAF(door(10, 10)));
    steps.step({ x: 5.5, z: 6 });          // clear of the room's door: armed
    steps.step({ x: 7.2, z: 9.5 });        // along the south wall, a tile and a bit off the doorway
    expect(world.left).toBe(0);
  });

  it('does nothing at all underground, where the way out is a stair and not a door', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    world.places.underground = {};
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toEqual([]);
    // and coming back up does not leave it armed from before: climbing out lands you on a doorstep
    world.places.underground = null;
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toEqual([]);
  });

  it('reads the doors afresh, so a house the player builds has one', () => {
    const world = rooms();
    let doors: Doorway[] = [];
    const steps = createDoorsteps(world.as(), () => doors);
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toEqual([]);
    doors = [door(10, 10)];
    steps.step({ x: 20, z: 20 });
    steps.step(LEAF(door(10, 10)));
    expect(world.entered).toEqual([[10, 10]]);
  });
});
