import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { StructureKind, type Structure, type Village } from '../world/structures';
import { raisedRoofs, raisedStage, roofWatch } from './villageroofs';

function plot(tx: number, tz: number, biome: Biome = Biome.Plains): Structure {
  return { kind: StructureKind.House, tx, tz, hw: 1, hd: 1, level: 0, rot: 0, biome, path: [] };
}

function village(name: string, spare: Structure[]): Village {
  return {
    name, x: 0, z: 0, radius: 12, level: 0, biome: Biome.Plains,
    houses: [], spare, shops: [], pub: null, station: null, stable: null,
    church: null, churchDoor: null, hall: null, watchHouse: null, board: null, stalls: [],
  } as unknown as Village;
}

describe('the houses a village raised for itself', () => {
  it('draws one for every roof in the books, on the plots the founding left', () => {
    const drawn = raisedRoofs([village('Ashby', [plot(4, 9), plot(7, 9)])], () => ['house:cottage', 'house:longhouse']);
    expect(drawn.map((r) => [r.x, r.z])).toEqual([[4.5, 9.5], [7.5, 9.5]]);
    expect(drawn.every((r) => r.stage === 'done')).toBe(true);
  });

  it('counts only roofs, and no other work in the same books', () => {
    const drawn = raisedRoofs([village('Ashby', [plot(4, 9), plot(7, 9)])], () => ['wages', 'house:cottage']);
    expect(drawn).toHaveLength(1);
  });

  /*
   * The books can run ahead of the ground: a village that has raised more roofs than the founding
   * found room for is a village whose next house has nowhere to stand. Inventing a plot here would
   * put one through a paddock wall, so the extra is simply not drawn.
   */
  it('draws no more than there are plots, however well the books have gone', () => {
    const drawn = raisedRoofs([village('Ashby', [plot(4, 9)])], () => ['house:a', 'house:b', 'house:c']);
    expect(drawn).toHaveLength(1);
  });

  it('asks each country for its own cottage, so a snow village is not built of plains', () => {
    const drawn = raisedRoofs([village('Fell', [plot(4, 9, Biome.Snow)])], () => ['house:cottage']);
    expect(drawn[0].what).toBe(`raised-${Biome.Snow}`);
  });

  it('gives every roof a name of its own, so two villages do not share a site', () => {
    const towns = [village('Ashby', [plot(4, 9)]), village('Fell', [plot(4, 9)])];
    const drawn = raisedRoofs(towns, () => ['house:cottage']);
    expect(new Set(drawn.map((r) => r.id)).size).toBe(2);
  });
});

describe('asking about them once a day rather than sixty times a second', () => {
  it('works the answer out again when the day turns', () => {
    let works = ['house:a'];
    const watch = roofWatch(() => [village('Ashby', [plot(4, 9), plot(7, 9)])], () => works);
    expect(watch(3.1)).toHaveLength(1);
    works = ['house:a', 'house:b'];
    expect(watch(3.9)).toHaveLength(1);      // still the same day, so still the same answer
    expect(watch(4.0)).toHaveLength(2);
  });

  it('and again when a patch arrives with a village on it, which does not wait for morning', () => {
    const towns = [village('Ashby', [plot(4, 9)])];
    const watch = roofWatch(() => towns, () => ['house:a']);
    expect(watch(3.1)).toHaveLength(1);
    towns.push(village('Fell', [plot(9, 4)]));
    expect(watch(3.1)).toHaveLength(2);
  });
});

/*
 * Item 79: a village's building work has mornings now.
 *
 * It was drawn finished the day it was paid for, because the ledger recorded what was bought and
 * never when it was begun — so villages were the one builder in the world that could not use the
 * four stages a passer-by reads a site by, which is most of what the stages are for.
 */
describe('how far along a village roof is', () => {
  it('walks the four stages over the six days it takes', () => {
    const begun = 'house:cottage@100';
    expect(raisedStage(begun, 100)).toBe('marked');
    expect(raisedStage(begun, 102)).toBe('begun');
    expect(raisedStage(begun, 104)).toBe('nearly');
    expect(raisedStage(begun, 106)).toBe('done');
    expect(raisedStage(begun, 400)).toBe('done');
  });

  /*
   * A real answer rather than a missing one. Every roof raised before the morning was written down
   * was already standing when anybody started counting, and saying so is the truth about it.
   */
  it('calls a roof with no morning against it finished, which it is', () => {
    expect(raisedStage('house:longhouse', 100)).toBe('done');
    expect(raisedStage('house', 100)).toBe('done');
  });

  it('draws a village mid-build as a site rather than as a house', () => {
    const drawn = raisedRoofs([village('Ashby', [plot(4, 9)])], () => ['house:cottage@100'], 102);
    expect(drawn[0].stage).toBe('begun');
  });

  it('and everything as finished when nobody says what day it is', () => {
    const drawn = raisedRoofs([village('Ashby', [plot(4, 9)])], () => ['house:cottage@100']);
    expect(drawn[0].stage).toBe('done');
  });

  it('asks the same question again when the day turns, because the frame has moved on', () => {
    const watch = roofWatch(() => [village('Ashby', [plot(4, 9)])], () => ['house:cottage@100']);
    expect(watch(100.5)[0].stage).toBe('marked');
    expect(watch(104.1)[0].stage).toBe('nearly');
    expect(watch(106.0)[0].stage).toBe('done');
  });
});
