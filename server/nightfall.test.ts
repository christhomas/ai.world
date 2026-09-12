import { describe, expect, it } from 'vitest';
import { Simulation } from './sim';
import { Forgetful } from './vault';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';

/**
 * A village the world is running, at one in the morning.
 *
 * Measured in a browser first, which is what made this worth writing: at 1am, four of five villagers
 * were still on the street, all of them saying "at home", and their positions were **identical to a
 * tenth of a tile over eighty seconds**. Not walking slowly — not walking at all. And the world was
 * still talking about them (fifty-four creature messages in twenty seconds), so it was not a page
 * holding a stale body: they are standing still on the world's own side.
 *
 * The page cannot see inside the simulation, so this does. It stands a world up with real ground,
 * puts a player in a village, winds the clock to the small hours and asks the one question a
 * screenshot cannot: are the villagers walking?
 */

/**
 * A player, as far as the world is concerned: a wire that keeps what it was told.
 *
 * Written out here rather than borrowed from `sim.test.ts` — a helper in a test file is that test's
 * own, and importing one across files is how two tests end up sharing a fixture neither of them can
 * change.
 */
class Pretend {
  readonly heard: ServerMessage[] = [];
  open = true;
  readonly wire: Wire;

  private readonly attached;

  constructor(sim: Simulation) {
    const player = this;
    this.wire = {
      send: (parcel) => { player.heard.push(JSON.parse(String(parcel)) as ServerMessage); },
      get open(): boolean { return player.open; },
      close: () => { player.open = false; },
    };
    this.attached = sim.attach(this.wire);
  }

  join(seed: number, name: string): this {
    this.say({ type: 'join', world: 'road', seed, name, version: PROTOCOL_VERSION, day: 2, time: 0.4 });
    return this;
  }

  say(message: ClientMessage): void {
    this.attached.receive(JSON.stringify(message));
  }
}

/** Seed 3's country has a village near the origin, which is where every ground test here stands. */
const SEED = 3;

/** A world with ground under it, patient enough not to drop the player for saying nothing. */
const standUp = () => new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });

/** Where everybody the world is holding is standing, to a hundredth of a tile. */
function whereEverybodyIs(sim: Simulation, seed: number): Map<number, string> {
  const alive = sim.livesIn(seed);
  const out = new Map<number, string>();
  if (!alive) return out;
  for (const one of alive.listNear(0, 0, 60)) out.set(one.id, `${one.kind}@${one.x.toFixed(2)},${one.z.toFixed(2)}`);
  return out;
}

describe('a village the world is running', () => {
  it('has somebody in it at all', () => {
    const sim = standUp();
    const rowan = new Pretend(sim).join(SEED, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    for (let n = 1; n <= 20; n++) sim.tick(Date.now() + n * 100);
    expect(whereEverybodyIs(sim, SEED).size, 'the world put nobody in the country at all').toBeGreaterThan(0);
  });

  it('moves them, rather than standing them in the street like posts', () => {
    /*
     * The measurement the browser could not make. A villager who is walking home is somewhere else
     * a few seconds later; one who is stuck is at the same coordinates to the hundredth. Half of
     * them moving is plenty — some are genuinely standing still on purpose, at a post or at a face —
     * and *none* of them moving is the fault.
     */
    const sim = standUp();
    const rowan = new Pretend(sim).join(SEED, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    for (let n = 1; n <= 20; n++) sim.tick(Date.now() + n * 100);

    const before = whereEverybodyIs(sim, SEED);
    expect(before.size).toBeGreaterThan(0);
    // ten seconds of world, which is several paces for anybody on their way somewhere
    for (let n = 21; n <= 120; n++) sim.tick(Date.now() + n * 100);
    const after = whereEverybodyIs(sim, SEED);

    const moved = [...before].filter(([id, was]) => after.get(id) !== undefined && after.get(id) !== was);
    expect(moved.length, `nobody in this village moved at all in ten seconds: ${[...before.values()].join(' ')}`)
      .toBeGreaterThan(0);
  });
});

describe('the same village at one in the morning', () => {
  it('puts nearly everybody indoors', () => {
    /*
     * The whole of 65. A villager who is home is not in `listNear` at all — the world stops holding
     * anybody indoors out where they can be drawn, spoken to or hit — so "how many are still out" is
     * simply how many it still reports.
     *
     * Not *everybody*: a constable is on his round until nearly one, and somebody caught out on a
     * hill has a walk ahead of him. What would be wrong is a village that looks the same at two in
     * the morning as at noon, which is what it did.
     */
    const sim = standUp();
    const rowan = new Pretend(sim).join(SEED, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    let at = Date.now();
    for (let n = 1; n <= 20; n++) sim.tick(at + n * 100);
    at += 2000;
    const atNoon = whereEverybodyIs(sim, SEED).size;
    expect(atNoon, 'nobody was out at noon either').toBeGreaterThan(0);

    // the small hours, and then long enough for the walk home: a village is a minute across
    const room = sim.rooms.get(SEED);
    expect(room, 'no room to set the clock in').toBeTruthy();
    room!.world.clock.time = 0.02;
    for (let n = 1; n <= 900; n++) {
      sim.tick(at + n * 100);
      // hold the clock in the small hours: the world would otherwise walk it on into the morning
      // and the test would be measuring dawn
      if (room!.world.clock.time > 0.12) room!.world.clock.time = 0.02;
    }

    // people only: the cows and the ducks keep their own hours and are not the question
    const folk = (): Array<{ kind: string; doing: string; indoors: boolean; posts: string; where: string }> => {
      const out = [];
      for (const e of sim.livesIn(SEED)?.all() ?? []) {
        if (!e.person && e.role !== 'villager' && !e.trade) continue;
        out.push({
          kind: e.kind.id ?? '?', doing: e.doing, indoors: e.indoors,
          posts: Object.keys(e.posts).join(','), where: `${e.x.toFixed(1)},${e.z.toFixed(1)}`,
        });
      }
      return out;
    };
    const people = folk();
    const out = people.filter((p) => !p.indoors);
    expect(people.length, 'no people in this village at all').toBeGreaterThan(0);
    expect(out.length, `everybody is still out at 1am: ${JSON.stringify(people)}`).toBeLessThan(people.length);
  });
});

describe('a village whose ground the world has not kept', () => {
  it('leaves its people standing still, because there is nothing under them to walk on', () => {
    /*
     * The shape of what a browser showed and this file could not reproduce: villagers frozen to a
     * tenth of a tile while the world went on talking about them.
     *
     * A creature walks by asking the ground whether it may stand somewhere. The world keeps only
     * the country near its players — `reach` chunks of it — and a villager whose home is outside
     * that has nowhere to put his feet: `tryMove` refuses, the tick ends where it began, and he
     * stands in the street all night saying he is at home. A small reach makes it happen on demand.
     */
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 1, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(SEED, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    let at = Date.now();
    for (let n = 1; n <= 20; n++) sim.tick(at + n * 100);
    at += 2000;

    const where = () => {
      const out = new Map<number, string>();
      for (const one of sim.livesIn(SEED)?.listNear(0, 0, 26) ?? []) out.set(one.id, `${one.x.toFixed(2)},${one.z.toFixed(2)}`);
      return out;
    };
    const before = where();
    for (let n = 1; n <= 100; n++) sim.tick(at + n * 100);
    const after = where();

    const moved = [...before].filter(([id, was]) => after.get(id) !== undefined && after.get(id) !== was);
    // deliberately recorded rather than asserted either way: what this is for is the number, and
    // the number is what says whether the browser's frozen village is this or something else
    console.log(`reach 1: ${moved.length} of ${before.size} moved in ten seconds`);
    expect(before.size).toBeGreaterThan(0);
  });
});
