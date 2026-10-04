import { LocalWorldHost, Forgetful, type HostClock } from '../../src/game/portable-world';
import { PROTOCOL_VERSION, type ServerMessage } from '../../server/protocol';

/** Real shared-world restart in each native engine; storage remains an explicit memory fixture. */
export function worldWorkload(): string {
  const vault = new Forgetful();
  const pending = new Set<() => void>();
  const clock: HostClock = {
    now: () => 0,
    after: (callback) => { pending.add(callback); return () => { pending.delete(callback); }; },
    every: (callback) => { pending.add(callback); return () => { pending.delete(callback); }; },
    yield: () => Promise.resolve(),
  };
  let restored: ServerMessage | undefined;
  for (let cycle = 0; cycle < 2; cycle++) {
    const game = new LocalWorldHost({ vault, clock, closed() {}, post(parcel) {
      if (typeof parcel === 'string' && parcel.startsWith('{')) {
        const message = JSON.parse(parcel) as ServerMessage;
        if (cycle === 1 && message.type === 'welcome') restored = message;
      }
    } }, { ground: false }, true);
    game.receive(JSON.stringify({ type: 'join', version: PROTOCOL_VERSION, seed: 3,
      name: 'Rowan', day: 2, time: 0.4 }));
    if (cycle === 0) {
      game.receive(JSON.stringify({ type: 'delta', delta: { kind: 'cleared', mine: 'Barrow', many: 4 } }));
      game.receive('shots-step:3');
    }
    game.dispose();
    if (pending.size) throw new Error('Retired world retained timers');
    game.receive('shots-step:3');
  }
  if (restored?.type !== 'welcome' || !restored.deltas.some((delta) => delta.kind === 'cleared' && delta.mine === 'Barrow')
    || restored.clock.day + restored.clock.time <= 2.4) throw new Error('Local world restart lost progress');
  return JSON.stringify({ clock: restored.clock, deltas: restored.deltas });
}
