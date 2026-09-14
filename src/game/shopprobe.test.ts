import { describe, expect, it } from 'vitest';
import { Biome } from '../world/biomes';
import { createMeeting, type Meeting } from './meeting';
import { installProbes, leaveShop, type Probed, whichShopsToTry } from './probes';
import type { Doorway } from '../world/structures';

type TestVillage = {
  name: string;
  x: number;
  z: number;
  shops: [{ type: 'store'; house: { tx: number; tz: number } }];
};

const villages: TestVillage[] = [
  { name: 'Crossroads Town', x: 0, z: 0, shops: [{ type: 'store', house: { tx: 10, tz: 10 } }] },
  { name: 'Snowhold', x: 200, z: 0, shops: [{ type: 'store', house: { tx: 210, tz: 10 } }] },
  { name: 'Dunecamp', x: -50, z: 40, shops: [{ type: 'store', house: { tx: -40, tz: 50 } }] },
];

const doors: Doorway[] = villages.map((village) => ({
  x: village.x, z: village.z, kind: 'store', village: village.name,
  bx: village.shops[0].house.tx, bz: village.shops[0].house.tz,
}));

function shopProbe(hero: { x: number; z: number }) {
  const entered: Doorway[] = [];
  const debug: { __enterShop?: (type?: string, village?: string) => string | null } = {};
  const runtime = globalThis as { window?: unknown };
  const priorWindow = runtime.window;
  runtime.window = debug;
  const structures = { villages, doors, piers: [], wrecks: [], pois: [] };
  const places = {
    indoors: null,
    enterBuilding: (door: Doorway) => { entered.push(door); },
    leaveBuilding() {},
  };
  try {
    installProbes({
    seed: 1, world: undefined, state: { day: 0, time: 0 }, player: hero, rig: { scene: {} }, iso: {},
    sampler: {}, structures, chunks: {}, entities: {}, register: {}, places, online: {}, market: {},
    warband: {}, remains: {}, plots: {}, houses: {}, sailing: {}, skies: {}, skyIsles: [], eyries: [],
    pods: () => [], mines: {}, jail: {}, mount: {}, drawLineage() {}, overworldRenderer: {}, roaming: {},
    nemesis: {}, director: {}, claimed: new Map(), minesWorked: () => [], fightingInAMine: () => null,
    questList: [], talkCtx: {}, commands: {}, commandWorld: {}, leaveOne() {}, wing: { open: () => false,
      flying: false, altitude: 0, climbing: false }, callOut() {}, placeName: () => 'surface', carcasses: () => [],
    markers: () => [], walking: { answers: 0, corrections: 0, worst: 0 },
    doorsteps: { ready: false, resting: 0 }, streamTally: { asked: 0, kept: 0, arrived: 0, wanted: 0 },
    wildlife: { drift: 0, nearestCounted: null }, bites: [], heard: () => ({ nearness: 0, drop: 0 }),
    nettleAbout: () => null, sentOut: () => [],
    } as unknown as Probed);
  } finally {
    runtime.window = priorWindow;
  }
  return { enterShop: debug.__enterShop!, entered };
}

/**
 * Which shop a probe walks into, and whether it can be pointed at one.
 *
 * Found by walking the hunting loop in a browser (issue #2, filed as 106): `__enterShop('store')`
 * took the first village in the world that had one, every time, so a walk that needed *this*
 * village's shop could not be written. The choosing is a rule of its own now, and the rule is what
 * is asked here; the actual hook is exercised below.
 */
describe('reaching a shop from a test harness', () => {
  it('matches a named village case-insensitively', () => {
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, 'SNOW').map((v) => v.name)).toEqual(['Snowhold']);
  });

  it('takes the nearest when nobody says which, rather than the first in the world', () => {
    expect(whichShopsToTry(villages, { x: 190, z: 10 }, undefined).map((v) => v.name))
      .toEqual(['Snowhold', 'Crossroads Town', 'Dunecamp']);
  });

  it('still offers all of them, so a hero by a village with no such counter finds another', () => {
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, undefined)).toHaveLength(3);
  });

  it('finds nowhere when the name matches nowhere, rather than quietly the nearest', () => {
    expect(whichShopsToTry(villages, { x: 0, z: 0 }, 'atlantis')).toEqual([]);
  });

  it('forwards a named village to the probe and enters that village', () => {
    const probe = shopProbe({ x: 190, z: 10 });
    expect(probe.enterShop('store', 'cross')).toBe('Crossroads Town: store');
    expect(probe.entered).toEqual([doors[0]]);
  });

  it('forwards the hero position for nearest-first entry', () => {
    const probe = shopProbe({ x: 190, z: 10 });
    expect(probe.enterShop('store')).toBe('Snowhold: store');
    expect(probe.entered).toEqual([doors[1]]);
  });

  it('does not fall back to nearest when a named village is unmatched', () => {
    const probe = shopProbe({ x: 190, z: 10 });
    expect(probe.enterShop('store', 'atlantis')).toBeNull();
    expect(probe.entered).toEqual([]);
  });
});

describe('leaving a shop from a test harness', () => {
  it('returns no place and performs no action outdoors', () => {
    const actions: string[] = [];
    expect(leaveShop(null, () => actions.push('leave'), () => { actions.push('name'); return 'surface'; })).toBeNull();
    expect(actions).toEqual([]);
  });

  it('leaves indoors before reading the resulting place', () => {
    const actions: string[] = [];
    const place = leaveShop({} as Probed['places']['indoors'], () => actions.push('leave'), () => {
      actions.push('name');
      return 'surface';
    });
    expect(place).toBe('surface');
    expect(actions).toEqual(['leave', 'name']);
  });
});

describe('the country used for an indoor shop price', () => {
  it('uses the shop doorway while indoors and the hero outdoors', () => {
    const seen: Array<[number, number]> = [];
    const door = { x: 40, z: 41 } as Doorway;
    let inside = true;
    const meeting = createMeeting({
      state: { time: 0, day: 0 },
      player: { x: 5, z: 8 },
      indoors: () => inside ? door : null,
      countryAt: (x: number, z: number) => {
        seen.push([x, z]);
        return Biome.Desert;
      },
    } as Meeting);

    const country = meeting.talkCtx.country;
    if (!country) throw new Error('meeting did not provide a country resolver');
    expect(country()).toBe(Biome.Desert);
    inside = false;
    expect(country()).toBe(Biome.Desert);
    expect(seen).toEqual([[40, 41], [5, 8]]);
  });
});
