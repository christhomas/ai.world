import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { Patchwork, PATCH } from '../src/world/patchwork';
import { patchedCountry } from '../src/world/groundworld';
import { endlessStamp, growPatch } from '../src/world/growworld';
import { peopleOf } from './people';

/**
 * The server, holding a country with no edge.
 *
 * The last piece of item 59f, and the one deliberately left until the rest was done. The ground
 * half of a server flipping to the endless world is one line — `GroundWorld` has stood on a
 * `Country` since the 12th, and a patchwork satisfies it. The line after it is the hard one: the
 * register, the villagers and the claimed mines were all read off one whole-world sampler on the
 * morning the world was opened, and an endless world has no such morning.
 *
 * So most of what is asked here is asked of `peopleOf` directly, over a patchwork built the same
 * way the simulation builds one. That is the half that had to change, and reaching for it through
 * a socket would be testing the socket.
 */

const nobodyIsTold = { onFallen: () => {}, onArrest: () => {} };

describe('who lives in a country with no edge', () => {
  it('knows the people of the square that has been grown', () => {
    const patches = new Patchwork(7, growPatch);
    patches.at(20, 20);
    const folk = peopleOf(7, patchedCountry(patches), 2, nobodyIsTold);
    expect(folk.villages.length).toBeGreaterThan(0);
  });

  /*
   * The question the whole item is about.
   *
   * A bounded world knows every village it will ever have on the morning it opens. An endless one
   * knows the square somebody is standing in, and the honest answer to "every village there is" is
   * "every village in the country somebody has walked into" — which has to get bigger.
   */
  it('finds more of them as more country is walked into', () => {
    const patches = new Patchwork(7, growPatch);
    patches.at(20, 20);
    const folk = peopleOf(7, patchedCountry(patches), 2, nobodyIsTold);
    const atFirst = folk.villages.length;

    patches.at(PATCH + 20, 20);                  // a square away: country nobody had walked into
    folk.catchUp();
    expect(folk.villages.length).toBeGreaterThan(atFirst);
  });

  /*
   * And it has to be the *same array*, not a new one.
   *
   * `wildlife.ts` and the roster take this list once and keep it. A world that handed out a fresh
   * array every time a patch arrived would leave every one of them holding the country as it was
   * on the morning they started, which is the failure this whole item exists to prevent wearing
   * different clothes.
   */
  it('grows the list the rest of the server is already holding', () => {
    const patches = new Patchwork(7, growPatch);
    patches.at(20, 20);
    const folk = peopleOf(7, patchedCountry(patches), 2, nobodyIsTold);
    const held = folk.villages;                   // what the roster took on the first morning

    patches.at(PATCH + 20, 20);
    folk.catchUp();
    expect(folk.villages).toBe(held);
    expect(held.length).toBeGreaterThan(0);
  });

  it('folds a square in once, however often it is asked', () => {
    const patches = new Patchwork(7, growPatch);
    patches.at(20, 20);
    const folk = peopleOf(7, patchedCountry(patches), 2, nobodyIsTold);
    const atFirst = folk.villages.length;
    folk.catchUp();
    folk.catchUp();
    expect(folk.villages.length).toBe(atFirst);
  });

  /*
   * The ordering rule, which is the one thing about this that can quietly go wrong.
   *
   * Which villages have a mine has to reach the register *before* anybody settles, because a
   * village is founded once and its trades are fixed then. Tell it afterwards and the mining
   * village has already been raised without miners in it — and in an endless world "afterwards"
   * is any patch that arrives after the first.
   */
  it('settles the people of a square that arrived after the world was opened', () => {
    const patches = new Patchwork(7, growPatch);
    patches.at(20, 20);
    const folk = peopleOf(7, patchedCountry(patches), 2, nobodyIsTold);

    patches.at(PATCH + 20, 20);
    folk.catchUp();
    const far = folk.villages[folk.villages.length - 1];
    folk.register.settle(far.name, far.houses.length, ['farmer', 'seller']);
    expect(folk.register.living(far.name).length).toBeGreaterThan(0);
  });
});

class Pretend {
  readonly heard: ServerMessage[] = [];
  open = true;
  readonly wire: Wire;
  private readonly attached;

  constructor(sim: Simulation) {
    const player = this;
    this.wire = {
      send: (parcel) => { if (typeof parcel === 'string') player.heard.push(JSON.parse(parcel) as ServerMessage); },
      get open(): boolean { return player.open; },
      close: () => { player.open = false; },
    };
    this.attached = sim.attach(this.wire);
  }

  say(message: ClientMessage): void { this.attached.receive(JSON.stringify(message)); }

  of<T extends ServerMessage['type']>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.heard.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

describe('and the simulation standing one up', () => {
  /*
   * The door, which was nailed shut.
   *
   * `sim.ts` hardcoded the room's kind to `'road'` — right for exactly as long as there was one
   * country, and wrong from the moment there were two. An endless page opened a road room and then
   * correctly reported *"this world is endless here and road in the world you joined"* on its first
   * frame. Everything else about the endless server was built and unreachable behind it, which is
   * why this asserts the *kind the client asked for* rather than that some ground exists: a road
   * room has villages too, so "there are villages" proved nothing at all.
   */
  it('opens the endless country', () => {
    // ground is off by default so that no test pays two-thirds of a second by accident; this one is
    // about the ground, so it asks for it
    const sim = new Simulation({ vault: new Forgetful(), ground: true });
    const rowan = new Pretend(sim);
    rowan.say({
      type: 'join', seed: 7, name: 'Rowan', version: PROTOCOL_VERSION, day: 2, time: 0.4, x: 20, z: 20,
    });
    expect(rowan.of('country')[0]?.stamp).toBe(endlessStamp(7, []));
    const ground = sim.groundOf(7);
    expect(ground).not.toBeNull();
    expect(ground!.villages.length).toBeGreaterThan(0);
  });

  it('migrates a retired kind and an old silent client into the endless country', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true });
    const rowan = new Pretend(sim);
    rowan.say({
      type: 'join', world: 'road', seed: 11, name: 'Rowan', version: PROTOCOL_VERSION, day: 2, time: 0.4, x: 20, z: 20,
    } as never);
    expect(rowan.of('country')[0]?.stamp).toBe(endlessStamp(11, []));

    // an older build, which says nothing about the country, lands where it always did
    const bryn = new Pretend(sim);
    bryn.say({ type: 'join', seed: 12, name: 'Bryn', version: PROTOCOL_VERSION, day: 2, time: 0.4 } as never);
    expect(bryn.of('country')[0]?.stamp).toBe(endlessStamp(12, []));
  });

  /*
   * And an endless room really is one — which used to be said by silence, and is now said by the
   * stamp itself.
   *
   * A road world hashes its whole country because it has one: one graph, grown once, with every
   * village and door in the world derived from it. An endless world has a graph per square, so
   * hashing the square somebody happens to be standing in would report a disagreement between two
   * halves standing in different places, and this message carried an empty string rather than do
   * that. #377 is the argument that the empty string went too far: a country with no edge still
   * has whole-country facts, it has had one that can *differ* since #376 — the layer list — and a
   * stamp that cannot disagree is worse than no stamp, because it reports agreement.
   *
   * So what is asserted here is that it is `endlessStamp` and not the road graph's: the same eight
   * characters for a world with no layers whichever square is grown, and different eight the
   * moment the world was authored with something.
   */
  it('fingerprints what is whole-country about a country that has no whole country', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true });
    const rowan = new Pretend(sim);
    rowan.say({
      type: 'join', seed: 7, name: 'Rowan', version: PROTOCOL_VERSION, day: 2, time: 0.4, x: 20, z: 20,
    });
    const stamp = rowan.of('country')[0]?.stamp;
    expect(stamp).toBe(endlessStamp(7, []));
    expect(stamp, 'an endless country went back to saying nothing about itself').not.toBe('');
    // and it is evidence rather than a formality: a world authored with a range is a different word
    expect(stamp).not.toBe(endlessStamp(7, [{ x: 0, z: 0, reach: 300, lift: 24 }]));
  });

  /*
   * And a server that grows no ground at all still says nothing, which is the one case where
   * silence remains the right answer: there is no country here to take a fingerprint of, and an
   * empty string is read by the page as silence rather than as agreement.
   */
  it('does not revive a whole-country fingerprint for a retired kind', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim);
    rowan.say({
      type: 'join', world: 'road', seed: 7, name: 'Rowan', version: PROTOCOL_VERSION, day: 2, time: 0.4, x: 20, z: 20,
    } as never);
    expect(rowan.of('country')[0]).toEqual({ type: 'country', stamp: '' });
  });
});
