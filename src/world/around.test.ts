import { describe, expect, it } from 'vitest';
import { aroundOf, aroundPatches, placesBetween, type Around } from './around';
import { PATCH, Patchwork, patchOf } from './patchwork';
import type { Structures } from './structures';

/**
 * What is near here.
 *
 * The question ten places in the game layer are actually asking when they take the whole world's
 * list of villages and filter it. The difference matters because the list is the load-bearing
 * assumption of the old bounded map — sixteen villages, all of them existing at once, any of them
 * reachable by looking — and none of it survives a country grown a patch at a time.
 */

const village = (name: string, x: number, z: number) =>
  ({ name, x, z, houses: [], stalls: [], radius: 20 } as unknown as Structures['villages'][number]);

const site = (name: string, x: number, z: number) => ({ id: name, name, x, z });

const country: Structures = {
  doors: [], all: [], piers: [], signposts: [], derelicts: [], castles: [],
  villages: [village('Near', 10, 0), village('Far', 400, 0), village('Middling', 120, 0)],
  pois: [site('Shrine', 30, 0)],
  caves: [site('Hollow', 200, 0)],
  wrecks: [site('Hulk', 0, 60)],
} as unknown as Structures;

describe('what is near a point', () => {
  const around: Around = aroundOf(country);

  it('answers with what is within the reach it was given, nearest first', () => {
    expect(around.villages(0, 0, 150).map((v) => v.name)).toEqual(['Near', 'Middling']);
  });

  it('says nothing at all rather than reaching for the far side of the world', () => {
    // the honest answer in an endless country: there is always another village somewhere, and a
    // caller who has not said how far it will walk has not asked a question that has an answer
    expect(around.nearestVillage(0, 0, 5)).toBeNull();
    expect(around.nearestVillage(0, 0, 150)?.name).toBe('Near');
  });

  it('treats a cave, a wreck and a shrine as the same kind of thing, which is somewhere with a name', () => {
    expect(around.places(0, 0, 100).map((p) => p.name)).toEqual(['Shrine', 'Hulk']);
  });
});

describe('somewhere worth walking to', () => {
  it('is far enough to be a journey and near enough to be this village’s business', () => {
    const around = aroundOf(country);
    const worth = placesBetween(around, { x: 0, z: 0 }, 40, 250);
    expect(worth.map((p) => p.name), 'the shrine at thirty tiles is the village itself').toEqual(['Hulk', 'Hollow']);
    expect(worth[0].d).toBeCloseTo(60, 6);
  });

  it('is nothing at all for a village in the middle of nowhere', () => {
    const empty = aroundOf({ ...country, pois: [], caves: [], wrecks: [] } as unknown as Structures);
    expect(placesBetween(empty, { x: 0, z: 0 }, 40, 250)).toEqual([]);
  });
});

/**
 * And the other half of the seam, against real country.
 *
 * Everything above is `aroundOf`, which has been exercised since the day it was written because
 * every test in this repository is a bounded world and filtering a list it already holds is what it
 * does. `aroundPatches` had none: there was no `Patchwork` of real country to point it at when it
 * was written, so the half the endless world actually depends on was argued rather than proved.
 *
 * Three things have to be true of it, and only the first is obvious.
 *
 * It has to see across a patch boundary. A hero a hundred tiles from the edge of the square he is
 * in has half his neighbourhood in the square next door, and an answer that stopped at the seam
 * would make a village vanish as he walked towards it.
 *
 * It must never grow a patch to answer. A patch is the better part of a second of country, and
 * every question in this file is asked while somebody is walking — what the compass points at, what
 * the area is called, whether a wolf may den here. A question about your surroundings that could
 * cost a second is one that stutters the frame it was asked in, so what has not been walked into is
 * simply not there yet. In a world whose ground ahead of you is still being made, that is not a
 * compromise but the only honest answer.
 *
 * And the reach has to bind, for the reason the interface refuses to make it optional.
 *
 * Two patches of real country are grown here rather than stubbed. What is being asked is whether
 * this finds villages a patch actually founded, and a stub that returns whatever the test put in it
 * cannot answer that.
 */

const SEED = 4242;

/** Two squares side by side, with the seam between them at x = 512. */
const WEST = '0,0';
const EAST = '1,0';

describe('what is near a point in an endless country', () => {
  const patches = new Patchwork(SEED);
  const west = patches.patch(WEST);
  const east = patches.patch(EAST);
  const around = aroundPatches(patches);

  it('is grown from two squares with villages in both of them', () => {
    // the ground the rest of this argues about. Without villages either side of the seam the tests
    // below would pass on a country with nothing in it
    expect(west.structures.villages.length, 'nobody lives in the west square').toBeGreaterThan(0);
    expect(east.structures.villages.length, 'nobody lives in the east square').toBeGreaterThan(0);
  });

  it('finds villages on both sides of a seam from a point standing on it', () => {
    const at = { x: PATCH, z: PATCH / 2 };
    const reach = PATCH;
    const found = around.villages(at.x, at.z, reach).map((v) => v.name);
    const inWest = west.structures.villages
      .filter((v) => Math.hypot(v.x - at.x, v.z - at.z) <= reach).map((v) => v.name);
    const inEast = east.structures.villages
      .filter((v) => Math.hypot(v.x - at.x, v.z - at.z) <= reach).map((v) => v.name);
    expect(inWest.length, 'nothing near the seam on the west side').toBeGreaterThan(0);
    expect(inEast.length, 'nothing near the seam on the east side').toBeGreaterThan(0);
    // both sides, and nothing counted twice: a village belongs to exactly one square, which is what
    // `townsIn` promises and what this would catch if it ever stopped being true
    expect([...found].sort()).toEqual([...inWest, ...inEast].sort());
  });

  it('answers nearest first, so the first one back is the one you would walk to', () => {
    const at = { x: PATCH, z: PATCH / 2 };
    const found = around.villages(at.x, at.z, PATCH);
    const away = found.map((v) => Math.hypot(v.x - at.x, v.z - at.z));
    expect(away.length, 'nothing to put in order').toBeGreaterThan(1);
    expect([...away].sort((a, b) => a - b)).toEqual(away);
    expect(around.nearestVillage(at.x, at.z, PATCH)?.name).toBe(found[0].name);
  });

  it('holds to the reach it was given, and says nothing when nothing is near enough', () => {
    const at = { x: PATCH, z: PATCH / 2 };
    for (const reach of [40, 120, PATCH]) {
      for (const v of around.villages(at.x, at.z, reach)) {
        expect(Math.hypot(v.x - at.x, v.z - at.z), `${v.name} is further than ${reach}`)
          .toBeLessThanOrEqual(reach);
      }
    }
    expect(around.nearestVillage(at.x, at.z, 1), 'a village a stone\'s throw from open country').toBeNull();
  });

  it('grows nothing to answer, however far the question reaches', () => {
    /*
     * The property everything else here rests on. With a reach of two squares this looks at
     * twenty-five patch names and holds two of them, so the other twenty-three are named, found
     * wanting and passed over. A single one of them grown would be most of a second, in the middle
     * of a frame, because somebody asked what the compass should point at.
     */
    const grown = patches.grown;
    around.villages(PATCH, PATCH / 2, PATCH * 2);
    around.nearestVillage(PATCH, PATCH / 2, PATCH * 2);
    around.places(PATCH, PATCH / 2, PATCH * 2);
    expect(patches.grown, 'a question about your surroundings grew country to answer').toBe(grown);
  });

  it('finds nothing at all in country nobody has walked into', () => {
    // far enough out that not even a two-square reach touches what has been grown
    const far = PATCH * 40;
    expect(patchOf(far, far), 'the far square is somehow one of the two held').not.toBe(WEST);
    const grown = patches.grown;
    expect(around.villages(far, far, PATCH)).toEqual([]);
    expect(around.nearestVillage(far, far, PATCH)).toBeNull();
    expect(around.places(far, far, PATCH)).toEqual([]);
    expect(patches.grown).toBe(grown);
  });

  it('finds the caves, wrecks and landmarks of both squares the same way', () => {
    const at = { x: PATCH, z: PATCH / 2 };
    const reach = PATCH;
    const mine = around.places(at.x, at.z, reach).map((p) => p.name).sort();
    const theirs = [west, east]
      .flatMap((s) => [...s.structures.pois, ...s.structures.caves, ...s.structures.wrecks])
      .filter((p) => Math.hypot(p.x - at.x, p.z - at.z) <= reach)
      .map((p) => p.name).sort();
    expect(theirs.length, 'nothing to find in either square').toBeGreaterThan(0);
    expect(mine).toEqual(theirs);
  });

  it('answers the same question a bounded world would, asked of the same country', () => {
    /*
     * The two halves of the seam side by side. A patchwork holding one square and a bounded world
     * made of that square's own structures are the same country, so anything inside that square has
     * to come back the same from both — which is what lets the game be written against `Around`
     * without knowing which kind of world it is standing in.
     */
    const one = new Patchwork(SEED);
    const only = one.patch(WEST);
    const middle = { x: PATCH / 2, z: PATCH / 2 };
    const reach = PATCH / 2;
    expect(aroundPatches(one).villages(middle.x, middle.z, reach))
      .toEqual(aroundOf(only.structures).villages(middle.x, middle.z, reach));
    expect(aroundPatches(one).places(middle.x, middle.z, reach))
      .toEqual(aroundOf(only.structures).places(middle.x, middle.z, reach));
  });

  it('asks only about squares a circle of that reach could touch', () => {
    /*
     * A cheap stand-in, so this is about which squares get named rather than about country. Even a
     * reach of ten tiles names the ring, and it has to: a point ten tiles from a corner has three
     * other squares within that ten. Naming one costs a map lookup and nothing else — it is
     * *growing* that must never happen — so the ring is the floor and the reach only widens it.
     */
    const asked: string[] = [];
    const watched = {
      has: (patch: string) => { asked.push(patch); return false; },
      patch: () => ({ structures: { villages: [], pois: [], caves: [], wrecks: [] } }),
    };
    aroundPatches(watched as never).villages(PATCH / 2, PATCH / 2, 10);
    expect(asked.sort()).toEqual(['-1,-1', '-1,0', '-1,1', '0,-1', '0,0', '0,1', '1,-1', '1,0', '1,1']);
  });
});
