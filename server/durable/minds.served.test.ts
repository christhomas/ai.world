import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type VillagerSnap } from '../protocol';
import { startServer, type RunningServer } from '../serve';
import { growPatch } from '../../src/world/growworld';
import { boundsOf } from '../../src/world/patchwork';

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

/**
 * Somewhere this world actually keeps people, found by asking the world rather than assumed.
 *
 * This test used to join and stand still, and it worked because it was written against a country
 * with a middle: the bounded world put its villages around the origin, so a player who never moved
 * was standing among them. An endless country has no middle. The origin square of a seed is one
 * square of open country like any other, and `growPatch(1, '0,0')` puts its nearest village —
 * Oakreach — **408 tiles** from the origin.
 *
 * `IN_SIGHT` is sixty. So the server was perfectly correct and told this player about nothing at
 * all, not one `creatures` message in fifteen seconds, and `villager()` timed out saying no
 * villager answered. The failure read like a broken restore and was a hero standing in a field.
 *
 * No seed rescues it — the nearest village to the origin is 408 tiles away on seed 1, 115 on seed
 * 2, 91 on seed 3, 111 on seed 4 and 182 on seed 5, all of them outside sixty. So the player is
 * walked to a village instead, which is also what a real client does: it sends its own position
 * out of its own save the moment it has joined, and standing at the origin for ever was never a
 * thing a player does.
 *
 * Scanned rather than chosen: the nearest village of the origin patch, whichever the generator
 * puts there.
 */
function aVillageOf(seed: number): { name: string; x: number; z: number } {
  const villages = growPatch(seed, boundsOf('0,0')).structures.villages;
  const nearest = [...villages].sort(
    (one, two) => Math.hypot(one.x, one.z) - Math.hypot(two.x, two.z))[0];
  expect(nearest, `seed ${seed} grows no village in its origin square, so nobody can be asked anything`)
    .toBeDefined();
  return { name: nearest.name, x: nearest.x, z: nearest.z };
}

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

  /**
   * Join, and then stand where the world has somebody to talk to.
   *
   * The `move` is not decoration. A client's position is the client's own — the world takes it on
   * trust from the save — so a socket that joins and says nothing is a hero at nought, nought, and
   * on an endless country that is a field. See `aVillageOf`.
   */
  static async join(port: number, name: string, seed: number): Promise<Player> {
    const socket = new WebSocket(`ws://localhost:${port}`);
    await new Promise((open, fail) => { socket.on('open', open); socket.on('error', fail); });
    const player = new Player(socket);
    player.send({ type: 'join', seed, name, version: PROTOCOL_VERSION, day: 1, time: 0.3 });
    const village = aVillageOf(seed);
    player.send({
      type: 'move', x: village.x, z: village.z, yaw: 0, walk: 0,
      place: 'surface', riding: 'foot', gear: [],
    });
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
