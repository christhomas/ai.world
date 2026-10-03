import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionLifetime } from '../lifecycle';
import { askForHighland, type HighlandPrayer } from '../prayers';
import { Manifest } from '../../world/manifest';
import type { Surroundings } from './context';
import { prayerInteractions } from './prayer';

afterEach(() => vi.unstubAllGlobals());
const shrine = { name: 'Shrine of Echoes', x: 100, z: 100 };

function world() {
  const session = new SessionLifetime({ frame: vi.fn(), pause: vi.fn(), resume: vi.fn(), release: vi.fn() });
  const state = { day: 10, prayers: [] as HighlandPrayer[] };
  const host = { isLive: () => !session.isDisposed, randomSeed: vi.fn(() => 0xfedcba98), restart: vi.fn() };
  const persistStrict = vi.fn(async () => {});
  const hud = { flash: vi.fn() }, sound = { chime: vi.fn() };
  const online = { connected: true, away: false };
  const ctx = {
    state, manifest: new Manifest(3), around: { surveyVillages: () => [] },
    sampler: { within: { x0: 0, x1: 512, z0: 0, z1: 512 } },
    online, hud, sound, persistStrict, prayerHost: host,
  } as unknown as Surroundings;
  return { ctx, session, state, host, persistStrict, hud, sound, online, prayer: prayerInteractions(ctx) };
}

function confirmation(prayer: ReturnType<typeof prayerInteractions>) {
  const sites = prayer.choicesAt(shrine)[0].next();
  expect(sites?.choices).toBeDefined();
  const east = sites!.choices!.find(choice => choice.label.includes('east heights'));
  expect(east).toBeDefined();
  const warning = east!.next();
  expect(warning?.pages.join(' ')).toContain('cannot be undone');
  const confirm = warning!.choices!.find(choice => choice.label === 'Pray and accept the consequence');
  expect(confirm).toBeDefined();
  return confirm!.next;
}

function due(w: ReturnType<typeof world>) {
  w.state.prayers.push(askForHighland(shrine, 'east', 0, 1));
  w.state.day = w.state.prayers[0].due;
  expect(w.state.prayers[0].answered).toBe(false);
}

describe('prayers through an owned host', () => {
  it('records one unsigned host roll without window, document or crypto', async () => {
    const w = world();
    for (const name of ['window', 'document', 'crypto']) vi.stubGlobal(name, undefined);
    confirmation(w.prayer)();
    expect(w.host.randomSeed).toHaveBeenCalledOnce();
    expect(w.state.prayers).toMatchObject([{ seed: 0xfedcba98, due: 70, answered: false }]);
    expect(w.persistStrict).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(w.sound.chime).toHaveBeenCalledOnce();
  });

  it('does not repeat a confirmation while its first save is in flight', () => {
    const w = world();
    w.persistStrict.mockReturnValue(new Promise<void>(() => {}));
    const confirm = confirmation(w.prayer);
    confirm();
    expect(w.state.prayers).toHaveLength(1);
    confirm();
    expect(w.state.prayers).toHaveLength(1);
    expect(w.host.randomSeed).toHaveBeenCalledOnce();
    expect(w.persistStrict).toHaveBeenCalledOnce();
  });

  it('refuses a stale confirmation after the session closes or joins a shared world', () => {
    for (const changed of ['disposed', 'shared'] as const) {
      const w = world();
      const confirm = confirmation(w.prayer);
      if (changed === 'disposed') w.session.dispose();
      else w.online.away = true;
      confirm();
      expect(w.state.prayers).toEqual([]);
      expect(w.host.randomSeed).not.toHaveBeenCalled();
      expect(w.persistStrict).not.toHaveBeenCalled();
    }
  });

  it.each([NaN, Infinity, -1, 0.5, 0x100000000])('rejects an invalid host seed %s before changing or saving state', (seed) => {
    const w = world();
    w.host.randomSeed.mockReturnValue(seed);
    const confirm = confirmation(w.prayer);
    expect(confirm).toThrow('invalid prayer seed');
    expect(w.state.prayers).toEqual([]);
    expect(w.persistStrict).not.toHaveBeenCalled();
  });

  it('requests the host restart only after the due answer is saved, exactly once', async () => {
    const w = world();
    due(w);
    vi.stubGlobal('window', undefined);
    let written!: () => void;
    w.persistStrict.mockReturnValue(new Promise<void>(resolve => { written = resolve; }));
    w.prayer.tick();
    w.prayer.tick();
    expect(w.persistStrict).toHaveBeenCalledOnce();
    expect(w.host.restart).not.toHaveBeenCalled();
    written();
    await Promise.resolve();
    expect(w.host.restart).toHaveBeenCalledOnce();
    w.prayer.tick();
    expect(w.persistStrict).toHaveBeenCalledOnce();
  });

  it('does not restart or update the disposed UI when a due save completes late', async () => {
    const w = world();
    due(w);
    let written!: () => void;
    w.persistStrict.mockReturnValue(new Promise<void>(resolve => { written = resolve; }));
    w.prayer.tick();
    expect(w.persistStrict).toHaveBeenCalledOnce();
    w.hud.flash.mockClear();
    w.session.dispose();
    written();
    await Promise.resolve();
    expect(w.host.restart).not.toHaveBeenCalled();
    expect(w.hud.flash).not.toHaveBeenCalled();
    w.prayer.tick();
    expect(w.persistStrict).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('ignores a confirmation save that %s after disposal', async (outcome) => {
    const w = world();
    let written!: () => void, failed!: (error: Error) => void;
    w.persistStrict.mockReturnValue(new Promise<void>((resolve, reject) => { written = resolve; failed = reject; }));
    confirmation(w.prayer)();
    expect(w.state.prayers).toHaveLength(1);
    w.session.dispose();
    if (outcome === 'resolve') written();
    else failed(new Error('disk full'));
    await Promise.resolve();
    expect(w.state.prayers).toHaveLength(1);
    expect(w.hud.flash).not.toHaveBeenCalled();
    expect(w.sound.chime).not.toHaveBeenCalled();
  });

  it('ignores a due save failure after disposal instead of reporting into another world', async () => {
    const w = world();
    due(w);
    let failed!: (error: Error) => void;
    w.persistStrict.mockReturnValue(new Promise<void>((_resolve, reject) => { failed = reject; }));
    w.prayer.tick();
    w.hud.flash.mockClear();
    w.session.dispose();
    failed(new Error('disk full'));
    await Promise.resolve();
    expect(w.hud.flash).not.toHaveBeenCalled();
    expect(w.host.restart).not.toHaveBeenCalled();
  });

  it('does not reload into a shared world if authority changes while the due save is pending', async () => {
    const w = world();
    due(w);
    let written!: () => void;
    w.persistStrict.mockReturnValue(new Promise<void>(resolve => { written = resolve; }));
    w.prayer.tick();
    w.online.away = true;
    written();
    await Promise.resolve();
    expect(w.host.restart).not.toHaveBeenCalled();
    w.online.away = false;
    w.prayer.tick();
    expect(w.persistStrict).toHaveBeenCalledTimes(2);
  });

  it('rolls back a prayer when the storage port throws synchronously', () => {
    const w = world();
    w.persistStrict.mockImplementation(() => { throw new Error('disk full'); });
    expect(confirmation(w.prayer)).not.toThrow();
    expect(w.state.prayers).toEqual([]);
    expect(w.sound.chime).not.toHaveBeenCalled();
    expect(w.hud.flash).toHaveBeenCalledWith('The prayer could not be saved. Please try again.');
  });

  it('retries a due answer when the storage port throws synchronously', () => {
    const w = world();
    due(w);
    w.persistStrict.mockImplementation(() => { throw new Error('disk full'); });
    expect(() => w.prayer.tick()).not.toThrow();
    expect(() => w.prayer.tick()).not.toThrow();
    expect(w.persistStrict).toHaveBeenCalledTimes(2);
    expect(w.host.restart).not.toHaveBeenCalled();
  });

  it('distinguishes a failed restart from a failed save and can retry', async () => {
    const w = world();
    due(w);
    w.host.restart.mockImplementation(() => { throw new Error('host unavailable'); });
    w.prayer.tick();
    await Promise.resolve();
    expect(w.hud.flash).toHaveBeenCalledWith('The answer was saved, but the world could not reopen. Please reopen your game.');
    expect(w.hud.flash).not.toHaveBeenCalledWith('The answer could not be saved. The stones will try again.');
    w.prayer.tick();
    await Promise.resolve();
    expect(w.host.restart).toHaveBeenCalledTimes(2);
  });
});
