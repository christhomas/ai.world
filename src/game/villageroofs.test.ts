import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Biome, PropKind } from '../world/biomes';
import { StructureKind, type Structure, type Village } from '../world/structures';
import { fieldWork } from '../world/fields';
import type { TerrainSampler } from '../world/terrain';
import { propOf } from '../render/site';
import { raisedRoofs, raisedStage, roofWatch, whatTheVillagesRaised } from './villageroofs';

function plot(tx: number, tz: number, biome: Biome = Biome.Plains): Structure {
  return { kind: StructureKind.House, tx, tz, hw: 1, hd: 1, level: 0, rot: 0, biome, path: [] };
}

function village(name: string, spare: Structure[], biome: Biome = Biome.Plains): Village {
  const hall = plot(2, 3, biome);
  hall.kind = StructureKind.TownHall;
  return {
    name, x: 0, z: 0, radius: 12, level: 0, biome,
    houses: [], spare, shops: [], pub: null, station: null, stable: null,
    church: null, churchDoor: null, hall: { building: hall, door: [2, 1] }, watchHouse: null, board: null, stalls: [],
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

  it('draws a voted hall on its reserved site in the country model while work advances', () => {
    const town = village('Fell', [], Biome.Snow);
    const [hall] = raisedRoofs([town], () => ['townhall@100'], 102);
    expect(hall).toMatchObject({ id: 'Fell-hall', x: 2.5, z: 3.5, stage: 'begun', what: `civic-townhall-${Biome.Snow}` });
    expect(propOf({ ...hall, stage: 'done' })).toBe(PropKind.TownHallSnow);
  });
});

/*
 * The roofs and the acres are one book and one question, and the boot file is not where it is asked.
 *
 * `works` holds a raised roof and a cleared acre alike, and both are wanted once a day rather than
 * sixty times a second. `whatTheVillagesRaised` is the one call that says so — it tells the register
 * who may clear an acre this morning, tells the ground which trees the cleared acres took, and hands
 * back the roofs. The boot file having its own copy of that wiring is the thing this pair is
 * against: `main.ts` is assembly, and a feature that needs six lines of it has put its wiring in the
 * wrong place.
 */
describe('what the villages raised, asked once', () => {
  it('tells the register who surveys a field and the ground which acres were cleared', () => {
    let survey: unknown = null;
    let cleared: Array<{ x: number; z: number }> | null = null;
    const works = ['house:cottage', fieldWork('farm-1', 4, 9)];
    const roofs = whatTheVillagesRaised(
      { worksOf: () => works, fieldsAreSurveyedBy: (asked) => { survey = asked; } },
      () => [village('Ashby', [plot(4, 9)])],
      // the survey is handed the sampler and this test never runs one, so a stand-in is honest
      // here: what is under test is that the register was given a surveyor at all
      null as unknown as TerrainSampler,
      { clearFields: (tiles) => { cleared = [...tiles]; } },
    );
    expect(typeof survey, 'the register was never told how a farm surveys its ground').toBe('function');
    // the precondition, before the behaviour: nothing is cleared until somebody asks for a day
    expect(cleared, 'the ground was told before anybody asked what day it was').toBeNull();
    expect(roofs(3.1)).toHaveLength(1);
    expect(cleared, 'the ground was never told which acres the village had cleared').toEqual([{ x: 4, z: 9 }]);
  });

  /*
   * And the boot file goes through it. A behaviour test of the call above cannot notice that nothing
   * makes it — which is exactly how this export sat written, documented and unreached while the six
   * lines it replaces lived in `main.ts`. So the shape is asserted the way `growworld.test.ts`
   * asserts its own: by reading the source.
   */
  it('is what the boot file asks for, rather than six lines of the same wiring', () => {
    const boot = readFileSync('src/main.ts', 'utf8');
    expect(boot.includes('whatTheVillagesRaised('),
      'main.ts no longer asks villageroofs.ts for the roofs and the acres together').toBe(true);
    expect(boot.includes('fieldsAreSurveyedBy'),
      'main.ts has gone back to wiring the field survey itself').toBe(false);
  });
});

describe('asking about them once a day rather than sixty times a second', () => {
  it('sees work appended by a vote before the day turns', () => {
    let works = ['house:a'];
    const watch = roofWatch(() => [village('Ashby', [plot(4, 9), plot(7, 9)])], () => works);
    expect(watch(3.1)).toHaveLength(1);
    works = ['house:a', 'townhall@3'];
    expect(watch(3.9).map((site) => site.id)).toContain('Ashby-hall');
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
