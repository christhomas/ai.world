import { Online, type OnlineEvents, type WorldLinkFactory, type LinkEvents } from '../../src/game/portable-online';

/** A protocol transcript tests client ownership in each engine, not an installed socket adapter. */
export function peerWorkload(): string {
  let clocks = 0, parcels = 0;
  const events = new Proxy({}, { get: (_target, key) => {
    if (key === 'onClock') return () => { clocks++; };
    if (key === 'onParcel') return (bytes: ArrayBuffer) => {
      if (new Uint8Array(bytes)[0] !== 7) throw new Error('World parcel changed');
      parcels++;
    };
    return () => {};
  } }) as OnlineEvents;
  const attempts: Array<{ events: LinkEvents; joins: number; closed: number }> = [];
  const factory: WorldLinkFactory = (_url, callbacks) => {
    const current = { events: callbacks, joins: 0, closed: 0 }; attempts.push(current);
    return { ready: true, send: (parcel) => {
      if (typeof parcel === 'string' && JSON.parse(parcel).type === 'join') current.joins++;
    }, close: () => { current.closed++; callbacks.onClose('Closed'); } };
  };
  const welcome = (id: string) => JSON.stringify({ type: 'welcome', id, seed: 3, players: [],
    clock: { day: 2, time: 0.4 }, deltas: [] });
  const game = new Online(events, factory);
  game.connect('', 3, 'Rowan', { day: 2, time: 0.4 });
  const first = attempts[0]; first.events.onOpen(); first.events.onMessage(welcome('first'));
  game.connect('', 3, 'Rowan', { day: 2, time: 0.4 });
  const second = attempts[1]; second.events.onOpen(); second.events.onMessage(welcome('second'));
  const bytes = new Uint8Array([7]).buffer;
  first.events.onOpen(); first.events.onMessage(welcome('stale')); first.events.onMessage(bytes); first.events.onClose('Late');
  second.events.onMessage(bytes);
  if (!game.connected || game.id !== 'second' || second.joins !== 1 || parcels !== 1) throw new Error('Retired world changed active client');
  game.disconnect(); second.events.onOpen(); second.events.onMessage(welcome('retired')); second.events.onClose('Late');
  if (game.connected || clocks !== 2 || first.closed !== 1 || second.closed !== 1) throw new Error('Client retirement did not fence callbacks');
  return JSON.stringify({ clocks, parcels, joins: attempts.map((attempt) => attempt.joins), closed: attempts.map((attempt) => attempt.closed) });
}
