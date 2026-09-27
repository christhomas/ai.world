import { randomUUID } from 'node:crypto';
import { request, type ServerResponse } from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import WebSocket from 'ws';
import type { Told } from './runs';

type Ask = { k: 'request'; id: string; method: 'GET' | 'POST'; path: string; body: string | null };
type Reply =
  | { k: 'start'; id: string; status: number; contentType: string; run?: string }
  | { k: 'data'; id: string; data: string }
  | { k: 'end'; id: string };

type Pending = { res: ServerResponse; watching?: (told: Told) => void;
  rest: string; decoder: StringDecoder; started: boolean };
type Connected = { socket: WebSocket; pending: Map<string, Pending>; pulse: ReturnType<typeof setInterval> };

const frameOf = (raw: WebSocket.RawData): Record<string, unknown> | null => {
  try {
    const frame: unknown = JSON.parse(String(raw));
    return frame !== null && typeof frame === 'object' && !Array.isArray(frame)
      ? frame as Record<string, unknown> : null;
  } catch { return null; }
};

const offline = (res: ServerResponse): void => {
  res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('your machine is not connected');
};

/** The one-pod registry: each account owns one outbound connection and only its own requests. */
export class BuilderChannel {
  private readonly workers = new Map<string, Connected>();

  connected(account: string): boolean { return this.workers.get(account)?.socket.readyState === WebSocket.OPEN; }

  attach(account: string, socket: WebSocket): void {
    this.disconnect(account);
    const pending = new Map<string, Pending>();
    let alive = true;
    const pulse = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      socket.ping();
    }, 20_000);
    const joined: Connected = { socket, pending, pulse };
    this.workers.set(account, joined);
    socket.on('pong', () => { alive = true; });
    socket.on('error', () => { socket.terminate(); });
    socket.on('message', (raw) => {
      const frame = frameOf(raw);
      if (!frame || typeof frame.id !== 'string' || !/^[0-9a-f-]{36}$/.test(frame.id)) {
        socket.terminate(); return;
      }
      const msg = frame as Reply;
      const waiting = pending.get(msg.id);
      if (!waiting) return;
      if (msg.k === 'start') {
        if (waiting.started) { socket.terminate(); return; }
        waiting.started = true;
        const contentType = typeof msg.contentType === 'string' && msg.contentType.length < 200
          && !/[\x00-\x1f\x7f]/.test(msg.contentType) ? msg.contentType : 'text/plain';
        const run = typeof msg.run === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(msg.run)
          ? { 'x-builder-run': msg.run } : {};
        waiting.res.writeHead(Number.isInteger(msg.status) && msg.status >= 200 && msg.status <= 599 ? msg.status : 502, {
          'content-type': contentType,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'x-accel-buffering': 'no',
          ...run,
        });
      } else if (msg.k === 'data' && waiting.started && typeof msg.data === 'string') {
        const chunk = Buffer.from(msg.data, 'base64');
        waiting.res.write(chunk);
        if (waiting.watching) {
          waiting.rest += waiting.decoder.write(chunk);
          const lines = waiting.rest.split('\n');
          waiting.rest = lines.pop() ?? '';
          for (const line of lines) {
            try { waiting.watching(JSON.parse(line) as Told); } catch { /* unrecognised line */ }
          }
        }
      } else if (msg.k === 'end' && waiting.started) {
        waiting.res.end();
        pending.delete(msg.id);
      } else socket.terminate();
    });
    socket.on('close', () => {
      clearInterval(pulse);
      if (this.workers.get(account) === joined) this.workers.delete(account);
      for (const { res, started } of pending.values()) {
        if (!res.writableEnded) {
          if (!started) offline(res); else res.destroy();
        }
      }
      pending.clear();
    });
    socket.send(JSON.stringify({ k: 'ready', account }));
  }

  disconnect(account: string): void { this.workers.get(account)?.socket.terminate(); }
  close(): void { for (const account of this.workers.keys()) this.disconnect(account); }

  route(account: string, path: string, body: string | null, res: ServerResponse,
    method: 'GET' | 'POST' = 'POST', watching?: (told: Told) => void): void {
    const worker = this.workers.get(account);
    if (!worker || worker.socket.readyState !== WebSocket.OPEN) { offline(res); return; }
    const id = randomUUID();
    worker.pending.set(id, { res, watching, rest: '', decoder: new StringDecoder('utf8'), started: false });
    res.on('close', () => {
      if (!worker.pending.delete(id)) return;
      if (worker.socket.readyState === WebSocket.OPEN) worker.socket.send(JSON.stringify({ k: 'cancel', id }));
    });
    worker.socket.send(JSON.stringify({ k: 'request', id, method, path, body } satisfies Ask));
  }
}

/** A local worker dials the portal, then serves only requests carried by that paired socket. */
export function dialBuilder(portal: string, pairing: string, port: number, secret: string): () => void {
  const target = new URL('/tools/build/connect', portal);
  if (target.protocol === 'https:') target.protocol = 'wss:';
  if (target.protocol === 'http:') target.protocol = 'ws:';
  if (target.protocol !== 'wss:' && !(target.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) {
    throw new Error('builder pairing needs HTTPS, except for a local portal');
  }
  let stopped = false, delay = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let socket: WebSocket | null = null;
  const connect = (): void => {
    if (stopped) return;
    const ws = new WebSocket(target, { headers: { authorization: `Bearer ${pairing}` } });
    socket = ws;
    let account: string | null = null;
    const active = new Map<string, ReturnType<typeof request>>();
    ws.on('open', () => { delay = 1000; });
    ws.on('message', (raw) => {
      const frame = frameOf(raw);
      if (!frame) { ws.terminate(); return; }
      if (frame.k === 'ready') {
        if (account || typeof frame.account !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(frame.account)) ws.terminate();
        else account = frame.account;
        return;
      }
      if (frame.k === 'cancel') {
        if (typeof frame.id !== 'string') { ws.terminate(); return; }
        active.get(frame.id)?.destroy(); active.delete(frame.id); return;
      }
      if (frame.k !== 'request' || !account || typeof frame.id !== 'string'
        || !/^[0-9a-f-]{36}$/.test(frame.id) || active.has(frame.id)
        || typeof frame.path !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(frame.path)
        || (frame.body !== null && typeof frame.body !== 'string')
        || (typeof frame.body === 'string' && Buffer.byteLength(frame.body) > 16 * 1024)
        || !((frame.method === 'POST' && frame.path === '/ask')
          || (frame.method === 'GET' && (/^\/follow(?:\?|$)/.test(frame.path) || frame.path.startsWith('/page/'))))) {
        ws.terminate(); return;
      }
      const msg = frame as Ask;
      let started = false;
      const out = request({ host: '127.0.0.1', port, path: msg.path, method: msg.method,
        headers: { 'x-builder-secret': secret, 'x-builder-who': account,
          ...(msg.body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(msg.body) }) },
      }, (answer) => {
        const send = (part: Reply): void => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(part)); };
        started = true;
        send({ k: 'start', id: msg.id, status: answer.statusCode ?? 502,
          contentType: String(answer.headers['content-type'] ?? 'text/plain'),
          run: typeof answer.headers['x-builder-run'] === 'string' ? answer.headers['x-builder-run'] : undefined });
        answer.on('data', (chunk: Buffer) => send({ k: 'data', id: msg.id, data: chunk.toString('base64') }));
        answer.on('end', () => { send({ k: 'end', id: msg.id }); active.delete(msg.id); });
      });
      active.set(msg.id, out);
      out.on('error', () => {
        if (!active.has(msg.id)) return;
        if (ws.readyState === WebSocket.OPEN) {
          if (!started) ws.send(JSON.stringify({ k: 'start', id: msg.id, status: 502, contentType: 'text/plain' }));
          ws.send(JSON.stringify({ k: 'end', id: msg.id }));
        }
        active.delete(msg.id);
      });
      if (msg.body !== null) out.write(msg.body);
      out.end();
    });
    ws.on('close', () => {
      for (const out of active.values()) out.destroy();
      active.clear();
      if (stopped) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    });
    ws.on('error', () => { /* close schedules the next attempt */ });
  };
  connect();
  return () => { stopped = true; if (timer) clearTimeout(timer); socket?.terminate(); };
}
