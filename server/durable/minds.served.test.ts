import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type VillagerSnap } from '../protocol';
import { startServer, type RunningServer } from '../serve';

/**
 * A villager remembers you after the container has come back, which is the whole of #104's
 * criterion and the one thing no unit test can assert.
 *
 * The register is derived: every machine that looks at a village works out who lives there, what
 * they do, when they die and who their parents were. The exception is what a man thinks of *you*,
 * because that follows from what you did and what you did happened on your screen — so it was held
 * in the server's memory alone, and every restart wiped it with nothing anywhere saying so.
 *
 * This joins a world, makes a villager remember something, stops the server, starts it again on the
 * same disk, and asks the same villager. Before the change it comes back with nothing.
 */
const PATIENCE = 20_000;

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

  static async join(port: number, name: string, seed: number): Promise<Player> {
    const socket = new WebSocket(`ws://localhost:${port}`);
    await new Promise((open, fail) => { socket.on('open', open); socket.on('error', fail); });
    const player = new Player(socket);
    player.send({ type: 'join', seed, name, version: PROTOCOL_VERSION, day: 1, time: 0.3 });
    return player;
  }

  send(message: ClientMessage): void { this.socket.send(JSON.stringify(message)); }
  close(): void { this.socket.close(); }

  /**
   * A villager the world has described who answers this, waiting for the streams to arrive.
   *
   * The whole backlog is searched each time rather than only what has just come in, and the *last*
   * match is taken rather than the first. A villager's `who` is sent when a client is first told
   * about them and again when it changes, so the earliest snap of somebody is the one before
   * anything happened to them — and a test that takes it is a test asking about the past.
   */
  async villager(wants: (who: VillagerSnap) => boolean): Promise<VillagerSnap> {
    const deadline = Date.now() + PATIENCE;
    for (;;) {
      let found: VillagerSnap | null = null;
      for (const message of this.seen) {
        if (message.type !== 'creatures') continue;
        for (const near of message.near) if (near.who && wants(near.who)) found = near.who;
      }
      if (found) return found;
      if (Date.now() > deadline) throw new Error('no villager the world described answered that');
      await new Promise<void>((wake) => { this.waiting.push(wake); setTimeout(wake, 50); });
    }
  }
}

describe('what a villager holds, across a restart', () => {
  let dir = '';
  let server: RunningServer | null = null;
  const seed = 1;

  const start = async (): Promise<RunningServer> => startServer({
    port: 0, quiet: true, dataDir: join(dir, 'worlds'), durableDb: join(dir, 'ai-world.sqlite'),
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'minds-'));
    server = await start();
  });
  afterEach(async () => {
    await server?.close();
    server = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('is still held when the server has been stopped and started again', async () => {
    const before = await Player.join(server!.port, 'Ash', seed);
    const somebody = await before.villager((who) => who.person !== '');

    before.send({ type: 'recall', who: somebody.person, what: 'saved', about: 'Ash' });
    const remembering = await before.villager(
      (who) => who.person === somebody.person && who.mind.memories.some((m) => m.who === 'Ash'));
    expect(remembering.mind.memories.some((m) => m.what === 'saved' && m.who === 'Ash')).toBe(true);
    before.close();

    // the container goes down and comes back on the same disk
    await server!.close();
    server = await start();

    const after = await Player.join(server!.port, 'Ash', seed);
    // waited for rather than read at the first sight of them: the world gives a villager back what
    // was kept the morning their village is first lived, which is a tick or two after the join
    const asked = await after.villager(
      (who) => who.person === somebody.person && who.mind.memories.some((m) => m.who === 'Ash'));
    expect(asked.mind.memories.some((m) => m.what === 'saved' && m.who === 'Ash'),
      'the villager forgot the player across a restart, which is the whole of item 104').toBe(true);
    after.close();
  }, PATIENCE * 2);

  it('leaves every other villager exactly as the seed grew them', async () => {
    const one = await Player.join(server!.port, 'Ash', seed);
    const somebody = await one.villager((who) => who.person !== '');
    one.send({ type: 'recall', who: somebody.person, what: 'saved', about: 'Ash' });
    await one.villager((who) => who.person === somebody.person && who.mind.memories.some((m) => m.who === 'Ash'));
    one.close();
    await server!.close();
    server = await start();

    const two = await Player.join(server!.port, 'Ash', seed);
    // wait until the world has given the remembered villager theirs back, so this is asked after
    // the restore rather than before it
    await two.villager((who) => who.person === somebody.person && who.mind.memories.some((m) => m.who === 'Ash'));
    const other = await two.villager((who) => who.person !== '' && who.person !== somebody.person);
    expect(other.mind.memories.some((m) => m.who === 'Ash'),
      'a villager who never met anybody must not have been given somebody else\'s memory').toBe(false);
    two.close();
  }, PATIENCE * 2);
});

/**
 * And a server that was never given anywhere to keep it, which is every test in the suite and
 * every page playing alone in a Worker.
 */
describe('a server with nowhere to keep it', () => {
  let dir = '';
  let server: RunningServer | null = null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'minds-off-'));
    server = await startServer({ port: 0, quiet: true, dataDir: join(dir, 'worlds'), durableDb: null });
  });
  afterEach(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs exactly as it did, and keeps nothing', async () => {
    const player = await Player.join(server!.port, 'Ash', 1);
    const somebody = await player.villager((who) => who.person !== '');
    player.send({ type: 'recall', who: somebody.person, what: 'saved', about: 'Ash' });
    const said = await player.villager(
      (who) => who.person === somebody.person && who.mind.memories.some((m) => m.who === 'Ash'));
    expect(said.mind.memories.length, 'the world still works, it simply forgets on the way out')
      .toBeGreaterThan(0);
    player.close();
  }, PATIENCE);
});
