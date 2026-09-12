import { describe, expect, it } from 'vitest';
import { aroundOf, placesBetween, type Around } from './around';
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
