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

const door = (x: number, z: number): Doorway => ({ x, z, bx: 0, bz: 0, village: 'Testford', kind: 'house' } as Doorway);

/** A `Places` with nothing in it but the two facts a doorstep asks about, and a note of the way in. */
function rooms() {
  const entered: Array<[number, number]> = [];
  const places = {
    indoors: null as unknown,
    underground: null as unknown,
    enterBuilding: (d: Doorway) => { entered.push([d.x, d.z]); places.indoors = {}; },
  };
  return { places, entered, as: () => places as unknown as Places };
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

    // and back, this time arriving on the step
    steps.step({ x: 10.3, z: 10 });
    expect(world.entered).toEqual([[10, 10]]);
  });

  it('does not swallow somebody walking past', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    // a tile and a bit off the doorway: near enough to press a key at, not near enough to be taken in
    steps.step({ x: 11.2, z: 10 });
    expect(world.entered).toEqual([]);
  });

  it('does not put the hero back in the building he has just left', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    steps.step({ x: 10, z: 10 });
    expect(world.entered, 'in').toHaveLength(1);

    // leaving stands him one tile beyond the doorway, and he takes a step or two from there
    world.places.indoors = null;
    for (const at of [{ x: 10, z: 11 }, { x: 10, z: 10.8 }, { x: 10.2, z: 11.1 }]) steps.step(at);
    expect(world.entered, 'and stays out').toHaveLength(1);

    // he is let back in once he has actually gone somewhere
    steps.step({ x: 13, z: 13 });
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toHaveLength(2);
  });

  it('does nothing at all while the hero is already inside something', () => {
    const world = rooms();
    const steps = createDoorsteps(world.as(), () => [door(10, 10)]);
    steps.step({ x: 14, z: 10 });
    world.places.underground = {};
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toEqual([]);
    // and coming back up does not leave it armed from before, because the way out is a doorstep too
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
    steps.step({ x: 10, z: 10 });
    expect(world.entered).toEqual([[10, 10]]);
  });
});
