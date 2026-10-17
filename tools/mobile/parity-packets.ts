/*
 * The frames `shots.cjs` kept in PARITY mode, as the packets both phones replay and the web
 * pictures their read-back targets are compared with (#569).
 *
 *   pnpm exec tsx tools/mobile/parity-packets.ts <kept> <out>
 *
 * Each `<kept>/<scene>.frame.json` becomes `<out>/<scene>.json`, the exact packet the Flutter feed
 * sends, and its canvas `<kept>/<scene>-web.png` goes to `<out>/web/<scene>.png`. `web/manifest.json`
 * says what each scene holds and the render time it was drawn at, which the native replay draws it
 * at too.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameDescription } from '../../src/core/scene';
import { disposeFlutterFrameGeometry } from '../../src/render/flutter-frame';
import { flutterPacket, plainArrays } from '../../server/flutter-packet';

const LIGHTS = new Set(['ambient', 'hemisphere', 'directional', 'point']);
const [kept, out] = process.argv.slice(2);
if (!kept || !out) throw new Error('usage: parity-packets.ts <kept frames> <out>');
mkdirSync(join(out, 'web'), { recursive: true });

const scenes = [];
for (const file of readdirSync(kept).filter((name) => name.endsWith('.frame.json')).sort()) {
  const name = file.slice(0, -'.frame.json'.length);
  const frame = JSON.parse(readFileSync(join(kept, file), 'utf8')) as FrameDescription;
  const packet = flutterPacket(frame);
  const kinds: Record<string, number> = {};
  for (const node of packet.frame.nodes) kinds[String(node.kind)] = (kinds[String(node.kind)] ?? 0) + 1;
  const lights = Object.entries(kinds).filter(([kind]) => LIGHTS.has(kind)).reduce((n, [, count]) => n + count, 0);
  if (!lights || !((kinds.mesh ?? 0) + (kinds.instances ?? 0))) {
    throw new Error(`${name}: the kept frame has no lights or nothing to draw: ${JSON.stringify(kinds)}`);
  }
  if (typeof frame.renderTimeMs !== 'number') throw new Error(`${name}: the kept frame has no render time`);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(packet, plainArrays));
  copyFileSync(join(kept, `${name}-web.png`), join(out, 'web', `${name}.png`));
  scenes.push({
    name, renderTimeMs: frame.renderTimeMs, background: frame.background, kinds, lights,
    water: frame.nodes.some((node) => node.material?.intent === 'water'),
    coast: frame.coast ? frame.coast.size : null,
  });
  console.log(`${name}: ${JSON.stringify(kinds)} at ${frame.renderTimeMs} ms`);
}
if (!scenes.length) throw new Error(`no kept frames in ${kept}`);
writeFileSync(join(out, 'web', 'manifest.json'), JSON.stringify(scenes, null, 2) + '\n');
disposeFlutterFrameGeometry();
