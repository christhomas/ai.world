import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import { startServer, type RunningServer } from './serve';

/**
 * The wire, end to end: a real server, real sockets, real messages. Everything the game does
 * together goes through here, so this is the file that catches a change to the protocol that
 * nobody meant to make.
 */

/** One player, seen from the outside. Messages are kept so a test can wait for the one it wants. */
class Player {
  private readonly socket: WebSocket;
  private readonly seen: ServerMessage[] = [];
  private waiting: Array<() => void> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      this.seen.push(JSON.parse(String(raw)) as ServerMessage);
      const waking = this.waiting;
      this.waiting = [];
      for (const wake of waking) wake();
    });
  }

  static async join(port: number, name: string, seed = 1, version = PROTOCOL_VERSION): Promise<Player> {
    const socket = new WebSocket(`ws://localhost:${port}`);
    await new Promise((open, fail) => { socket.on('open', open); socket.on('error', fail); });
    const player = new Player(socket);
    player.send({ type: 'join', seed, name, version, day: 1, time: 0.3 });
    return player;
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** The first message of this type to arrive, waiting up to a second for it. */
  async next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 1000;
    for (;;) {
      const found = this.seen.findIndex((m) => m.type === type);
      if (found >= 0) return this.seen.splice(found, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`waited for "${type}" and got: ${this.seen.map((m) => m.type).join(', ') || 'nothing'}`);
      await new Promise<void>((wake) => {
        this.waiting.push(wake);
        setTimeout(wake, 25);
      });
    }
  }

  /**
   * The first message of this type that answers the question asked of it, dropping earlier ones.
   * The market goes out on every change, so a test usually wants the description that has the
   * change it is waiting for rather than whichever arrived first.
   */
  async nextWhere<T extends ServerMessage['type']>(
    type: T, ready: (message: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 1000;
    for (;;) {
      const message = await this.next(type);
      if (ready(message)) return message;
      if (Date.now() > deadline) throw new Error(`no "${type}" answered the question`);
    }
  }

  /** Nothing of this type should turn up. Give it long enough that a wrong answer would arrive. */
  async never(type: ServerMessage['type']): Promise<void> {
    await new Promise((rest) => setTimeout(rest, 250));
    expect(this.seen.map((m) => m.type)).not.toContain(type);
  }

  /**
   * Take the whole handshake off the queue — welcome, the market, who this world has met — and
   * hand back my own id. A test that wants to look at the handshake reads it with next() instead.
   */
  async arrive(): Promise<string> {
    const welcome = await this.next('welcome');
    await this.next('stalls');
    await this.next('folk');
    return welcome.id;
  }

  close(): void { this.socket.close(); }
}

describe('the world server', () => {
  let dir = '';
  let server: RunningServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-serve-'));
    server = await startServer({ port: 0, dataDir: dir, quiet: true });
  });

  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const two = async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    const rowanId = await rowan.arrive();
    const wren = await Player.join(server.port, 'Wren');
    const wrenId = await wren.arrive();
    await rowan.next('joined');
    return { rowan, rowanId, wren, wrenId };
  };

  it('turns away a client that speaks a different version', async () => {
    const stranger = await Player.join(server.port, 'Ghost', 1, PROTOCOL_VERSION + 1);
    expect((await stranger.next('error')).reason).toContain('different version');
  });

  it('welcomes a player with the world as it stands, and tells everyone else they arrived', async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    const welcome = await rowan.next('welcome');
    expect(welcome.seed).toBe(1);
    expect(welcome.players).toEqual([]);
    expect(welcome.clock.day).toBe(1);
    expect((await rowan.next('folk')).names).toEqual(['Rowan']);

    const wren = await Player.join(server.port, 'Wren');
    expect((await wren.next('welcome')).players.map((p) => p.name)).toEqual(['Rowan']);
    expect((await rowan.next('joined')).player.name).toBe('Wren');
  });

  it('keeps worlds apart: a different seed is a different world', async () => {
    const here = await Player.join(server.port, 'Rowan', 1);
    await here.arrive();
    const elsewhere = await Player.join(server.port, 'Wren', 2);
    expect((await elsewhere.next('welcome')).players).toEqual([]);
    await here.never('joined');
  });

  it('passes on what somebody says, to them as well as to everyone else', async () => {
    const { rowan, wren } = await two();
    rowan.send({ type: 'say', text: '  hello there  ' });
    expect((await wren.next('said')).text).toBe('hello there');
    expect((await rowan.next('said')).name).toBe('Rowan');
  });

  it('remembers what players changed and hands it to whoever comes later', async () => {
    const { rowan, wren } = await two();
    rowan.send({ type: 'delta', delta: { kind: 'chest', id: 'vault:1:chest:0' } });
    expect((await wren.next('delta')).delta).toEqual({ kind: 'chest', id: 'vault:1:chest:0' });

    const latecomer = await Player.join(server.port, 'Alder');
    expect((await latecomer.next('welcome')).deltas).toEqual([{ kind: 'chest', id: 'vault:1:chest:0' }]);
  });

  it('relays a floor\'s monsters only to the people standing on that floor', async () => {
    const { rowan, wren } = await two();
    const elsewhere = await Player.join(server.port, 'Alder');
    await elsewhere.arrive();

    rowan.send({ type: 'move', x: 0, z: 0, yaw: 0, walk: 0, place: 'Shrine of Echoes:1', riding: 'foot', gear: [] });
    wren.send({ type: 'move', x: 1, z: 0, yaw: 0, walk: 0, place: 'Shrine of Echoes:1', riding: 'foot', gear: [] });
    elsewhere.send({ type: 'move', x: 2, z: 0, yaw: 0, walk: 0, place: 'surface', riding: 'foot', gear: [] });
    await new Promise((settle) => setTimeout(settle, 60));

    rowan.send({ type: 'monsters', place: 'Shrine of Echoes:1', snap: [{ i: 0, x: 5, z: 6, yaw: 0, walk: 0, hp: 2 }], gone: [] });
    expect((await wren.next('monsters')).snap[0].x).toBe(5);
    await elsewhere.never('monsters');

    wren.send({ type: 'hit', place: 'Shrine of Echoes:1', index: 0, damage: 3 });
    expect((await rowan.next('hit')).damage).toBe(3);
  });
});

describe('the market, over the wire', () => {
  let dir = '';
  let server: RunningServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-market-'));
    server = await startServer({ port: 0, dataDir: dir, quiet: true });
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rents a pitch, stocks it, sells from it, and pays the trader', async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    await rowan.arrive();
    const wren = await Player.join(server.port, 'Wren');
    await wren.arrive();

    rowan.send({ type: 'stall-rent', stall: 'Ashford#0', village: 'Ashford' });
    expect((await rowan.nextWhere('stalls', (m) => m.stalls.length > 0)).stalls[0].owner).toBe('Rowan');

    rowan.send({ type: 'stall-stock', stall: 'Ashford#0', item: { id: 'apple', price: 10, count: 2 } });
    const stocked = await rowan.nextWhere('stalls', (m) => m.stalls[0]?.items.length > 0);
    expect(stocked.stalls[0].items).toEqual([{ id: 'apple', price: 10, count: 2 }]);

    // everyone sees the market, so a buyer knows what is on the trestle
    const seenByWren = await wren.nextWhere('stalls', (m) => m.stalls[0]?.items.length > 0);
    expect(seenByWren.stalls[0].items[0].id).toBe('apple');

    wren.send({ type: 'stall-buy', stall: 'Ashford#0', index: 0 });
    const bought = await wren.next('stall-bought');
    expect(bought.cost).toBe(10);
    expect(bought.item).toEqual({ id: 'apple', price: 10, count: 1 });

    rowan.send({ type: 'stall-collect', stall: 'Ashford#0' });
    expect((await rowan.next('stall-takings')).gold).toBe(10);
  });

  it('refuses a pitch somebody else holds, and an empty parcel of goods', async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    await rowan.arrive();
    const wren = await Player.join(server.port, 'Wren');
    await wren.arrive();

    rowan.send({ type: 'stall-rent', stall: 'Ashford#0', village: 'Ashford' });
    await rowan.nextWhere('stalls', (m) => m.stalls.length > 0);

    wren.send({ type: 'stall-rent', stall: 'Ashford#0', village: 'Ashford' });
    expect((await wren.next('stall-refused')).reason).toContain('Rowan');

    wren.send({ type: 'stall-stock', stall: 'Ashford#0', item: { id: 'apple', price: 5, count: 1 } });
    expect((await wren.next('stall-refused')).reason).toContain('not your pitch');

    rowan.send({ type: 'stall-stock', stall: 'Ashford#0', item: { id: '', price: 5, count: 1 } });
    expect((await rowan.next('stall-refused')).reason).toContain('nothing to put out');
  });
});

describe('the post shelf, over the wire', () => {
  let dir = '';
  let server: RunningServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-post-'));
    server = await startServer({ port: 0, dataDir: dir, quiet: true });
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('carries a parcel to somebody who is here, and to somebody who is not', async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    await rowan.arrive();
    const wren = await Player.join(server.port, 'Wren');
    await wren.arrive();
    await rowan.next('folk');

    rowan.send({ type: 'mail-send', to: 'Wren', gold: 10, items: [['apple', 1]] });
    expect((await rowan.next('mail-sent')).to).toBe('Wren');
    expect((await wren.next('mail-here')).from).toBe('Rowan');

    // Wren goes away, and the parcel waits for the name rather than the connection
    wren.close();
    await new Promise((settle) => setTimeout(settle, 100));

    const wrenAgain = await Player.join(server.port, 'Wren');
    await wrenAgain.arrive();
    wrenAgain.send({ type: 'mail-fetch' });
    const mail = await wrenAgain.next('mail');
    expect(mail.letters).toHaveLength(1);
    expect(mail.letters[0]).toMatchObject({ from: 'Rowan', to: 'Wren', gold: 10, items: [['apple', 1]] });
  });

  it('refuses a parcel to yourself, and to a name the world has never met', async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    await rowan.arrive();

    rowan.send({ type: 'mail-send', to: 'Rowan', gold: 5, items: [] });
    expect((await rowan.next('mail-refused')).reason).toContain('somebody else');

    rowan.send({ type: 'mail-send', to: 'Nobody', gold: 5, items: [] });
    expect((await rowan.next('mail-refused')).reason).toContain('Nobody');
  });
});

describe('parties and bouts, over the wire', () => {
  let dir = '';
  let server: RunningServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-party-'));
    server = await startServer({ port: 0, dataDir: dir, quiet: true });
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const pair = async () => {
    const rowan = await Player.join(server.port, 'Rowan');
    const rowanId = await rowan.arrive();
    const wren = await Player.join(server.port, 'Wren');
    const wrenId = await wren.arrive();
    await rowan.next('joined');
    return { rowan, rowanId, wren, wrenId };
  };

  it('forms a party on an invitation accepted, and breaks it when one leaves', async () => {
    const { rowan, rowanId, wren, wrenId } = await pair();

    rowan.send({ type: 'party-invite', to: wrenId });
    expect((await wren.next('party-invited')).fromName).toBe('Rowan');

    wren.send({ type: 'party-answer', from: rowanId, yes: true });
    expect((await rowan.next('party')).members.map((m) => m.name).sort()).toEqual(['Rowan', 'Wren']);
    expect((await wren.next('party')).members).toHaveLength(2);

    // an errand one of them finishes reaches the other
    wren.send({ type: 'party-deed', quest: 'visit:Ashford' });
    expect(await rowan.next('party-deed')).toMatchObject({ quest: 'visit:Ashford', from: 'Wren' });

    wren.send({ type: 'party-leave' });
    expect((await rowan.next('party')).members).toEqual([]);
  });

  it('ignores an answer nobody asked for, and passes on a refusal', async () => {
    const { rowan, rowanId, wren, wrenId } = await pair();

    wren.send({ type: 'party-answer', from: rowanId, yes: true });
    await rowan.never('party');

    rowan.send({ type: 'party-invite', to: wrenId });
    await wren.next('party-invited');
    wren.send({ type: 'party-answer', from: rowanId, yes: false });
    expect((await rowan.next('party-declined')).name).toBe('Wren');
  });

  it('runs a bout from the challenge to the yielding', async () => {
    const { rowan, rowanId, wren, wrenId } = await pair();

    rowan.send({ type: 'duel-challenge', to: wrenId });
    expect((await wren.next('duel-challenged')).fromName).toBe('Rowan');

    wren.send({ type: 'duel-answer', from: rowanId, yes: true });
    expect((await rowan.next('duel-begun')).withName).toBe('Wren');
    expect((await wren.next('duel-begun')).withName).toBe('Rowan');

    rowan.send({ type: 'duel-hit', damage: 4 });
    expect((await wren.next('duel-struck')).damage).toBe(4);

    wren.send({ type: 'duel-yield' });
    expect((await rowan.next('duel-over')).winner).toBe(rowanId);
    expect((await wren.next('duel-over')).name).toBe('Wren');
  });

  it('ends a bout when the other fighter simply goes', async () => {
    const { rowan, rowanId, wren, wrenId } = await pair();
    rowan.send({ type: 'duel-challenge', to: wrenId });
    await wren.next('duel-challenged');
    wren.send({ type: 'duel-answer', from: rowanId, yes: true });
    await rowan.next('duel-begun');

    wren.close();
    expect((await rowan.next('duel-over')).name).toBe('Wren');
    expect((await rowan.next('left')).id).toBe(wrenId);
  });
});
