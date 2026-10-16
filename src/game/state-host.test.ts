import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState } from './state';
import { openTheSave } from './keeping';
import { Manifest } from '../world/manifest';
import type { SessionSave } from '../save/store';
import type { Structures } from '../world/structures';

afterEach(() => vi.unstubAllGlobals());
const playerId = '00000000-0000-4000-8000-000000000001';
const structures: Structures = { doors: [], villages: [], pois: [], all: [], piers: [], signposts: [],
  caves: [], wrecks: [], derelicts: [], castles: [] };

describe('production state and save with host services', () => {
  it('uses host identity and wall time without crypto, then preserves identity and offline days', () => {
    vi.stubGlobal('crypto', undefined);
    let now = 1000;
    const host = { now: () => now, newPlayerId: () => playerId };
    const state = GameState.fresh(host); state.give('sword'); state.equip('sword');
    const saved = state.toJSON();
    expect(saved.playerId).toBe(playerId); expect(saved.savedAt).toBe(1000);
    now += 3 * 86400000;
    const continued = GameState.from(JSON.parse(JSON.stringify(saved)), host);
    expect(continued.playerId).toBe(playerId); expect(continued.awayFor).toBe(3);
    expect(continued.worn('hand')?.id).toBe('sword');
    expect(continued.toJSON().savedAt).toBe(now);
  });

  it('packs and continues real production progress through a host-owned save slot', async () => {
    vi.stubGlobal('crypto', undefined);
    const records = new Map<string, unknown>(); let now = 5000, x = 12;
    const store = { load: async <T>(key: string) => records.get(key) as T | undefined,
      save: async <T>(key: string, value: T) => { records.set(key, value); }, remove: async () => {} };
    const open = (saved?: SessionSave) => openTheSave({ store, slotKey: 'offline', seed: 7, world: 'road',
      host: { now: () => now, newPlayerId: () => playerId }, saved, structures, manifest: new Manifest(7, saved?.manifest),
      rng: () => 0.5, cam: () => ({ x, z: -8, rot: 0.4, zoom: 2 }), at: () => ({ x, z: -8 }), sky: () => null });
    const first = open(); first.state.inventory.gold = 123; first.state.give('sword'); first.state.equip('sword');
    first.state.discovered.add('Ashford'); first.state.day = 12;
    first.persist(); x = 18; now = 6000; await first.persistStrict(); await first.saves.close();
    const saved = records.get('offline') as SessionSave;
    expect(saved.player).toEqual({ x: 18, z: -8 }); expect(saved.state?.savedAt).toBe(6000);
    const continued = open(JSON.parse(JSON.stringify(saved)));
    expect(continued.state.inventory.gold).toBe(123); expect(continued.state.worn('hand')?.id).toBe('sword');
    expect(continued.state.discovered.has('Ashford')).toBe(true); expect(continued.state.day).toBe(12);
    await expect(first.persistStrict()).rejects.toThrow('closed');
    await continued.saves.close();
  });
});
