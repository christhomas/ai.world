import { build } from 'vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run before Flutter packaging. No generated engine is checked in or fetched by the installed app.
const outDir = resolve('client/flutter/assets/engine');
await build({ configFile: false, build: { target: 'es2022', outDir, emptyOutDir: false, minify: false,
  lib: { entry: resolve('src/game/mobile-state-engine.ts'), name: 'AiWorldStateEngine', formats: ['iife'], fileName: () => 'engine.js' },
} });
const source = await readFile(resolve(outDir, 'engine.js'));
await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify({ contractVersion: 1,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  bundleSha256: createHash('sha256').update(source).digest('hex'), scope: 'hero-state',
}, null, 2) + '\n');
