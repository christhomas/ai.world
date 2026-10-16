import { describe, expect, it } from 'vitest';
import { browserWorlds, type BrowserWorldSnapshot } from './worlds';
import { browserWorldSurvey, browserWorldView } from './world-view';

describe('tools reading the game database', () => {
  const saved: BrowserWorldSnapshot = { files: [
    ['worlds/world-records.json', JSON.stringify([{ name: 'chris', seed: 3, kind: 'road' }])],
    ['worlds/3.json', JSON.stringify({ seed: 3, clock: { day: 7, time: 12 }, deltas: [],
      manifest: { rootSeed: 3, anchors: [], terrain: [] } })],
    ['worlds/3/0_0.json', JSON.stringify({ when: 7, deltas: [{ kind: 'sow', tile: '1,2', crop: 'wheat', day: 6 }] })],
  ], slots: [{ seed: 3, worldName: 'an old hero name', world: 'endless', state: { day: 1 } }] };

  it('enumerates authoritative named records once and keeps their kind and name', () => {
    expect(browserWorlds(saved)).toEqual([{ seed: 3, name: 'chris', kind: 'road', key: 'browser:3',
      source: 'browser', checkpoint: true }]);
    expect(browserWorlds({ files: [], slots: [] })).toEqual([]);
  });

  it('restores saved clock, manifest and provinces into a detached read-only view', () => {
    const before = JSON.stringify(saved);
    const { sim, world } = browserWorldView(saved, 'browser:3');
    expect(world.kind).toBe('road');
    const room = sim.rooms.get(3)!;
    expect(room.world.clock).toEqual({ day: 7, time: 12 });
    expect(room.world.manifest.toJSON().rootSeed).toBe(3);
    room.world.keepNear([{ x: 1, z: 2 }]);
    expect(room.world.log).toContainEqual({ kind: 'sow', tile: '1,2', crop: 'wheat', day: 6 });
    room.world.setClock(8, 0.5);
    room.world.save();
    expect(JSON.stringify(saved)).toBe(before);
    expect(browserWorldView(saved, 'browser:3').sim.rooms.get(3)!.world.clock.day).toBe(7);
  });

  it('discovers old unnamed slot worlds without pretending they have an authority checkpoint', () => {
    const rows = browserWorlds({ files: [], slots: [undefined, { seed: 42, world: 'road' }, { seed: 42, world: 'road' }, { seed: -1 }] });
    expect(rows).toEqual([{ seed: 42, name: undefined, kind: 'road', source: 'browser', key: 'browser:42', checkpoint: false }]);
  });

  it('restores recorded village populations without founding unvisited places or changing storage', () => {
    const kept: BrowserWorldSnapshot = { files: [
      ['worlds/world-records.json', JSON.stringify([{ seed: 3, name: 'chris', kind: 'road' }])],
      ['worlds/3.json', JSON.stringify({ seed: 3, clock: { day: 2, time: 0.5 }, deltas: [], holdingVillages: ['Crossroads Town'] })],
    ], slots: [] };
    const before = JSON.stringify(kept);
    const book = browserWorldSurvey(browserWorldView(kept, 'browser:3'));
    expect(book && book !== 'preparing' ? book.parishes.map(parish => parish.name) : []).toEqual(['Crossroads Town']);
    expect(book && book !== 'preparing' ? book.souls : 0).toBeGreaterThan(0);
    expect(JSON.stringify(kept)).toBe(before);
    const empty = { ...kept, files: kept.files.map(([name, text]): [string, string] => [name,
      name === 'worlds/3.json' ? JSON.stringify({ seed: 3, clock: { day: 2, time: 0.5 }, deltas: [] }) : text]) };
    const unvisited = browserWorldSurvey(browserWorldView(empty, 'browser:3'));
    expect(unvisited && unvisited !== 'preparing' ? unvisited.parishes : null).toEqual([]);
  });

  it('reports damaged data and absent worlds instead of generating a replacement', () => {
    expect(() => browserWorlds({ files: [['worlds/3.json', '{']], slots: [] })).toThrow();
    expect(() => browserWorlds({ files: [['worlds/world-records.json', '{}']], slots: [] })).toThrow('catalogue is damaged');
    expect(() => browserWorldView(saved, 'browser:99')).toThrow('no longer holds');
  });
});
