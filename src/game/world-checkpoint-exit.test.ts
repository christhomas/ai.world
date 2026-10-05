import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '../../server/protocol';
import { LocalWorldHost } from './local-world-host';
import { WorldVault } from '../save/world-vault';
import { SaveOwner } from '../save/owner';
import { savedExit } from './saved-exit';

describe('session exit with a real durable authority', () => {
  it('keeps the world owned until player and authority writes finish, then reopens its saved actions', async () => {
    const files = new Map<string, string>(), calls: string[] = [];
    let releaseWrite!: () => void;
    const gate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const vault = await WorldVault.open({ load: async () => [...files], write: async (name, text) => {
      await gate; files.set(name, text);
    } });
    const clock = { now: () => 0, yield: () => Promise.resolve(), after: () => () => {}, every: () => () => {} };
    const host = new LocalWorldHost({ vault, clock, post() {}, closed: () => { calls.push('closed'); },
      flush: () => vault.flush() }, { ground: false }, true);
    const join = JSON.stringify({ type: 'join', seed: 3, version: PROTOCOL_VERSION, name: 'Rowan', day: 2, time: 0.4 });
    host.receive(join);
    host.receive(JSON.stringify({ type: 'delta', delta: { kind: 'cleared', mine: 'Barrow', many: 4 } }));
    host.receive('shots-step:3');
    const player = new SaveOwner({ load: async () => undefined, save: async () => { calls.push('player'); },
      remove: async () => {} }, 'hero');
    const leave = savedExit({ park: () => calls.push('park'), resume: () => calls.push('resume'),
      save: async () => { await player.write({ x: 18, z: -8 }); await player.flush(); await host.persist(); },
      release: () => { host.dispose(); player.dispose(); }, depart: () => calls.push('depart') });
    const pending = leave(); expect(leave()).toBe(pending);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(host.isDisposed).toBe(false); expect(calls).toEqual(['park', 'player']);
    releaseWrite(); await pending;
    expect(calls).toEqual(['park', 'player', 'closed', 'depart']);
    const restored = await WorldVault.open({ load: async () => [...files], write: async (name, text) => { files.set(name, text); } });
    const heard: ServerMessage[] = [];
    const fresh = new LocalWorldHost({ vault: restored, clock, post: parcel => {
      if (typeof parcel === 'string' && parcel.startsWith('{')) heard.push(JSON.parse(parcel));
    }, closed() {}, flush: () => restored.flush() }, { ground: false }, true);
    fresh.receive(join);
    const welcome = heard.find(message => message.type === 'welcome');
    expect(welcome?.type).toBe('welcome');
    if (welcome?.type !== 'welcome') throw new Error('No continued world');
    expect(welcome.deltas).toContainEqual({ kind: 'cleared', mine: 'Barrow', many: 4 });
    expect(welcome.clock.day + welcome.clock.time).toBeGreaterThan(2.4);
    fresh.dispose(); await restored.flush();
  });

  it('keeps a storage failure open for an explicit successful retry', async () => {
    let fails = true, resumed = 0, departed = 0;
    const vault = await WorldVault.open({ load: async () => [], write: async () => {
      if (fails) throw new Error('disk full');
    } });
    const host = new LocalWorldHost({ vault,
      clock: { now: () => 0, yield: () => Promise.resolve(), after: () => () => {}, every: () => () => {} },
      post() {}, closed() {}, flush: () => vault.retry(),
    }, { ground: false }, true);
    host.receive(JSON.stringify({ type: 'join', seed: 3, version: PROTOCOL_VERSION, name: 'Rowan', day: 2, time: 0.4 }));
    const leave = savedExit({ park() {}, resume: () => { resumed++; }, save: () => host.persist(),
      release: () => host.dispose(), depart: () => { departed++; } });
    await expect(leave()).rejects.toThrow('World storage');
    expect(host.isDisposed).toBe(false); expect(resumed).toBe(1); expect(departed).toBe(0);
    fails = false; await leave(); expect(host.isDisposed).toBe(true); expect(departed).toBe(1);
  });
});
