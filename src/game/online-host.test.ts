import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../../server/sim';
import { Forgetful } from '../../server/vault';
import type { ServerMessage, WorldDelta } from '../../server/protocol';
import { Online, type OnlineEvents, type WorldLinkFactory } from './portable-online';
import type { LinkEvents } from '../net/link-contract';

const standing = { x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot' as const, gear: [] };
const welcome = (id: string): ServerMessage => ({ type: 'welcome', id, seed: 3,
  players: [], clock: { day: 2, time: 0.4 }, deltas: [] });

function listening() {
  const calls = new Map<string, unknown[][]>();
  const events = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => {
    const name = String(key), rows = calls.get(name) ?? []; rows.push(args); calls.set(name, rows);
  } }) as OnlineEvents;
  return { events, calls };
}

function transport() {
  const attempts: Array<{ events: LinkEvents; sent: string[]; closed: number }> = [];
  const factory: WorldLinkFactory = (_url, events) => {
    const attempt = { events, sent: [] as string[], closed: 0 }; attempts.push(attempt);
    return { ready: true, send: (parcel) => { attempt.sent.push(String(parcel)); },
      close: () => { attempt.closed++; events.onClose('closed'); } };
  };
  return { attempts, factory };
}

describe('host-supplied world transport', () => {
  afterEach(() => { if (vi.isFakeTimers()) vi.clearAllTimers(); vi.useRealTimers(); });

  it('rejects messages, bytes, open and close callbacks from a replaced or disconnected link', () => {
    const { events, calls } = listening(), wire = transport(), online = new Online(events, wire.factory);
    online.connect('ws://first', 3, 'Rowan', { day: 2, time: 0.4 });
    const first = wire.attempts[0]; first.events.onOpen(); first.events.onMessage(JSON.stringify(welcome('first')));
    online.connect('ws://second', 3, 'Rowan', { day: 2, time: 0.4 });
    const second = wire.attempts[1]; second.events.onOpen(); second.events.onMessage(JSON.stringify(welcome('second')));
    const clocks = calls.get('onClock')!.length, silences = calls.get('onWorldSilent')!.length;
    first.events.onOpen(); first.events.onMessage(JSON.stringify(welcome('stale')));
    first.events.onMessage(new ArrayBuffer(4)); first.events.onClose('late error');
    expect(online.id).toBe('second'); expect(online.connected).toBe(true);
    expect(calls.get('onClock')).toHaveLength(clocks);
    expect(calls.get('onWorldSilent')).toHaveLength(silences);
    expect(calls.has('onParcel')).toBe(false);
    expect(second.sent).toHaveLength(1); expect(second.closed).toBe(0); expect(first.closed).toBe(1);
    online.disconnect();
    second.events.onOpen(); second.events.onMessage(JSON.stringify(welcome('retired'))); second.events.onClose('late');
    expect(online.connected).toBe(false); expect(second.closed).toBe(1);
    expect(calls.get('onClock')).toHaveLength(clocks);
    expect(online.tally.heard.get('welcome')).toBe(2);
  });

  it('backs off null and throwing factories, then retries through the same supplied host', () => {
    for (const throws of [false, true]) {
      let opened = 0;
      const { events } = listening();
      const online = new Online(events, () => { opened++; if (throws) throw new Error('Host refused'); return null; });
      online.connect('', 3, 'Rowan', { day: 2, time: 0.4 });
      online.update(0.1, standing); expect(opened).toBe(1);
      online.update(1, standing); expect(opened).toBe(2);
      online.disconnect(); online.update(10, standing); expect(opened).toBe(2);
    }
  });

  it('closes a resource handed back after its factory already reported failure', () => {
    let closed = 0;
    const { events } = listening();
    const online = new Online(events, (_url, callbacks) => {
      callbacks.onClose('Refused during construction');
      return { ready: true, send() {}, close: () => { closed++; } };
    });
    online.connect('', 3, 'Rowan', { day: 2, time: 0.4 });
    expect(closed).toBe(1); expect(online.connected).toBe(false);
    online.disconnect(); expect(closed).toBe(1);
  });

  it('joins and resumes the real shared authority through the portable client', () => {
    vi.useFakeTimers();
    const vault = new Forgetful();
    for (let cycle = 0; cycle < 2; cycle++) {
      const sim = new Simulation({ vault, dataDir: 'worlds' });
      const { events, calls } = listening(); let open: () => void = () => {};
      const factory: WorldLinkFactory = (_url, callbacks) => {
        let active = true;
        const attached = sim.attach({ get open() { return active; },
          send: (parcel) => callbacks.onMessage(parcel), close: () => callbacks.onClose('Closed') });
        open = callbacks.onOpen;
        return { get ready() { return active; }, send: (parcel) => { if (typeof parcel === 'string') attached.receive(parcel); },
          close: () => { active = false; attached.leave(); sim.stop(); } };
      };
      const online = new Online(events, factory);
      online.connect('', 3, 'Rowan', { day: 2, time: 0.4 }); open();
      expect(online.connected).toBe(true);
      expect(calls.get('onClock')?.[0]).toEqual([{ day: 2, time: 0.4 }]);
      if (cycle === 0) online.report({ kind: 'cleared', mine: 'Barrow', many: 4 });
      else expect(calls.get('onDelta')?.map(([delta]) => delta as WorldDelta)).toContainEqual({ kind: 'cleared', mine: 'Barrow', many: 4 });
      online.disconnect(); expect(online.connected).toBe(false);
    }
  });
});
