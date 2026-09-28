/**
 * Streams live, recording-only game frames to the Flutter client.
 *
 * Run `pnpm exec tsx server/flutter-scene-feed.ts` beside the Flutter app. The
 * browser still runs the complete game loop; its only frame sink is recording.
 * The bridge expands prop geometry into the existing neutral instances primitive.
 */
import { chromium } from 'playwright';
import { WebSocketServer, type WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { FrameDescription } from '../src/core/scene';
import { expandForFlutter, disposeFlutterFrameGeometry } from '../src/render/flutter-frame';

const address = process.env.SCENE_SOURCE ?? 'http://localhost:5173/?seed=3';
const port = Number(process.env.SCENE_FEED_PORT ?? '8788');
const url = new URL(address);
url.searchParams.set('record-only', '1');
const server = new WebSocketServer({ host: '0.0.0.0', port });
const sentGeometry = new WeakMap<WebSocket, Set<string>>();
server.on('connection', (client) => sentGeometry.set(client, new Set()));
const browser = await chromium.launch({ headless: true, channel: process.env.CHANNEL || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('pageerror', (error) => console.error('game:', error));
await page.goto(url.toString(), { waitUntil: 'load' });
await page.waitForFunction(() => (window as Window & { __recording?: unknown }).__recording !== undefined,
  null, { timeout: 180_000 });
console.log(`Flutter scene feed ws://0.0.0.0:${port} from ${url}`);
let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  disposeFlutterFrameGeometry();
  for (const client of server.clients) client.close();
  server.close();
  await browser.close();
}
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });

while (!closing) {
  if (server.clients.size === 0) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    continue;
  }
  try {
    const raw = await page.evaluate(async () => {
      const recording = (window as unknown as Window & { __recording: {
        last: FrameDescription | null; captureNext(): void;
      } }).__recording;
      recording.last = null;
      recording.captureNext();
      const deadline = performance.now() + 5000;
      while (!recording.last && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      if (!recording.last) throw new Error('game did not submit a frame');
      return JSON.stringify(recording.last, (_key, value: unknown) =>
        ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value);
    });
    const frame = expandForFlutter(JSON.parse(raw) as FrameDescription);
    const allGeometries: Record<string, unknown> = {};
    const nodes = frame.nodes.map((node) => {
      if (node.kind !== 'mesh' && node.kind !== 'instances' && node.kind !== 'points') return node;
      const geometry = { attributes: node.attributes, indices: node.indices };
      const id = createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
      allGeometries[id] = geometry;
      const rest = { ...node };
      delete rest.attributes;
      delete rest.indices;
      return { ...rest, geometryId: id };
    });
    for (const client of server.clients) {
      if (client.readyState !== 1) continue;
      const known = sentGeometry.get(client) ?? new Set<string>();
      sentGeometry.set(client, known);
      const geometries: Record<string, unknown> = {};
      for (const [id, geometry] of Object.entries(allGeometries)) {
        if (known.has(id)) continue;
        geometries[id] = geometry;
        known.add(id);
      }
      const payload = JSON.stringify({ frame: { ...frame, nodes }, geometries }, (_key, value: unknown) =>
      ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value);
      client.send(gzipSync(payload, { level: 1 }));
    }
  } catch (error) {
    console.error('scene feed:', error);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
}
