import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol';
import { startServer, type RunningServer } from './serve';
import { atTheSamePace } from '../tools/clock';

/**
 * The operator door: a command posted to a running world, and the players in it being told to run
 * it. What is checked here is mostly who is turned away, because this is the one route into a
 * server that is meant to be reachable from outside somebody's house.
 */

const TOKEN = 'a-long-and-boring-secret';
const WATCHING = 'a-token-that-may-only-look';

let dir: string;
let server: RunningServer;
const sockets: WebSocket[] = [];

const start = async (operatorToken?: string, watchToken?: string): Promise<void> => {
  server = await startServer({ port: 0, dataDir: dir, quiet: true, operatorToken, watchToken });
};

/**
 * Wait for something to become true, rather than for a length of time.
 *
 * Every wait in this file used to be `setTimeout(rest, 120)`: a guess at how long the server takes
 * to put a player in a room, and how long a broadcast takes to land. On the desk it was written at
 * the guess held. On a four-core ARM box it did not, and it cost a release — 0.100.1 died here on
 * `expected { sent: 'teleport 322 53', players: 0 }`, because the POST was answered while Rowan was
 * still being seated. Nothing about the server was wrong; the test was wrong about the clock, which
 * is the same fault #362 and #366 already paid for in two other files.
 *
 * A sleep asserts a duration. This asserts the thing itself and only spends the duration when the
 * thing never happens, so the fast machine gets faster and the slow one stops lying. The ceiling is
 * scaled rather than absolute for the reason `atTheSamePace` exists: handing it `longerClock`
 * outright would make a genuinely dead handshake take fifteen minutes to be called dead. Twenty
 * seconds is the same budget `serve.test.ts` and `proxy.test.ts` already chose for a handshake.
 *
 * Twenty seconds unscaled is *not* enough here, and that is worth writing down rather than tuning
 * away: a join measured **50817ms, 62642ms and 58701ms** on this four-core ARM box. The welcome is
 * queued before any of the slow work, so what a joining player waits through is `rooms.open` —
 * founding a world, at fourteen seconds a patch. On a machine that slow the knob is `TEST_TIMEOUT`,
 * exactly as #362 established for the suite at large; the minute itself is a separate fault and the
 * pull request carries the numbers.
 */
const until = async (there: () => boolean, what: string): Promise<void> => {
  const giveUpAt = Date.now() + atTheSamePace(20_000);
  while (!there()) {
    if (Date.now() > giveUpAt) throw new Error(`waited for ${what}, and it never happened`);
    await new Promise((rest) => setTimeout(rest, 10));
  }
};

/** A player in a world, keeping everything the server has said to them. */
const enter = async (seed: number): Promise<ServerMessage[]> => {
  const heard: ServerMessage[] = [];
  const socket = new WebSocket(`ws://localhost:${server.port}`);
  sockets.push(socket);
  await new Promise((open, fail) => { socket.on('open', open); socket.on('error', fail); });
  socket.on('message', (raw) => heard.push(JSON.parse(String(raw)) as ServerMessage));
  socket.send(JSON.stringify({ type: 'join', seed, name: 'Rowan', version: PROTOCOL_VERSION, day: 1, time: 0.3 }));
  // `welcome` is sent from inside the seating itself, so a player who has heard it is a player the
  // room already counts. That is exactly the fact the POST below is about to assert.
  await until(() => heard.some((m) => m.type === 'welcome'), `world ${seed} to welcome Rowan`);
  return heard;
};

const post = async (body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> => {
  const answer = await fetch(`http://localhost:${server.port}/operate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: answer.status, body: await answer.text() };
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ai-world-operate-')); });
afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('operating a world from outside it', () => {
  it('has no such route at all when no token was given to the server', async () => {
    await start();
    const answer = await post({ line: 'teleport 1 2' }, { 'x-operator-token': TOKEN });
    // the status page answers instead, which is the point: there is nothing here to attack
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('ai.world server');
  });

  it('turns away anybody without the token', async () => {
    await start(TOKEN);
    expect((await post({ line: 'teleport 1 2' })).status).toBe(401);
    expect((await post({ line: 'teleport 1 2' }, { 'x-operator-token': 'wrong' })).status).toBe(401);
    expect((await post({ line: 'teleport 1 2' }, { authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
  });

  it('takes the token in either the header the tools use or the one people type', async () => {
    await start(TOKEN);
    expect((await post({ line: 'descend' }, { 'x-operator-token': TOKEN })).status).toBe(200);
    expect((await post({ line: 'descend' }, { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  it('refuses a line that is not a command, rather than sending it to everybody', async () => {
    await start(TOKEN);
    const nonsense = await post({ line: 'fly to the moon' }, { 'x-operator-token': TOKEN });
    expect(nonsense.status).toBe(400);
    expect(nonsense.body).toContain('no such command');

    const wrong = await post({ line: 'sow 12' }, { 'x-operator-token': TOKEN });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toContain('sow takes');
  });

  it('sends a command to the players of one world, and to nobody else', async () => {
    await start(TOKEN);
    const inWorldOne = await enter(1);
    const inWorldTwo = await enter(2);

    const answer = await post({ line: 'teleport 322 53', seed: 1 }, { 'x-operator-token': TOKEN });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ sent: 'teleport 322 53', players: 1 });
    await until(() => inWorldOne.some((m) => m.type === 'command'), 'world one to be told');

    // World two is checked once world one has heard, because both are served by the one broadcast:
    // if the command were going to reach the wrong world it would have reached it by now.
    expect(inWorldOne.filter((m) => m.type === 'command')).toEqual([
      { type: 'command', line: 'teleport 322 53', issuer: 'operator' },
    ]);
    expect(inWorldTwo.filter((m) => m.type === 'command')).toEqual([]);
  });

  it('reaches every world when no world is named', async () => {
    await start(TOKEN);
    const one = await enter(1);
    const two = await enter(2);
    const answer = await post({ line: 'day 4' }, { 'x-operator-token': TOKEN });
    expect(JSON.parse(answer.body).players).toBe(2);
    await until(() => one.some((m) => m.type === 'command'), 'world one to be told');
    await until(() => two.some((m) => m.type === 'command'), 'world two to be told');
  });

  it('answers a body that is not json without falling over', async () => {
    await start(TOKEN);
    const answer = await post('not json at all', { 'x-operator-token': TOKEN });
    expect(answer.status).toBe(400);
    expect(answer.body).toContain('json');
  });

  it('will not take anything but a post', async () => {
    await start(TOKEN);
    const answer = await fetch(`http://localhost:${server.port}/operate`, { headers: { 'x-operator-token': TOKEN } });
    expect(answer.status).toBe(405);
  });
});

describe('a token that may only ask', () => {
  it('answers a question and refuses an instruction', async () => {
    await start(TOKEN, WATCHING);
    const asking = await post({ line: 'where' }, { 'x-operator-token': WATCHING });
    expect(asking.status).toBe(200);

    const doing = await post({ line: 'teleport 1 2' }, { 'x-operator-token': WATCHING });
    expect(doing.status).toBe(403);
    expect(doing.body).toContain('may only ask');
  });

  it('leaves the full token able to do both', async () => {
    await start(TOKEN, WATCHING);
    expect((await post({ line: 'where' }, { 'x-operator-token': TOKEN })).status).toBe(200);
    expect((await post({ line: 'teleport 1 2' }, { 'x-operator-token': TOKEN })).status).toBe(200);
  });

  it('opens the door for a watcher even when nobody may operate', async () => {
    await start(undefined, WATCHING);
    expect((await post({ line: 'peaks' }, { 'x-operator-token': WATCHING })).status).toBe(200);
    expect((await post({ line: 'peaks' }, { 'x-operator-token': TOKEN })).status).toBe(401);
  });

  it('shuts the door on somebody knocking too often', async () => {
    await start(TOKEN);
    let refused = 0;
    // well past the limit, and every one of them correctly authenticated: the point is the rate,
    // not the password
    for (let i = 0; i < 130; i++) {
      const answer = await post({ line: 'where' }, { 'x-operator-token': TOKEN });
      if (answer.status === 429) refused++;
    }
    expect(refused, 'the last knocks are turned away').toBeGreaterThan(0);
  });
});
