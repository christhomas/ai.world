import { describe, expect, it } from 'vitest';
import { FERRY, fareFor, ferryStateAt, makeFerryLines, type FerryLine } from './ferry';
import { TerrainSampler } from '../world/terrain';
import { generateRoadGraph } from '../world/graph';
import { BOAT } from './sailing';

/**
 * A ferry that charges nothing is not a ferry.
 *
 * Reported by somebody who got on one: the crossing was free, and the only thing on that pier
 * wanting money was the boatwright selling hulls — "it appears to just let you buy the boat itself.
 * That's not a ferry." Two faults in one press of a key. The boat sale was tried before the ferry,
 * so the man with the timetable never got a word in (`interact/index.ts`), and the crossing itself
 * was free: a man with a boat rowing strangers about for nothing.
 *
 * The fare is a distance rather than a number per village, because a ferry *is* a distance: the
 * same man, the same boat, twice as far to row and twice as far to row back.
 */
const line = (across: number): FerryLine => ({
  fromName: 'Ashford', toName: 'Farhaven',
  fromPier: { dockX: 0, dockZ: 0 } as FerryLine['fromPier'],
  toPier: { dockX: across, dockZ: 0 } as FerryLine['toPier'],
} as FerryLine);

describe('what a crossing costs', () => {
  it('asks for something, whatever the crossing', () => {
    expect(fareFor(line(0))).toBeGreaterThan(0);
    expect(fareFor(line(0))).toBeGreaterThanOrEqual(FERRY.BASE);
  });

  it('asks more for a longer one', () => {
    expect(fareFor(line(400))).toBeGreaterThan(fareFor(line(40)));
  });

  it('is whole gold, because nobody was ever charged eleven and a half for anything', () => {
    for (const across of [0, 7, 31, 155, 600]) {
      expect(Number.isInteger(fareFor(line(across))), `${across} tiles priced in halves`).toBe(true);
    }
  });

  it('stays far under the price of a hull of your own', () => {
    /*
     * The two are meant to be different answers to the same question. A boat is "go where you like
     * when you like" and costs accordingly; a ferry is "cheap, and you wait for it". They stop
     * being different choices the day a crossing costs what a boat costs.
     */
    expect(fareFor(line(1200)) * 9, 'the longest crossing there could be is a third of a boat')
      .toBeLessThan(BOAT.PRICE);
    expect(fareFor(line(90)) * 15, 'an ordinary crossing costs as much as a hull')
      .toBeLessThan(BOAT.PRICE);
  });

  it('is the same price every time it is asked, on both sides of the water', () => {
    // a fare quoted at one pier and charged at the other would be the sort of thing nobody notices
    // until somebody is short by two gold on a beach
    const crossing = line(220);
    expect(fareFor(crossing)).toBe(fareFor(crossing));
    const back = { ...crossing, fromPier: crossing.toPier, toPier: crossing.fromPier };
    expect(fareFor(back)).toBe(fareFor(crossing));
  });
});

describe('the boat itself', () => {
  it('ties up at each end long enough to be boarded', () => {
    // the fare is only reachable while she is docked, so the dwell is part of the price being
    // payable at all: a boat that never sits still is a timetable nobody can use
    const crossing = line(120);
    let docked = 0;
    for (let t = 0; t < 600; t += 5) if (ferryStateAt(crossing, t).docked) docked += 5;
    expect(docked, 'the ferry never ties up anywhere').toBeGreaterThan(0);
  });
});

describe('a pier that has a ferry and a boat for sale', () => {
  /*
   * The second thing the game promised and could not do, found by walking to every pier in a world.
   *
   * `travel.ts` states the rule correctly — "somebody standing on a pier where a ferry calls means
   * the ferry; the boat is what is for sale when there is no crossing to take" — and there was no
   * world in which its second half was true. Piers are only ever generated in pairs, one on the
   * mainland and one on an island, and a line is made wherever such a pair exists. So every pier in
   * every world has a crossing, the boatwright was unreachable, and a price, a purchase and a
   * "come back with 220 gold" refusal were written for a conversation nobody could open.
   */
  it('makes a line for every pair of piers, which is every pier there is', () => {
    for (const seed of [3, 11, 4242]) {
      const sampler = new TerrainSampler(generateRoadGraph(seed));
      const piers = sampler.structures.piers;
      if (piers.length === 0) continue;
      const lines = makeFerryLines(sampler.structures, sampler.structures.villages);
      const served = new Set(lines.flatMap((line) => [line.fromPier, line.toPier]));
      expect(served.size, `seed ${seed}: a pier with no crossing, which is what the boatwright wanted`)
        .toBe(piers.length);
    }
  });
});
