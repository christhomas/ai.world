import { build } from 'vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run before Flutter packaging. No generated engine is checked in or fetched by the installed app.
const outDir = resolve('client/flutter/assets/engine');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));

/** One bundle, built as an IIFE the native VM evaluates, and the manifest that pins it. */
async function bundle(entry, global, file, manifest, scope) {
  await build({ configFile: false, logLevel: 'warn',
    define: { __GAME_NAME__: JSON.stringify('AI World'), __GAME_VERSION__: JSON.stringify(pkg.version) },
    build: { target: 'es2022', outDir, emptyOutDir: false, minify: false,
      lib: { entry: resolve(entry), name: global, formats: ['iife'], fileName: () => file },
    } });
  const source = await readFile(resolve(outDir, file));
  await writeFile(resolve(outDir, manifest), JSON.stringify({ contractVersion: 1, sourceSha,
    bundleSha256: createHash('sha256').update(source).digest('hex'), scope,
  }, null, 2) + '\n');
  console.log(`${file}: ${(source.length / 1024 / 1024).toFixed(2)} MiB, ${scope}`);
}

// the hero alone, which the installed checkpoint proofs run
await bundle('src/game/mobile-state-engine.ts', 'AiWorldStateEngine', 'engine.js', 'manifest.json', 'hero-state');
// and the whole shared game (#563)
await bundle('src/mobile/game-engine.ts', 'AiWorldGameEngine', 'game.js', 'game-manifest.json', 'game');
// The ground and country CPU jobs share a second context on their own native thread (#559).
await bundle('src/mobile/job-engine.ts', 'AiWorldJobEngine', 'jobs.js', 'jobs-manifest.json', 'jobs');
