import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { commandChannel } from './tools/commandchannel.ts';

/**
 * What the game is called, what version it is, and when it was built.
 *
 * Baked in at build time rather than fetched, because a page that has to ask the network what
 * version it is cannot tell you when the network is the thing that is wrong — and "which version
 * am I actually looking at" is the first question asked of a deployment that has just been
 * released. The version comes from the package, which `chore release` moves along with the chart,
 * so the number on the title screen is the number of the image that is serving it.
 */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; version: string };
const BUILD = {
  __GAME_NAME__: JSON.stringify('AI World'),
  __GAME_VERSION__: JSON.stringify(pkg.version),
  __BUILT_ON__: JSON.stringify(new Date().toISOString().slice(0, 10)),
};

/**
 * Where the built page will be served from. GitHub Pages puts it under /ai.world/; a world server
 * on your own network serves it at the root, and says so by setting BASE=/ when it builds. Dev is
 * always the root.
 */
export default defineConfig(({ command }) => ({
  /**
   * The development door for commands: post one to /__command and every open tab runs it. The
   * plugin itself is `apply: 'serve'`, so it does nothing during a build — but the config is
   * bundled before it is read, and a bundler resolves an import whether or not the thing it names
   * will ever run. That is why the image has to carry `tools/` even though it never serves.
   */
  plugins: [commandChannel()],
  define: BUILD,
  base: process.env.BASE ?? (command === 'build' ? '/ai.world/' : '/'),
  /**
   * The dev server, pinned.
   *
   * Vite's default is 5173 and it quietly steps to the next free port when that is taken. On this
   * machine 5173 belongs to a QEMU VM, which accepts the connection and then serves nothing at
   * all — so a browser pointed there reports "can't reach this page" while a perfectly healthy
   * game sits on some other number that changed between runs. A fixed port is a bookmark that
   * keeps working; `strictPort` makes a clash fail loudly here rather than silently moving the
   * game somewhere nobody is looking.
   *
   * `host` so it answers on IPv4 as well as IPv6: bound to [::1] alone, a browser that resolves
   * localhost to 127.0.0.1 finds nothing there either.
   */
  server: { port: 5174, strictPort: true, host: true },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  /**
   * Sixty seconds a test, not vitest's five.
   *
   * A good part of this suite proves things by sweeping the world rather than by repeating the
   * arithmetic that built it: growing twenty complete worlds to check that no sky village stands
   * its eagles in the sea, or walking half a million points through the shadow box to check that
   * none of them is cut off. They take seconds by their nature, and a CI runner sharing a core is
   * two or three times slower again — so five seconds failed them on time rather than on any
   * assertion, and which one failed moved around depending on what else was running.
   *
   * Sixty turned out not to be that number, and the way it failed is worth writing down because it
   * looked exactly like a bug in the world. Five different tests failed a full run and passed on
   * their own, always with `Test timed out`, never with a disagreement — and which five it was moved
   * around from run to run. The cause was outside this repo entirely: another project's Rust build
   * was holding most of the machine, and a suite that spawns one worker per file was asking for
   * eleven of them at once on the cores that were left.
   *
   * So two changes, and they answer different halves of it.
   *
   * `maxWorkers` stops the suite being its own worst enemy. Half the machine runs it in the same
   * wall-clock time as all of the machine — measured, sixty-five seconds against seventy-nine — 
   * because past a point the workers are only queueing behind each other, and the half left over is
   * what the rest of the machine was going to take anyway.
   *
   * `isolate: false` reuses a worker across files instead of standing up a fresh environment for
   * each of the hundred and thirty-six. That is where the rest of the saving is: half a second of
   * startup apiece, paid a hundred and thirty-six times. It is safe here because nothing in this
   * suite leaves state behind that another file could read — the caches that do exist are keyed by
   * the seed or the country they belong to — and it is the first thing to turn off if a test ever
   * starts passing alone and failing in company, which is the exact shape of that fault.
   *
   * And the budget itself doubles. Two minutes is a number only a genuine hang reaches; the suite
   * finishes in about a minute when the machine is free, and in two when it is not. A budget that a
   * busy machine can trip is not measuring the code, and a suite that cries wolf is a suite people
   * stop reading.
   */
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tools/**/*.test.ts'],
    testTimeout: 120_000,
    maxWorkers: '50%',
    isolate: false,
  },
}));
