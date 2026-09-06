import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from './protocol';
import { startServer, type RunningServer } from './serve';

/**
 * The server is deployed behind something that terminates TLS — Fly's edge, nginx, Caddy — so a
 * player's `wss://` never reaches it: what reaches it is a plain socket carrying an HTTP upgrade
 * that some other program has already read once and written out again. That relay is the part
 * that can break, and it breaks silently: the status page still answers, so the server looks
 * healthy while nobody can join.
 *
 * The proxy below is the same shape as the real ones — it reads the request, forwards the
 * headers verbatim, adds the X-Forwarded- pair, and then gets out of the way and copies bytes.
 * TLS itself is left off because a certificate generated inside a test run is a certificate the
 * test has to trust, which proves nothing the plain relay does not: the upgrade is the fragile
 * part, and the encryption is below it.
 */

/** Enough for a proxied handshake on a busy machine, and short enough to fail a test quickly. */
const PATIENCE = 5_000;

/** The forwarded headers a real proxy adds. The server ignores both; a proxy still sends them. */
const FORWARDED = ['X-Forwarded-Proto: https', 'X-Forwarded-For: 203.0.113.9'];

/**
 * A reverse proxy in front of `upstream`, which forwards a websocket upgrade the way an edge
 * proxy does: request line, every header as it arrived, then two sockets piped into each other.
 */
function proxyTo(upstream: number): Promise<{ port: number; close: () => Promise<void> }> {
  const proxy: Server = createServer((_req, res) => {
    res.writeHead(502);
    res.end('this proxy is only here for the upgrade');
  });

  proxy.on('upgrade', (request, socket, head) => {
    const onwards = connect(upstream, '127.0.0.1', () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`];
      for (let i = 0; i < request.rawHeaders.length; i += 2) lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
      onwards.write(`${[...lines, ...FORWARDED].join('\r\n')}\r\n\r\n`);
      if (head.length > 0) onwards.write(head);
      onwards.pipe(socket);
      socket.pipe(onwards);
    });
    onwards.on('error', () => socket.destroy());
    socket.on('error', () => onwards.destroy());
  });

  return new Promise((ready) => {
    proxy.listen(0, () => {
      const address = proxy.address();
      ready({
        port: typeof address === 'object' && address ? address.port : 0,
        close: () => new Promise<void>((done) => proxy.close(() => done())),
      });
    });
  });
}

describe('the world server behind a proxy', () => {
  let running: RunningServer;
  let proxy: { port: number; close: () => Promise<void> };
  let dir = '';

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aiworld-proxy-'));
    running = await startServer({ port: 0, dataDir: dir, quiet: true });
    proxy = await proxyTo(running.port);
  });

  afterEach(async () => {
    await proxy.close();
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Join through the proxy and hand back everything the server said, up to the welcome. */
  const joinThroughProxy = (name: string): Promise<ServerMessage[]> => new Promise((welcomed, fail) => {
    const socket = new WebSocket(`ws://127.0.0.1:${proxy.port}`);
    const heard: ServerMessage[] = [];
    const giveUp = setTimeout(() => { socket.close(); fail(new Error(`no welcome through the proxy after ${PATIENCE}ms`)); }, PATIENCE);
    socket.on('error', (why) => { clearTimeout(giveUp); fail(why); });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', seed: 7, name, version: PROTOCOL_VERSION, day: 2, time: 0.4 })));
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      heard.push(message);
      if (message.type !== 'welcome') return;
      clearTimeout(giveUp);
      socket.close();
      welcomed(heard);
    });
  });

  it('accepts a websocket upgrade that a proxy relayed, and welcomes the player', async () => {
    const heard = await joinThroughProxy('Rowan');
    const welcome = heard.find((m) => m.type === 'welcome');
    expect(welcome).toMatchObject({ seed: 7, clock: { day: 2 } });
  });

  it('tells a proxied player about one who came in directly, so the two share a world', async () => {
    const direct = new WebSocket(`ws://127.0.0.1:${running.port}`);
    await new Promise((open, fail) => { direct.on('open', open); direct.on('error', fail); });
    // Wait for the server to say it has her, rather than for it to have had time to. Sending the
    // join and joining through the proxy in the next breath is a race the proxied player wins
    // whenever the machine is busy, and then the welcome lists nobody and the test blames the
    // proxy for it.
    const wrenIsIn = new Promise<void>((seated, fail) => {
      const giveUp = setTimeout(() => fail(new Error(`no welcome for Wren after ${PATIENCE}ms`)), PATIENCE);
      direct.on('message', (raw) => {
        if ((JSON.parse(String(raw)) as ServerMessage).type !== 'welcome') return;
        clearTimeout(giveUp);
        seated();
      });
    });
    direct.send(JSON.stringify({ type: 'join', seed: 7, name: 'Wren', version: PROTOCOL_VERSION, day: 2, time: 0.4 }));
    await wrenIsIn;

    const heard = await joinThroughProxy('Rowan');
    const welcome = heard.find((m) => m.type === 'welcome');
    expect(welcome?.type === 'welcome' && welcome.players.map((p) => p.name)).toEqual(['Wren']);
    direct.close();
  });
});
