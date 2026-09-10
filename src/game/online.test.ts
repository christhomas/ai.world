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
  const link: Link = { ready: true, send: (parcel) => { sent.push(String(parcel)); }, close: () => {} };
  return {
    sent,
    get opens() { return opened; },
    /** Hand the world a line to say, the way a real one would. */
    say(message: ServerMessage): void { heard?.onMessage(JSON.stringify(message)); },
    /** The world answers the door, which a real socket never does before it has been handed back. */
    open(): void { heard?.onOpen(); },
    /** And the socket falls over, which is the other way a world ends. */
    shut(why = 'The world closed the connection.'): void { heard?.onClose(why); },
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
    online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
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
    online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
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
    online.connect('', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
    world.say({ type: 'welcome', id: 'p1', seed: 3, players: [], clock: { day: 1, time: 0.4 }, deltas: [] });
    for (let i = 0; i < 70; i++) online.update(0.1, standing);
    expect(game.said.join(' ')).toContain('this tab');
  });

  it('joins with the version it speaks, so a mismatch is the server\'s to refuse', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    online.connect('ws://somewhere', 7, 'Rowan', { day: 2, time: 0.1 }, 'road');
    world.open();
    const join = JSON.parse(world.sent[0]) as { type: string; version: number; seed: number };
    expect(join).toMatchObject({ type: 'join', seed: 7, version: PROTOCOL_VERSION });
  });
});

/**
 * A connection that drops, rather than one that goes quiet.
 *
 * The quiet case above already went back and knocked again; a socket that closes did not. It went
 * offline and stayed there, silently, for as long as the tab was open — so a player who walked
 * through a tunnel came out the other side into a world that had stopped, with the game showing
 * nothing at all about why. Everything that gets between a page and a server looks from in here
 * exactly like the player pressing leave, so the intent is what decides: while they mean to be in a
 * world, a dropped connection is something to keep trying.
 */
describe('a connection that drops', () => {
  const join = (online: Online) => online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
  const welcome = (): ServerMessage =>
    ({ type: 'welcome', id: 'p1', seed: 3, players: [], clock: { day: 1, time: 0.4 }, deltas: [] });
  /** Run the clock, in seconds. */
  const wait = (online: Online, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) online.update(0.1, standing);
  };

  it('is tried again, and says so while it is trying', () => {
    const world = deadWorld();
    const game = watching();
    const online = new Online(game.events, world.linkFor);
    join(online);
    world.say(welcome());
    expect(online.reaching, 'in the world and still saying it is looking for one').toBe(false);

    world.shut();
    expect(online.connected).toBe(false);
    // not said on the instant: joining takes a moment and so does a hiccup, and a badge that blinks
    // on every page load is one nobody reads. See `GRACE`.
    expect(online.reaching, 'it cried off before it had even tried').toBe(false);

    // not on the very next frame either: a machine that is not there is not helped by being asked
    // faster
    wait(online, 0.5);
    expect(world.opens, 'it hammered the door').toBe(1);

    wait(online, 2);
    expect(online.reaching, 'the world went and the game gave no sign of caring').toBe(true);
    expect(world.opens, 'it never knocked again').toBe(2);
    world.say(welcome());
    expect(online.connected).toBe(true);
    expect(online.reaching, 'back in, and still flying the flag').toBe(false);
  });

  it('waits longer each time, and gives up on nothing', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    join(online);
    world.say(welcome());

    let opens = world.opens;
    const waits: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      world.shut();
      let waited = 0;
      // a minute of patience is plenty: the longest this ever waits is half of one
      while (world.opens === opens && waited < 60) { online.update(0.1, standing); waited += 0.1; }
      expect(world.opens, 'it stopped trying altogether').toBe(opens + 1);
      waits.push(waited);
      opens = world.opens;
    }
    for (let i = 1; i < waits.length; i++) {
      expect(waits[i], 'the wait between tries never grew').toBeGreaterThan(waits[i - 1]);
    }
    expect(Math.max(...waits), 'and it grew without bound').toBeLessThanOrEqual(31);
  });

  it('stops the moment somebody actually leaves', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    join(online);
    world.say(welcome());

    online.disconnect();
    expect(online.reaching, 'still hunting for a world nobody asked to be in').toBe(false);
    wait(online, 60);
    expect(world.opens, 'it went back for a world the player had left').toBe(1);
  });

  it('does not sit for ever at a door nobody answers', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    join(online);
    // never a welcome and never a close: a machine that is up with nothing listening on the port,
    // or a portal swallowing the handshake. The connect used to stay `connecting` until the tab
    // was shut.
    wait(online, 20);
    expect(world.opens, 'it waited at the first door for ever').toBeGreaterThan(1);
    expect(online.reaching).toBe(true);
  });
});

/**
 * Being in somebody else's world, as against the one in this tab.
 *
 * Every game is connected from the moment it opens — playing alone is playing against the same
 * simulation in a worker beside the page — so "are we connected" stopped being a question worth
 * asking, and the join button went on asking it. It always answered yes, so the button always took
 * its leave-the-server branch: it read the address, threw it away, and rejoined the local world.
 * Two windows, an invite link, both players online, and neither able to see the other. This is the
 * one line that tells the two apart.
 */
describe('whose world it is', () => {
  const welcome = (): ServerMessage =>
    ({ type: 'welcome', id: 'p1', seed: 3, players: [], clock: { day: 1, time: 0.4 }, deltas: [] });

  it('is this tab\'s when no address was given', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    online.connect('', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
    world.say(welcome());
    expect(online.connected).toBe(true);
    expect(online.away, 'the world in this tab counted as somebody else\'s').toBe(false);
  });

  it('is somebody else\'s when there is an address', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
    world.say(welcome());
    expect(online.away, 'a server was joined and the game did not think it was away').toBe(true);
  });

  it('is nobody\'s while it is still knocking', () => {
    const world = deadWorld();
    const online = new Online(watching().events, world.linkFor);
    online.connect('ws://somewhere', 3, 'Rowan', { day: 1, time: 0.4 }, 'road');
    expect(online.away, 'counted as away before the world had answered').toBe(false);
  });
});
