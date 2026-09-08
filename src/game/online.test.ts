import { describe, expect, it } from 'vitest';
import type { Link, LinkEvents } from '../net/link';
import { PROTOCOL_VERSION, type ServerMessage } from '../../server/protocol';
import { Online, type OnlineEvents } from './online';

/**
 * A world that stops answering.
 *
 * The failure this is about is not a socket that closes — that one announces itself and everything
 * downstream already handles it. It is the socket that stays open and dead: a phone that slept, a
 * wifi handover, a laptop lid. Nothing arrives, no close is ever fired, and the game freezes with
 * every animal standing exactly where it last was, because the client is faithfully drawing the
 * last thing it was told. From the player's chair that is indistinguishable from a simulation that
 * has stopped, and it is what the owner of this world reported: "all the animals and villages are
 * frozen".
 */

/** A link that takes everything and says nothing back, until a test decides otherwise. */
function deadWorld() {
  let heard: LinkEvents | null = null;
  const sent: string[] = [];
  let opened = 0;
  const link: Link = { ready: true, send: (text) => { sent.push(text); }, close: () => {} };
  return {
    sent,
    get opens() { return opened; },
    /** Hand the world a line to say, the way a real one would. */
    say(message: ServerMessage): void { heard?.onMessage(JSON.stringify(message)); },
    /** The world answers the door, which a real socket never does before it has been handed back. */
    open(): void { heard?.onOpen(); },
    linkFor(_url: string, events: LinkEvents): Link {
      heard = events;
      opened++;
      return link;
    },
  };
}

/** Everything the game does about what the world says, counted rather than done. */
function watching() {
  const said: string[] = [];
  let silences = 0;
  // every event answered with nothing, and the two this is about answered properly: a handshake
  // arrives with a clock and a market on it, and a half-built listener throws rather than reports
  const nothing = new Proxy({}, {
    get: (_t, key) => {
      if (key === 'onSystem') return (line: string) => said.push(line);
      if (key === 'onWorldSilent') return () => { silences++; };
      return () => {};
    },
  }) as OnlineEvents;
  return { events: nothing, said, get silences() { return silences; } };
}

const standing = {
  x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot' as const, gear: [],
};

describe('a world that goes quiet', () => {
  it('is noticed, said out loud, and joined again', () => {
    const world = deadWorld();
    const game = watching();
    const online = new Online(game.events, world.linkFor);
    online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'mesh');
    world.say({ type: 'welcome', id: 'p1', seed: 3, players: [], clock: { day: 1, time: 0.4 }, deltas: [] });
    expect(online.connected).toBe(true);
    expect(world.opens).toBe(1);

    // five seconds of nothing at all is a bad minute on a train, not a dead world
    for (let i = 0; i < 50; i++) online.update(0.1, standing);
    expect(game.silences, 'still hoping').toBe(0);

    // and a second more is not
    for (let i = 0; i < 20; i++) online.update(0.1, standing);
    expect(game.silences, 'the creatures are handed back to this client').toBeGreaterThan(0);
    expect(game.said.join(' ')).toContain('quiet');
    expect(world.opens, 'and it goes back and knocks again').toBe(2);
  });

  it('keeps a world that is still talking', () => {
    const world = deadWorld();
    const game = watching();
    const online = new Online(game.events, world.linkFor);
    online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'mesh');
    world.say({ type: 'welcome', id: 'p1', seed: 3, players: [], clock: { day: 1, time: 0.4 }, deltas: [] });

    // a quarter of a minute, with the world saying something every second, as one does
    for (let second = 0; second < 15; second++) {
      for (let i = 0; i < 10; i++) online.update(0.1, standing);
      world.say({ type: 'clock', clock: { day: 1, time: 0.4 } });
    }
    expect(game.silences).toBe(0);
    expect(world.opens).toBe(1);
  });

  it('says what it is doing about the world in this tab, which is a different sentence', () => {
    const world = deadWorld();
    const game = watching();
    const online = new Online(game.events, world.linkFor);
    // no address is the simulation in the next thread
    online.connect('', 3, 'Rowan', { day: 1, time: 0.4 }, 'mesh');
    world.say({ type: 'welcome', id: 'p1', seed: 3, players: [], clock: { day: 1, time: 0.4 }, deltas: [] });
    for (let i = 0; i < 70; i++) online.update(0.1, standing);
    expect(game.said.join(' ')).toContain('this tab');
  });

  it('joins with the version it speaks, so a mismatch is the server\'s to refuse', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    online.connect('ws://somewhere', 7, 'Rowan', { day: 2, time: 0.1 }, 'mesh');
    world.open();
    const join = JSON.parse(world.sent[0]) as { type: string; version: number; seed: number };
    expect(join).toMatchObject({ type: 'join', seed: 7, version: PROTOCOL_VERSION });
  });
});
