import { describe, expect, it } from 'vitest';
import { StructureKind } from '../world/structures';
import { DAY_LENGTH } from './state';
import { FERRY, type FerryLine } from './ferry';
import { Sailing } from './sailing';
import { travelInteractions } from './interact/travel';
import { villageInteractions } from './interact/village';
import { wildInteractions } from './interact/wild';

const crossing = {
  id: 'ferry:test', islandId: 'far', fromName: 'Ashford', toName: 'Farhaven',
  fromPier: { dockX: 0, dockZ: 0 }, toPier: { dockX: 120, dockZ: 0 },
  travel: 20, dwell: FERRY.DWELL, period: FERRY.MIN_PERIOD,
} as FerryLine;

describe('the label on the contextual action card', () => {
  it('names boarding at a dock and the timetable/boat dialogue at an empty pier', () => {
    const player = { x: .5, z: .5 };
    const state = { day: 1, time: 0 };
    let opened: { speaker: string; choices?: Array<{ label: string }> } | null = null;
    const travel = travelInteractions({
      player, state, sailing: new Sailing(), ferries: [{ line: crossing }],
      dialogue: { start: (page: typeof opened) => { opened = page; } },
    } as never);

    expect(travel.tryFerry(true)).toBe(true);
    expect(travel.ferryLabel()).toBe('Board the ferry');

    state.time = 30 / DAY_LENGTH; // the hull is under way, but the timetable is still at the pier
    expect(travel.tryFerry(true)).toBe(true);
    expect(travel.ferryLabel()).toBe('Check ferry times or buy a boat');
    expect(travel.tryFerry()).toBe(true);
    expect(opened?.speaker).toBe('Timetable');
    expect(opened?.choices?.map((choice) => choice.label)).toContain('Ask after a boat of your own');
  });

  it('lets an owned hull claim both the preview and the press beside a ferry pier', () => {
    const sailing = new Sailing();
    sailing.buy(.5, .5, 0);
    const travel = travelInteractions({
      player: { x: .5, z: .5 }, state: { day: 1, time: 0 }, sailing,
      ferries: [{ line: crossing }],
    } as never);

    expect(travel.tryFerry(true), 'the preview promised a ferry but the press boards the owned boat').toBe(false);
  });

  it.each([
    [{ kind: StructureKind.Shrine, x: 0, z: 0, name: 'The Nine Stones' }, [], 'Enter The Nine Stones'],
    [{ kind: StructureKind.GiantTree, x: 0, z: 0, name: 'The Old Ash' }, [], 'Enter The Old Ash'],
    [null, [{ x: 0, z: 0, name: 'Coldwater Cave' }], 'Enter Coldwater Cave'],
  ] as const)('names the actual wild entrance', (poi, caves, label) => {
    const wild = wildInteractions({
      player: { x: 0, z: 0 },
      structures: { pois: poi ? [poi] : [], caves, villages: [] },
    } as never);

    expect(wild.tryShrine(true)).toBe(true);
    expect(wild.shrineLabel()).toBe(label);
  });

  it('names the stablehand conversation when there is no horse to ride', () => {
    const village = villageInteractions({
      player: { x: 3, z: 5 },
      mount: { riding: false, near: () => false },
      entities: { within: () => [{ name: 'Mara', role: 'stablehand' }] },
    } as never);

    expect(village.tryHorse(true)).toBe(true);
    expect(village.horseLabel()).toBe('Talk to Mara');
  });
});
