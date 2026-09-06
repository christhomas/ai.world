import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol';
import { startServer, type RunningServer } from './serve';

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

/** A player in a world, keeping everything the server has said to them. */
const enter = async (seed: number): Promise<ServerMessage[]> => {
  const heard: ServerMessage[] = [];
  const socket = new WebSocket(`ws://localhost:${server.port}`);
  sockets.push(socket);
  await new Promise((open, fail) => { socket.on('open', open); socket.on('error', fail); });
  socket.on('message', (raw) => heard.push(JSON.parse(String(raw)) as ServerMessage));
  socket.send(JSON.stringify({ type: 'join', seed, name: 'Rowan', version: PROTOCOL_VERSION, day: 1, time: 0.3 }));
  await new Promise((rest) => setTimeout(rest, 120));
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
    await new Promise((rest) => setTimeout(rest, 120));

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
    await new Promise((rest) => setTimeout(rest, 120));
    expect(one.some((m) => m.type === 'command')).toBe(true);
    expect(two.some((m) => m.type === 'command')).toBe(true);
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
