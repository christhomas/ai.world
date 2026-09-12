import { describe, expect, it } from 'vitest';
import { BUILD, BUILDS, Houses, buildable, deposit, onOffer, type Commission } from './building';
import { canBuildOnShore } from './siting';
import { jettiesIn, mooringOf } from './jetties';
import { BOAT, moorageFor } from './sailing';

/**
 * The first tech tree this game has: a jetty, and then boats off it.
 *
 * Two rules make it one, and both of them turn on a word that was already on the table. A boat
 * needs a jetty within reach because she has to be tied up when nobody is aboard her; a jetty is
 * what that means, so asking it of itself would be a rule no coast in the world could satisfy and
 * neither the first jetty nor the first boat could ever be built. `moves` is the difference, and
 * these are about the two places it has to be read the same way — the pub, where a deposit that is
 * not refundable changes hands, and the shore, where the ground is actually asked.
 *
 * The third is the seam. `structures.piers` is grown from the seed and a jetty somebody paid for
 * cannot be in it, so everything that asks "is there a jetty near here" has to ask about both or
 * the first one a player builds is a row of boards nothing in the game can see.
 */

const village = { x: 20, z: 20 };
const jetty = buildable(BUILDS.JETTY);
const boat = buildable(BUILDS.BOAT);

/** A shore, described to the rules as the world would describe it. */
const shore = (over: Partial<{ toWater: number; toJetty: number; level: number }> = {}) =>
  ({ toWater: 1, toJetty: 4, level: 1, ...over });

const onShore = (wants: typeof jetty, over = {}) =>
  canBuildOnShore(wants, 0, 0, true, village, [], true, shore(over));

/** A jetty standing at the given spot, run out the given way. */
function built(x: number, z: number, rot: number, began = 1): Commission {
  const houses = new Houses();
  houses.takeOn('Ashford', jetty.price, deposit(jetty.price), BUILDS.JETTY);
  return houses.place(x, z, began, rot)!;
}

describe('a jetty, and the boats that follow it', () => {
  it('does not ask itself for the thing it is', () => {
    // the circularity, refused in one condition. A coast with no jetty on it takes a jetty, and
    // the same coast refuses a boat until there is one
    expect(onShore(jetty, { toJetty: Infinity }).ok, 'the first jetty could never be built').toBe(true);
    expect(onShore(boat, { toJetty: Infinity }).ok, 'a boat with nowhere to lie was allowed').toBe(false);
  });

  it('wants the water at the end of it, whichever of the two is being built', () => {
    expect(onShore(jetty, { toWater: Infinity }).ok).toBe(false);
    expect(onShore(boat, { toWater: Infinity }).ok).toBe(false);
  });

  it('refuses a bank too high to leave level, which is a cliff rather than a harbour', () => {
    /*
     * The same rule `piers.ts` lays the country's own piers by, and the sentence there is the
     * argument: above this the thing that gets built is a wall of planks with a staircase down it
     * and a boat tied to the bottom. A player paying three hundred and forty gold deserves the
     * refusal rather than the wall.
     */
    expect(onShore(jetty, { level: BUILD.HARBOUR_LEVEL }).ok).toBe(true);
    expect(onShore(jetty, { level: BUILD.HARBOUR_LEVEL + 1 }).ok, 'a jetty off a cliff').toBe(false);
    // and a hull is not held to it: she is built on whatever shore there is and slid down it
    expect(onShore(boat, { level: BUILD.HARBOUR_LEVEL + 4 }).ok).toBe(true);
  });

  it('offers the same tree in the pub that the ground will enforce on the shore', () => {
    /*
     * The deposit is not refundable, so a menu that offered what the ground refuses would take
     * sixty-four gold for a job that can never be placed. A village with a coast and no harbour is
     * offered the jetty and not the boat, which is the whole tech tree in one line of a filter.
     */
    const inland = onOffer([], 10, { water: false, harbour: false }).map((e) => e.id);
    expect(inland).not.toContain(BUILDS.JETTY);
    expect(inland).not.toContain(BUILDS.BOAT);

    const coast = onOffer([], 10, { water: true, harbour: false }).map((e) => e.id);
    expect(coast, 'a coast with no harbour could not raise its first jetty').toContain(BUILDS.JETTY);
    expect(coast, 'a boat was offered where there is nowhere to tie one up').not.toContain(BUILDS.BOAT);

    const harbour = onOffer([], 10, { water: true, harbour: true }).map((e) => e.id);
    expect(harbour).toContain(BUILDS.JETTY);
    expect(harbour).toContain(BUILDS.BOAT);
  });
});

describe('every jetty in the world, however it got there', () => {
  it('counts the ones the country was grown with and the ones somebody paid for', () => {
    const seeded = { dockX: 100, dockZ: 0, dx: 1, dz: 0 };
    const mine = built(10, 0, 0);
    const day = 1 + jetty.days;

    expect(jettiesIn([seeded], [], day), 'the world lost its own piers').toHaveLength(1);
    expect(jettiesIn([seeded], [mine], day), 'a jetty somebody paid for was not one').toHaveLength(2);
    // and the country's own come first, so the nearest of two at equal distance is a stable answer
    expect(jettiesIn([seeded], [mine], day)[0]).toBe(seeded);
  });

  it('is a jetty the day the last board goes down, not the day it is paid for', () => {
    /*
     * The difference between a jetty and a boat, and it is the public one. A boat is handed over
     * when she is paid for, because the builder holds her until he has his money. A jetty is not
     * anybody's: the day the boards are down it is a place boats tie up, and there is nobody for it
     * to be handed to. What an unpaid balance costs is what it costs for a house — the village
     * hears about it every morning.
     */
    const mine = built(10, 0, 0);
    expect(jettiesIn([], [mine], 1 + jetty.days - 1), 'boats tied up to a row of piles').toHaveLength(0);
    expect(jettiesIn([], [mine], 1 + jetty.days)).toHaveLength(1);
  });

  it('counts nothing else anybody has had built', () => {
    const houses = new Houses();
    houses.takeOn('Ashford', BUILD.PRICE, deposit(), BUILDS.HOUSE);
    const house = houses.place(10, 0, 1, 0)!;
    expect(jettiesIn([], [house], 500), 'a house was moored to').toHaveLength(0);
  });

  it('moors alongside it, the way the builder ran her out', () => {
    // she lies beside the boards rather than off the end of them, which is what a small boat does
    // at a landing stage — and, here, the only place she could be that anybody could reach
    const east = mooringOf(built(10.5, 0.5, 0));
    expect(east.dockX, 'not alongside the near end').toBeGreaterThan(10.5);
    expect(east.dockZ, 'moored on the deck rather than beside it').not.toBe(0);
    expect(east.dx).toBeCloseTo(1, 5);

    // and run out the other way she lies the other way: the bearing is the builder's, taken off
    // the water rather than off wherever the player happened to be standing
    const west = mooringOf(built(10.5, 0.5, Math.PI));
    expect(west.dockX).toBeLessThan(10.5);
    expect(west.dx).toBeCloseTo(-1, 5);
  });

  it('leaves her near enough the bank that somebody standing on it can climb aboard', () => {
    /*
     * The consequence of a commissioned jetty being drawn rather than stamped into the terrain. One
     * of the country's own piers is ground you walk out along, so a boat at the end of it is a boat
     * you can reach; this one is a prop, its boards are something you see rather than stand on, and
     * a hull tied five tiles out past them would be a hull nobody could ever board.
     */
    const shoreTile = { x: 60.5, z: 0.5 };
    const mine = built(shoreTile.x, shoreTile.z, 0);
    const lies = moorageFor(shoreTile, jettiesIn([], [mine], 1 + jetty.days))!;
    expect(lies, 'a boat with nowhere to lie on a coast its owner built a jetty on').not.toBeNull();
    expect(Math.hypot(lies.x - shoreTile.x, lies.z - shoreTile.z), 'moored out of reach of the shore')
      .toBeLessThan(BOAT.REACH);
  });
});
