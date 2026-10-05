import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '../../server/protocol';
import { Forgetful } from '../../server/vault';
import type { HostClock } from '../../server/host-clock';
import { LocalWorldHost } from './local-world-host';
import { WORLD_PAUSE, WORLD_RESUME } from '../net/link-contract';

class Clock implements HostClock {
  time = 0;
  readonly pending = new Map<() => void, number>();
  readonly retained: Array<() => void> = [];
  now = () => this.time;
  after = (callback: () => void, milliseconds: number) => this.keep(callback, milliseconds);
  every = (callback: () => void, milliseconds: number) => this.keep(callback, milliseconds);
  yield = () => Promise.resolve();
  private keep(callback: () => void, milliseconds: number): () => void {
    this.pending.set(callback, milliseconds);
    this.retained.push(callback);
    return () => { this.pending.delete(callback); };
  }
  pulse(milliseconds: number): void {
    this.time += milliseconds;
    for (const [callback, period] of [...this.pending]) if (period === milliseconds) callback();
  }
}

function harness(vault = new Forgetful(), capturing = false, ground = false) {
  const clock = new Clock(), heard: ServerMessage[] = [];
  let closed = 0;
  const host = new LocalWorldHost({ vault, clock,
    post: (parcel) => { if (typeof parcel === 'string' && parcel.startsWith('{')) heard.push(JSON.parse(parcel)); },
    closed: () => { closed++; },
  }, { ground }, capturing);
  const say = (message: object) => host.receive(JSON.stringify(message));
  const join = () => say({ type: 'join', seed: 3, version: PROTOCOL_VERSION, name: 'Rowan', day: 2, time: 0.4 });
  return { host, clock, heard, say, join, get closed() { return closed; } };
}

describe('host-owned local authority', () => {
  it('saves the real world clock and actions, then restores them in a fresh authority', () => {
    const vault = new Forgetful(), first = harness(vault, true);
    first.join();
    first.say({ type: 'delta', delta: { kind: 'cleared', mine: 'Barrow', many: 4 } });
    first.host.receive('shots-step:3');
    first.host.dispose();
    expect(first.clock.pending.size).toBe(0);
    const second = harness(vault, true);
    second.join();
    const welcome = second.heard.find((message) => message.type === 'welcome');
    expect(welcome?.type).toBe('welcome');
    if (welcome?.type !== 'welcome') throw new Error('No restored world');
    expect(welcome.deltas).toContainEqual({ kind: 'cleared', mine: 'Barrow', many: 4 });
    expect(welcome.clock.day + welcome.clock.time).toBeGreaterThan(2.4);
    second.host.dispose();
    expect(second.clock.pending.size).toBe(0);
  });

  it('fences cancelled ticks and writes, including callbacks retained by the host', () => {
    const game = harness(); game.join();
    const before = game.heard.length;
    game.host.receive(WORLD_PAUSE);
    expect(game.clock.pending.size).toBe(0);
    for (const callback of game.clock.retained) callback();
    expect(game.heard).toHaveLength(before);
    game.clock.time = 3_600_000;
    game.host.receive(WORLD_RESUME);
    const old = [...game.clock.retained];
    game.host.dispose();
    game.host.dispose();
    game.join(); game.host.receive(WORLD_RESUME);
    for (const callback of old) callback();
    expect(game.clock.pending.size).toBe(0);
    expect(game.heard).toHaveLength(before);
    expect(game.closed).toBe(1);
    expect(game.host.isDisposed).toBe(true);
  });

  it('resumes with an ordinary tick after a long background interval', () => {
    const game = harness(); game.join();
    game.host.receive(WORLD_PAUSE);
    game.clock.time = 3_600_000;
    game.host.receive(WORLD_RESUME);
    game.clock.pulse(100);
    game.clock.pulse(5_000);
    const clock = game.heard.find((message) => message.type === 'clock');
    expect(clock?.type).toBe('clock');
    if (clock?.type !== 'clock') throw new Error('No clock broadcast');
    expect(clock.clock.day + clock.clock.time).toBeGreaterThan(2.4);
    expect(clock.clock.day + clock.clock.time).toBeLessThan(2.41);
    game.host.dispose();
  });

  it('reports a failed flush while still retiring delivery and timers', () => {
    const vault = new Forgetful(), game = harness(vault);
    game.join();
    const error = new Error('Storage unavailable');
    vi.spyOn(vault, 'write').mockImplementation(() => { throw error; });
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => game.host.dispose()).toThrow(AggregateError);
      expect(game.host.isDisposed).toBe(true);
      expect(game.closed).toBe(1);
      expect(game.clock.pending.size).toBe(0);
      expect(() => game.host.dispose()).not.toThrow();
    } finally { report.mockRestore(); }
  });

  it('uses the production ground authority to answer movement', () => {
    const game = harness(new Forgetful(), true, true); game.join();
    game.say({ type: 'move', x: 0.5, z: -13.5, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    // The authority grows ground around the new position on its next ordinary tick.
    game.host.receive('shots-step:1');
    game.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const moved = game.heard.find((message) => message.type === 'youAre');
    expect(moved).toMatchObject({ type: 'youAre', seq: 1 });
    if (moved?.type !== 'youAre') throw new Error('No authoritative movement response');
    expect(Number.isFinite(moved.x) && Number.isFinite(moved.z) && Number.isFinite(moved.y)).toBe(true);
    game.host.dispose();
    expect(game.clock.pending.size).toBe(0);
  });

  it('cancels preparation heartbeats and deadlines when a world closes before growth answers', async () => {
    const clock = new Clock();
    let closed = 0, messages = 0;
    const game = new LocalWorldHost({ clock, vault: new Forgetful(),
      post: () => { messages++; }, closed: () => { closed++; },
    }, { prepare: { grow: () => new Promise(() => {}), growRoad: () => new Promise(() => {}) } }, true);
    game.receive(JSON.stringify({ type: 'join', seed: 3, version: PROTOCOL_VERSION, name: 'Rowan', day: 2, time: 0.4 }));
    await Promise.resolve(); await Promise.resolve();
    expect([...clock.pending.values()]).toContain(3000);
    const heard = messages;
    game.dispose();
    expect(clock.pending.size).toBe(0);
    for (const callback of clock.retained) callback();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(messages).toBe(heard);
    expect(closed).toBe(1);
  });
});
