import { afterEach, describe, expect, it, vi } from 'vitest';
import { Manifest } from '../../world/manifest';
import type { SaveStore } from '../../save/store';
import type { Structures } from '../../world/structures';
import { openTheSave } from '../keeping';
import type { Surroundings } from './context';
import { prayerInteractions } from './prayer';
import { askForHighland } from '../prayers';

const shrine = { name: 'Shrine of Echoes', x: 100, z: 100 };

function setting(shared = false) {
  const state = { day: 10, prayers: [] as Array<{ id: string; due: number }> };
  const persist = vi.fn();
  const persistStrict = vi.fn(async () => {});
  const ctx = {
    state, manifest: new Manifest(3), structures: { villages: [
      { name: 'Ashford', x: 196, z: 100 },
    ] },
    around: { surveyVillages: (_x: number, _z: number, _reach: number) => [
      { name: 'Ashford', x: 196, z: 100 },
      { name: 'Neighboring patch', x: 290, z: 100 },
    ] },
    sampler: { within: { x0: 0, x1: 512, z0: 0, z1: 512 } },
    online: { connected: true, away: shared },
    hud: { flash: vi.fn() }, sound: { chime: vi.fn() }, persist,
    persistStrict, prayerHost: { randomSeed: () => 123, restart: vi.fn(), isLive: () => true },
  } as unknown as Surroundings;
  return { ctx, state, persist, persistStrict };
}

describe('the shrine prayer conversation', () => {
  it('refuses to change a shared world', () => {
    const { ctx, state, persist } = setting(true);
    const refused = prayerInteractions(ctx).choicesAt(shrine)[0].next();
    expect(refused?.pages.join(' ')).toContain('world of your own');
    expect(state.prayers).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });

  it('names affected villages before a local prayer is saved', () => {
    const { ctx, state, persistStrict } = setting();
    const sites = prayerInteractions(ctx).choicesAt(shrine)[0].next();
    const warning = sites?.choices?.find((choice) => choice.label.includes('east heights'))?.next();
    expect(warning?.pages.join(' ')).toContain('Ashford');
    expect(warning?.pages.join(' ')).toContain('Neighboring patch');
    expect(state.prayers).toEqual([]);
    warning?.choices?.[0].next();
    expect(state.prayers).toMatchObject([{ id: 'highland:prayer:Shrine of Echoes:east', due: 70 }]);
    expect(persistStrict).toHaveBeenCalledOnce();
  });

  it('confirms a prayer only once its save has been written', async () => {
    const { ctx, state, persistStrict } = setting();
    let written!: () => void;
    persistStrict.mockReturnValue(new Promise<void>((resolve) => { written = resolve; }));
    const sites = prayerInteractions(ctx).choicesAt(shrine)[0].next();
    const warning = sites?.choices?.find((choice) => choice.label.includes('east heights'))?.next();
    warning?.choices?.[0].next();
    expect(persistStrict).toHaveBeenCalledOnce();
    expect(state.prayers, 'the prayer is in the state the save is packing').toHaveLength(1);
    expect(ctx.sound.chime, 'no chime while the write is in flight').not.toHaveBeenCalled();
    expect(ctx.hud.flash).not.toHaveBeenCalled();
    written();
    await Promise.resolve();
    expect(ctx.sound.chime).toHaveBeenCalledOnce();
    expect(ctx.hud.flash).toHaveBeenCalledWith('The stones will answer for Shrine of Echoes east heights on day 70.');
  });

  it('retries a due answer after persistence fails', async () => {
    const { ctx, state, persistStrict } = setting();
    state.prayers.push({ id: 'highland:prayer:test', due: 10 });
    persistStrict.mockRejectedValue(new Error('storage unavailable'));
    const prayer = prayerInteractions(ctx);
    prayer.tick();
    await Promise.resolve();
    await Promise.resolve();
    prayer.tick();
    expect(persistStrict).toHaveBeenCalledTimes(2);
  });
});

/**
 * A store that fails the way `IndexedDbStore` does in a private window or with the disk full: the
 * best-effort `save` swallows the failure and resolves, and only `saveStrict` says so.
 */
class Full implements SaveStore {
  readonly kept = new Map<string, unknown>();
  async load<T>(key: string): Promise<T | undefined> { return this.kept.get(key) as T | undefined; }
  async save(): Promise<void> { /* quota: ignored, as IndexedDbStore.save ignores it */ }
  async saveStrict(): Promise<void> { throw new Error('QuotaExceededError'); }
  async remove(key: string): Promise<void> { this.kept.delete(key); }
}

const NO_STRUCTURES: Structures = {
  doors: [], villages: [], pois: [], all: [], piers: [], signposts: [],
  caves: [], wrecks: [], derelicts: [], castles: [],
};

/** The prayer wired to a real opened save, so the persist it is handed is the one the game uses. */
function onAFullDisk() {
  const manifest = new Manifest(3);
  const kept = openTheSave({
    store: new Full(), slotKey: 'slot', seed: 3, world: 'endless', worldName: 'Ashford',
    saved: undefined, structures: NO_STRUCTURES, manifest, rng: () => 0.5,
    cam: () => ({ x: 0, z: 0, rot: 0, zoom: 1 }), at: () => ({ x: 0, z: 0 }), sky: () => null,
  });
  kept.state.day = 10;
  const hud = { flash: vi.fn() };
  const sound = { chime: vi.fn() };
  const ctx = {
    state: kept.state, manifest,
    around: { surveyVillages: () => [] },
    sampler: { within: { x0: 0, x1: 512, z0: 0, z1: 512 } },
    online: { connected: true, away: false },
    hud, sound, persist: kept.persist, persistStrict: kept.persistStrict,
    prayerHost: { randomSeed: () => 123, restart: vi.fn(), isLive: () => true },
  } as unknown as Surroundings;
  return { ctx, state: kept.state, hud, sound };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a prayer on a disk that will not take the save', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is taken back and never confirmed', async () => {
    const { ctx, state, hud, sound } = onAFullDisk();
    const sites = prayerInteractions(ctx).choicesAt(shrine)[0].next();
    const warning = sites?.choices?.find((choice) => choice.label.includes('east heights'))?.next();
    const pray = warning?.choices?.find((choice) => choice.label.startsWith('Pray'));
    expect(pray, 'the confirming choice is offered').toBeDefined();
    pray?.next();
    await settled();
    expect(state.prayers).toEqual([]);
    expect(sound.chime).not.toHaveBeenCalled();
    const said = hud.flash.mock.calls.map(([line]) => line as string);
    expect(said.some((line) => line.includes('stones will answer'))).toBe(false);
    expect(said).toContain('The prayer could not be saved. Please try again.');
  });

  it('does not reload for an answer that was not saved, and tries again on a later tick', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const { ctx, state, hud } = onAFullDisk();
    ctx.prayerHost.restart = reload;
    state.prayers.push(askForHighland(shrine, 'east', 0, 1));
    state.day = state.prayers[0].due;
    const prayer = prayerInteractions(ctx);
    prayer.tick();
    await settled();
    expect(reload).not.toHaveBeenCalled();
    expect(hud.flash).toHaveBeenCalledWith('The answer could not be saved. The stones will try again.');
    hud.flash.mockClear();
    prayer.tick();
    expect(hud.flash, 'reloading was reset, so the next tick tries again')
      .toHaveBeenCalledWith('The stones have answered. The country is changing.');
    await settled();
    expect(reload).not.toHaveBeenCalled();
  });
});
