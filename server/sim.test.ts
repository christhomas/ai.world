import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { Simulation } from './sim';
import { IN_SIGHT } from './wildlife';
import { Forgetful } from './vault';

/**
 * The simulation on its own, with no sockets and no files anywhere near it.
 *
 * This is the test that says the thing is portable. Everything here drives it through a `Wire` made
 * of an array — which is exactly what a Web Worker's `postMessage` is, once the ceremony is taken
 * off — so if these pass, the same code passes in a browser thread. The websocket server has its own
 * tests over a real socket; between the two, both hosts are covered without either being written
 * twice.
 */

/** A player made of a list: everything the simulation said to them, in order. */
class Pretend {
  readonly heard: ServerMessage[] = [];
  /** Whether the simulation still thinks it can reach them. Closed when it gives up on them. */
  open = true;
  readonly wire: Wire;
  private readonly attached;

  constructor(sim: Simulation) {
    // the wire holds a closure over this player rather than reading `this`, because inside an
    // object literal `this` is the literal, and a getter reading its own name is a stack overflow
    const player = this;
    this.wire = {
      send: (text) => { player.heard.push(JSON.parse(text) as ServerMessage); },
      get open(): boolean { return player.open; },
      close: () => { player.open = false; },
    };
    this.attached = sim.attach(this.wire);
  }

  join(seed: number, name: string, version = PROTOCOL_VERSION): this {
    this.say({ type: 'join', seed, name, version, day: 2, time: 0.4 });
    return this;
  }

  say(message: ClientMessage): void {
    this.attached.receive(JSON.stringify(message));
  }

  leave(): void {
    this.attached.leave();
  }

  /** Every message of a type, which is what a test is usually asking about. */
  of<T extends ServerMessage['type']>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.heard.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

describe('the simulation, hosted by nothing at all', () => {
  it('welcomes a player, and tells them the world they arrived in', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');

    const [welcome] = rowan.of('welcome');
    expect(welcome).toMatchObject({ seed: 7, clock: { day: 2 } });
    expect(welcome.players).toEqual([]);
    // and the rest of the handshake, which is what a client needs before it can draw anything
    expect(rowan.of('stalls')).toHaveLength(1);
    expect(rowan.of('folk')[0].names).toEqual(['Rowan']);
  });

  it('turns away a client that speaks a different version', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const old = new Pretend(sim).join(7, 'Rowan', PROTOCOL_VERSION - 1);
    expect(old.of('error')).toHaveLength(1);
    expect(old.of('welcome')).toHaveLength(0);
  });

  it('puts two players in one world and lets them hear each other', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    const wren = new Pretend(sim).join(7, 'Wren');

    // she was told he is already here; he was told she arrived
    expect(wren.of('welcome')[0].players.map((p) => p.name)).toEqual(['Rowan']);
    expect(rowan.of('joined').map((m) => m.player.name)).toEqual(['Wren']);

    wren.say({ type: 'say', text: 'is anyone about?' });
    expect(rowan.of('said').map((m) => m.text)).toEqual(['is anyone about?']);
    // and she hears her own line, so the log reads the same for everybody in it
    expect(wren.of('said').map((m) => m.text)).toEqual(['is anyone about?']);
  });

  it('keeps two seeds apart, however loudly either of them talks', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const here = new Pretend(sim).join(7, 'Rowan');
    const elsewhere = new Pretend(sim).join(8, 'Wren');
    elsewhere.say({ type: 'say', text: 'hello?' });
    expect(here.of('said')).toHaveLength(0);
  });

  it('passes on what one player changed about the world', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    const wren = new Pretend(sim).join(7, 'Wren');
    rowan.say({ type: 'delta', delta: { kind: 'chest', id: 'vault:1:chest:0' } });
    expect(wren.of('delta').map((m) => m.delta)).toEqual([{ kind: 'chest', id: 'vault:1:chest:0' }]);
  });

  it('moves the clock and tells everybody where everybody is', () => {
    // a patient world, because stepping a minute forward would otherwise drop both of them for
    // having said nothing in thirty seconds — which is the next test, not this one
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    new Pretend(sim).join(7, 'Wren');
    const started = sim.rooms.get(7)!.world.clock.time;

    // an hour of a world is five minutes of ours, so a minute of stepping is plainly visible
    sim.tick(Date.now() + 60_000);
    expect(sim.rooms.get(7)!.world.clock.time).toBeGreaterThan(started);
    expect(rowan.of('presence').at(-1)?.players.map((p) => p.name)).toEqual(['Wren']);
  });

  it('drops somebody it has not heard from, and closes the world they were alone in', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 1_000 });
    const rowan = new Pretend(sim).join(7, 'Rowan');
    expect(sim.rooms.playerCount).toBe(1);

    sim.tick(Date.now() + 5_000);
    expect(rowan.open, 'the wire was closed on them').toBe(false);
    expect(sim.rooms.playerCount).toBe(0);
    // and the room went with them: an empty world is not worth ticking
    sim.tick(Date.now() + 6_000);
    expect(sim.rooms.worldCount).toBe(0);
  });

  it('gives a world back to whoever opens it next, out of whatever it was kept in', () => {
    const vault = new Forgetful();
    const first = new Simulation({ vault, dataDir: 'worlds' });
    new Pretend(first).join(7, 'Rowan').say({ type: 'delta', delta: { kind: 'key', id: 'vault:1' } });
    first.stop();

    const second = new Simulation({ vault, dataDir: 'worlds' });
    const later = new Pretend(second).join(7, 'Wren');
    expect(later.of('welcome')[0].deltas).toEqual([{ kind: 'key', id: 'vault:1' }]);
    expect(later.of('folk')[0].names, 'and who it has met').toEqual(['Rowan', 'Wren']);
  });

  it('says nothing to somebody who never said who they are', () => {
    const sim = new Simulation({ vault: new Forgetful() });
    const stranger = new Pretend(sim);
    stranger.say({ type: 'say', text: 'let me in' });
    expect(stranger.heard).toEqual([]);
    expect(sim.rooms.playerCount).toBe(0);
  });
});

describe('the simulation holding the ground itself', () => {
  it('grows a world when somebody stands in it, and only where they are standing', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    expect(sim.groundOf(3)!.held, 'nothing until somebody is there').toBe(0);

    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    // five by five chunks round one player
    expect(sim.groundOf(3)!.held).toBe(25);
  });

  it('follows a player, and forgets the country behind them', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 1, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    const first = sim.groundOf(3)!.held;
    expect(first).toBe(9);

    // a long way off: the ground there is made, and the ground they left is dropped
    rowan.say({ type: 'move', x: 900, z: 900, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 200);
    expect(sim.groundOf(3)!.held).toBe(9);
    expect(sim.groundOf(3)!.heightAt(0.5, 0.5), 'where they were is gone').toBeNull();
  });

  it('lets go of a world\'s ground when the last player leaves it', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 1, timeout: 1_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    expect(sim.groundOf(3)!.held).toBeGreaterThan(0);

    sim.tick(Date.now() + 5_000);          // long enough that they are dropped for silence
    sim.tick(Date.now() + 6_000);          // and the empty room is closed
    expect(sim.groundOf(3)!.held, 'a fresh world, not the old one').toBe(0);
  });

  it('walks the hero itself, and says where he got to', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    // the first move is a placing rather than a walk: nothing has walked him anywhere yet
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);

    // push east for a fifth of a second, which at the hero's pace is about a tile
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const [first] = rowan.of('youAre');
    expect(first.seq).toBe(1);
    expect(first.x).toBeCloseTo(1.1, 1);
    expect(first.z).toBeCloseTo(0, 5);
    // and the ground he is standing on came with it
    expect(first.y).toBe(sim.groundOf(3)!.heightAt(first.x, first.z));

    // a steer that arrives after a newer one is dropped rather than walked backwards
    rowan.say({ type: 'steer', seq: 3, dx: 1, dz: 0, pace: 1, ms: 200 });
    rowan.say({ type: 'steer', seq: 2, dx: -1, dz: 0, pace: 1, ms: 200 });
    const said = rowan.of('youAre');
    expect(said).toHaveLength(2);
    expect(said[1]).toMatchObject({ seq: 3 });
    expect(said[1].x).toBeGreaterThan(first.x);
  });

  it('will not be told where the hero is standing by the machine drawing him', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);        // the ground grows round him before anything can walk on it
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    const walked = rowan.of('youAre')[0].x;

    // a client claiming a couple of tiles it did not walk is ignored: the server has its own hero
    rowan.say({ type: 'move', x: 3, z: 0, yaw: 0, walk: 1, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    const bystander = new Pretend(sim).join(3, 'Ash');
    expect(bystander.of('welcome')[0].players[0].x).toBeCloseTo(walked, 5);

    // and a move saying he is somewhere else entirely is still only a move: the world is walking
    // him, so it knows where he is and this is not news
    rowan.say({ type: 'move', x: 400, z: -120, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    rowan.say({ type: 'steer', seq: 2, dx: 0, dz: 1, pace: 1, ms: 200 });
    expect(rowan.of('youAre').at(-1)!.x, 'nowhere near where it claimed').toBeCloseTo(walked, 1);
  });

  it('takes a jump when it is told it was a jump, and says where that leaves him', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });

    // a teleport, a staircase, a gangplank: the one kind of move a walk cannot account for
    rowan.say({ type: 'stood', x: 400, z: -120, why: 'teleport' });
    const put = rowan.of('youAre').at(-1)!;
    expect(put.x).toBe(400);
    expect(put.z).toBe(-120);

    // and he walks on from there rather than from where he was
    sim.tick(Date.now() + 200);
    rowan.say({ type: 'steer', seq: 2, dx: 0, dz: 1, pace: 1, ms: 200 });
    const after = rowan.of('youAre').at(-1)!;
    expect(after.x).toBeCloseTo(400, 5);
    expect(after.z).toBeGreaterThan(-120);
  });

  it('leaves the client its own authority in a world with no ground', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 12, z: 8, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 200 });
    expect(rowan.of('youAre')).toHaveLength(0);
    const bystander = new Pretend(sim).join(3, 'Ash');
    expect(bystander.of('welcome')[0].players[0]).toMatchObject({ x: 12, z: 8 });
  });

  it('grows nothing at all when it was not asked to', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    rowan.say({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    sim.tick(Date.now() + 100);
    expect(sim.groundOf(3)).toBeNull();
  });
});

describe('the world alive on the server', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };

  it('puts creatures in the country a player is standing in', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    expect(sim.livesIn(3)!.count, 'an empty world before anybody is in it').toBe(0);

    sim.tick(Date.now() + 100);
    expect(sim.livesIn(3)!.count, 'a countryside with things living in it').toBeGreaterThan(20);
  });

  it('lets them live: they move about on their own', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    sim.tick(Date.now() + 100);

    const before = [...sim.livesIn(3)!.all()].map((e) => ({ e, x: e.x, z: e.z }));
    let now = Date.now() + 100;
    for (let i = 0; i < 60; i++) sim.tick(now += 100);
    const moved = before.filter(({ e, x, z }) => Math.hypot(e.x - x, e.z - z) > 0.2);
    expect(moved.length, 'some of them went somewhere').toBeGreaterThan(0);
  });

  it('has nothing alive in a world it is not holding the ground of', () => {
    const sim = new Simulation({ vault: new Forgetful(), timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    sim.tick(Date.now() + 100);
    expect(sim.livesIn(3)).toBeNull();
  });
});

describe('telling players what is alive near them', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  /** Enough ticks for the creatures to go out, which they do rarer than presence. */
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };

  it('sends a player the creatures they can see, and nothing further off', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    const told = rowan.of('creatures').at(-1);
    expect(told, 'they were told about the country round them').toBeDefined();
    expect(told!.near.length).toBeGreaterThan(0);
    for (const c of told!.near) {
      expect(Math.hypot(c.x, c.z), `${c.kind} at ${c.x},${c.z}`).toBeLessThanOrEqual(IN_SIGHT + 1);
      expect(c.kind.length, 'it says what it is').toBeGreaterThan(0);
    }
  });

  it('says what has gone out of sight, once, and then stops mentioning it', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    const from = Date.now();
    tickFor(sim, 600, from);
    const first = rowan.of('creatures').at(-1)!;
    expect(first.near.length).toBeGreaterThan(0);

    // a long walk: everything they could see is behind them now
    walkAbout(rowan, 4_000, 4_000);
    tickFor(sim, 600, from + 1_000);
    const after = rowan.of('creatures').at(-1)!;
    expect(after.gone.length, 'the country they left is taken off their screen').toBeGreaterThan(0);
    expect(after.near, 'and there is nothing where they went, which is unloaded ground').toEqual([]);
  });

  it('tells two players in one field about the same creatures', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    walkAbout(rowan, 0, 0);
    walkAbout(wren, 4, 4);
    tickFor(sim, 900);

    const his = new Set(rowan.of('creatures').at(-1)!.near.map((c) => c.id));
    const hers = wren.of('creatures').at(-1)!.near.map((c) => c.id);
    expect(hers.length).toBeGreaterThan(0);
    // standing four tiles apart, they are looking at the same animals — which is the whole point
    expect(hers.filter((id) => his.has(id)).length).toBeGreaterThan(hers.length / 2);
  });

  it('costs what it was measured to cost, per player per second', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 3_000);

    const messages = rowan.of('creatures');
    const bytes = messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
    // three seconds of standing in open country: this is the number that decides whether a
    // domestic router and a Raspberry Pi can carry a world, so it is written down rather than felt
    expect(messages.length, 'about three a second').toBeGreaterThan(5);
    expect(bytes / 3, 'bytes a second, one player').toBeLessThan(40_000);
  });
});

describe('hunting something the world owns', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };

  /** Face a hero at something and put him on his feet, which is what makes a swing land. */
  const faceAt = (who: Pretend, seq: number, x: number, z: number, at: { x: number; z: number }): void => {
    who.say({ type: 'steer', seq, dx: at.x - x, dz: at.z - z, pace: 1, ms: 20 });
  };
  /** Everything in front of the hero, out to a bowshot: what a wide swing reaches. */
  const wide = { place: 'surface', damage: 20, reach: 15, arc: 1.4, one: false } as const;

  it('works out for itself what a blow reached, and says who killed what', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    const prey = rowan.of('creatures').at(-1)!.near[0];
    expect(prey, 'there is something to hunt').toBeDefined();

    // face it and swing until whatever is over there stops being there. The client says how hard
    // it hit and how far it reached, and nothing at all about what it hit.
    for (let blow = 0; blow < 30; blow++) {
      faceAt(rowan, blow + 1, 0, 0, prey);
      rowan.say({ type: 'swing', ...wide });
    }
    const killed = rowan.of('killed');
    expect(killed.length, 'the world says something died').toBeGreaterThan(0);
    expect(killed[0].by, 'and who did it, so they take what was on it').toBe(rowan.of('welcome')[0].id);
  });

  it('reaches nothing at all behind the hero', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);
    const prey = rowan.of('creatures').at(-1)!.near[0];

    // faced the other way, and swinging with everything: an arc is an arc
    for (let blow = 0; blow < 30; blow++) {
      faceAt(rowan, blow + 1, 0, 0, { x: -prey.x, z: -prey.z });
      rowan.say({ type: 'swing', ...wide, arc: 0.6 });
    }
    expect(rowan.of('killed').map((k) => k.id)).not.toContain(prey.id);
  });

  it('tells everybody in the world, not only whoever swung', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    walkAbout(rowan, 0, 0);
    walkAbout(wren, 3, 3);
    tickFor(sim, 900);

    const prey = rowan.of('creatures').at(-1)!.near[0];
    for (let blow = 0; blow < 30; blow++) {
      faceAt(rowan, blow + 1, 0, 0, prey);
      rowan.say({ type: 'swing', ...wide });
    }
    expect(wren.of('killed').length, 'the body falls on her screen too').toBeGreaterThan(0);
    expect(wren.of('killed')[0].by, 'and it was not her').not.toBe(wren.of('welcome')[0].id);
  });

  it('will not take a client\'s word for how hard it hit', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);

    // something with enough hearts that one honest blow could not do it
    const near = rowan.of('creatures').at(-1)!.near;
    const stout = near.reduce((a, b) => (a.hp > b.hp ? a : b));
    faceAt(rowan, 1, 0, 0, stout);
    rowan.say({ type: 'swing', ...wide, damage: 1e9 });
    tickFor(sim, 400, Date.now() + 600);

    // one blow may be worth a great deal and still not be worth a number nothing could produce
    if (stout.hp > 40) {
      expect(rowan.of('killed').map((k) => k.id), 'a made-up number does not kill it').not.toContain(stout.id);
    }
  });

  it('has nothing to swing with until the world is walking the hero', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);
    // never steered, so the world has never stood him anywhere: a blow from nowhere lands nowhere
    for (let blow = 0; blow < 30; blow++) rowan.say({ type: 'swing', ...wide });
    expect(rowan.of('killed')).toHaveLength(0);
  });
});

describe('a floor under the world', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };
  const goDown = (who: Pretend, place: string): void => {
    who.say({ type: 'floor', place, anchor: 'dungeon:Barrow', kind: 'dungeon', floor: 1 });
    who.say({ type: 'move', x: 4, z: 4, yaw: 0, walk: 0, place, riding: 'foot', gear: [] });
  };

  it('grows the floor somebody walks into, and tells them what is down there', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 300);
    goDown(rowan, 'Barrow:1');
    tickFor(sim, 900, Date.now() + 300);

    const below = rowan.of('creatures').filter((c) => c.place === 'Barrow:1');
    expect(below.length, 'the world describes the floor').toBeGreaterThan(0);
    expect(below[0].near.length, 'and there is something in it').toBeGreaterThan(0);
  });

  it('keeps a floor and a hillside apart, however alike their numbers are', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    const wren = new Pretend(sim).join(3, 'Wren');
    walkAbout(rowan, 0, 0);
    walkAbout(wren, 0, 0);
    tickFor(sim, 300);
    goDown(wren, 'Barrow:1');
    tickFor(sim, 900, Date.now() + 300);

    // she is underground and hears about the floor; he is above and hears about the country
    expect(wren.of('creatures').every((c) => c.place === 'Barrow:1')).toBe(true);
    expect(rowan.of('creatures').every((c) => c.place === 'surface')).toBe(true);
  });

  it('lets go of a floor when the last person climbs out of it', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 300);
    goDown(rowan, 'Barrow:1');
    tickFor(sim, 600, Date.now() + 300);
    const heard = rowan.of('creatures').filter((c) => c.place === 'Barrow:1').length;
    expect(heard).toBeGreaterThan(0);

    // back up the stairs, and the floor is nobody's any more
    walkAbout(rowan, 0, 0);
    tickFor(sim, 900, Date.now() + 900);
    expect(rowan.of('creatures').filter((c) => c.place === 'Barrow:1')).toHaveLength(heard);
  });

  it('will not let a blow thrown on a floor reach a deer in a field', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 2, timeout: 10 * 60_000 });
    const rowan = new Pretend(sim).join(3, 'Rowan');
    walkAbout(rowan, 0, 0);
    tickFor(sim, 600);
    rowan.say({ type: 'steer', seq: 1, dx: 1, dz: 0, pace: 1, ms: 20 });
    goDown(rowan, 'Barrow:1');
    tickFor(sim, 400, Date.now() + 600);

    // swinging underground, and claiming to be swinging up in the daylight
    for (let blow = 0; blow < 20; blow++) {
      rowan.say({ type: 'swing', place: 'surface', damage: 40, reach: 15, arc: 3, one: false });
    }
    expect(rowan.of('killed').filter((k) => k.place === 'surface')).toHaveLength(0);
  });
});

describe('a world with several people in it', () => {
  const walkAbout = (who: Pretend, x: number, z: number): void => {
    who.say({ type: 'move', x, z, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
  };
  const tickFor = (sim: Simulation, ms: number, from = Date.now()): void => {
    for (let at = 100; at <= ms; at += 100) sim.tick(from + at);
  };

  /**
   * The failure this exists to prevent, found by putting four players on a server and looking:
   * the creature manager followed one hero, so the country round everybody else was spawned and
   * then thrown away as the focus moved on. Three of the four stood in an empty world.
   */
  it('keeps the country alive round everybody, not only round whoever is followed', () => {
    const sim = new Simulation({ vault: new Forgetful(), ground: true, reach: 3, timeout: 10 * 60_000 });
    const apart = [
      { who: new Pretend(sim).join(3, 'Rowan'), x: 0, z: 0 },
      { who: new Pretend(sim).join(3, 'Wren'), x: 220, z: 40 },
      { who: new Pretend(sim).join(3, 'Bram'), x: -140, z: 180 },
    ];
    for (const { who, x, z } of apart) walkAbout(who, x, z);
    tickFor(sim, 1_500);

    for (const { who } of apart) {
      const told = who.of('creatures').at(-1);
      expect(told?.near.length ?? 0, `${who.of('welcome')[0].id} has a world round them`).toBeGreaterThan(0);
    }
  });
});
