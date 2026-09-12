import { describe, expect, it } from 'vitest';
import { PropKind } from '../world/biomes';
import { PROPS } from './props';
import { partPoints, type PropPart } from './shapes';
import {
  fountainBasin, fountainDry, fountainMarked, houseFrame, housePegs, houseRoof,
  poolDug, poolLined, poolMarked, storeyRaised, storeyScaffold, storeyTimber,
} from './sites';

/**
 * The mornings before a building is finished, which are the whole reason building takes days.
 *
 * A house has been worth riding past twice since the first one was commissioned. Nothing else was:
 * a pool and a fountain wore the house's pegs and string for their entire build and a second storey
 * showed nothing whatever, so three of the four things a builder will take on were a wait with
 * nothing to look at. These are about the properties that make a site read as work being done —
 * that it sits on the ground, that it stays on its own plot, that it grows, and that the water goes
 * in last.
 */

/** Every part of a prop, as the corners they actually end up at. */
const corners = (parts: readonly PropPart[]): Array<[number, number, number]> =>
  parts.flatMap((part) => partPoints(part));

const lowest = (parts: readonly PropPart[]): number =>
  Math.min(...corners(parts).map(([, y]) => y));

const tallest = (parts: readonly PropPart[]): number =>
  Math.max(...corners(parts).map(([, y]) => y));

const widest = (parts: readonly PropPart[]): number =>
  Math.max(...corners(parts).flatMap(([x, , z]) => [Math.abs(x), Math.abs(z)]));

const EVERY_STAGE: ReadonlyArray<[string, PropPart[]]> = [
  ['a house pegged out', housePegs], ['a house framed', houseFrame], ['a house roofed', houseRoof],
  ['a pool marked out', poolMarked], ['a pool dug', poolDug], ['a pool lined', poolLined],
  ['a fountain struck out', fountainMarked], ['a fountain basin', fountainBasin],
  ['a fountain standing dry', fountainDry],
  ['timber for a storey', storeyTimber], ['a scaffold', storeyScaffold],
  ['a scaffold a lift higher', storeyRaised],
];

/** The blue everything in this world holds water in: a pool, a fountain, the bucket in a well. */
const WATER = 0x2f8fbf;

describe('a building site on the mornings before it is finished', () => {
  it('stands everything on the ground rather than sunk into it', () => {
    /*
     * A prop is planted where the ground is, so anything below nought is buried and nobody ever
     * sees it. The allowance is a stake driven in: every site in this file starts with pegs, and a
     * peg standing exactly on the grass looks dropped rather than hammered.
     *
     * The ladders are what this is really watching. A leaning box's foot is arithmetic rather than
     * a number somebody typed, and getting the sign of the lean wrong buries it to the third rung.
     */
    const DRIVEN_IN = 0.01;
    for (const [what, parts] of EVERY_STAGE) {
      expect(lowest(parts), `${what} is dug into the ground`).toBeGreaterThanOrEqual(-DRIVEN_IN);
    }
  });

  it('keeps a site on its own plot', () => {
    /*
     * Wide enough for the spoil from a hole and the timber for a floor to be somewhere, and no
     * wider. The plot itself is 3x3, and an addition stands 3.4 tiles off the house it belongs to,
     * so a site that sprawled a whole tile past its own ground would put its spoil heap through
     * somebody's wall — which is why the pool heaps its first spit inside its own string.
     */
    for (const [what, parts] of EVERY_STAGE) {
      expect(widest(parts), `${what} sprawls off its own ground`).toBeLessThanOrEqual(2.35);
    }
  });

  it('puts the scaffolding round the cottage rather than inside it', () => {
    /*
     * The argument that made a second storey drawable at all. It shares its tile with the finished
     * house it is being added to and both are drawn, so anything at a height a person could stand
     * at has to be outside the walls — otherwise it is a timber skeleton in a room the player can
     * walk into, which is why this job drew nothing for as long as the only idea was a frame.
     *
     * Above the ridge the rule lifts, and it has to: the hoist beam that swings the new floor's
     * timbers up reaches in over the middle of the roof, which is where they are going.
     */
    const WALL = 1.2, RIDGE = 2.8;
    const inside: string[] = [];
    for (const [what, parts] of [
      ['timber for a storey', storeyTimber], ['a scaffold', storeyScaffold],
      ['a scaffold a lift higher', storeyRaised],
    ] as const) {
      for (const part of parts) {
        const at = partPoints(part);
        if (Math.min(...at.map(([, y]) => y)) >= RIDGE) continue;
        const clear = Math.min(...at.map(([x]) => x)) >= WALL
          || Math.max(...at.map(([x]) => x)) <= -WALL
          || Math.min(...at.map(([, , z]) => z)) >= WALL
          || Math.max(...at.map(([, , z]) => z)) <= -WALL;
        if (!clear) inside.push(`${what}: a part standing in the room`);
      }
    }
    expect(inside, 'drawn inside a house somebody can walk into').toEqual([]);
  });

  it('grows over the three mornings a storey takes', () => {
    // the whole of what riding past twice is for: timber lying in the yard, then a scaffold to the
    // eaves, then one that has gone a lift above the ridge and has a hoist on it
    expect(tallest(storeyTimber)).toBeLessThan(tallest(storeyScaffold));
    expect(tallest(storeyScaffold)).toBeLessThan(tallest(storeyRaised));
  });

  it('connects the water last, which is what the mason would do', () => {
    /*
     * A pool is a hole and then a dry stone tank; a fountain stands complete and dry for a morning
     * before anything runs out of it. Drawing either of them with less water in than usual would
     * say the thing leaks rather than that it is being built, so the blue arrives on the last day
     * or not at all.
     */
    const holds = (parts: readonly PropPart[]): boolean => parts.some((part) => part.color === WATER);
    for (const [what, parts] of [
      ['a pool marked out', poolMarked], ['a pool dug', poolDug], ['a pool lined', poolLined],
      ['a fountain struck out', fountainMarked], ['a fountain basin', fountainBasin],
      ['a fountain standing dry', fountainDry],
    ] as const) {
      expect(holds(parts), `${what} has water in it before it is finished`).toBe(false);
    }
    expect(holds(PROPS.get(PropKind.Pool)?.parts ?? []), 'a finished pool is dry').toBe(true);
    expect(holds(PROPS.get(PropKind.Fountain)?.parts ?? []), 'a finished fountain is dry').toBe(true);
  });
});
