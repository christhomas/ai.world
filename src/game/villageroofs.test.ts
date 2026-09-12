import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { StructureKind, type Structure, type Village } from '../world/structures';
import { raisedRoofs, roofWatch } from './villageroofs';

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
