import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Wire } from './rooms';
import { Simulation } from './sim';
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
