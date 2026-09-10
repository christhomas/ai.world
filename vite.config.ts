import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { askClaude } from './tools/askclaude.ts';
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
  /**
   * And the door for asking Claude: post a prompt to /__ask and the character builder watches the
   * answer arrive. Reached through a gateway rather than from this machine? `ASK_FROM` invites the
   * gateway's address, and `ALLOWED_HOSTS` tells the server the name it is being asked for. Both plugins are `apply: 'serve'`, so neither exists in a built game — which
   * matters more for this one, because it runs a command with text from a page. What holds that
   * where it is, and why it is acceptable at all, is written at the top of `tools/askclaude.ts`.
   */
  plugins: [commandChannel(), askClaude()],
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
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    /*
     * And which names it will answer to, for a dev server reached through a gateway.
     *
     * Vite refuses a request whose `Host` is a name it has not been told about — a DNS-rebinding
     * guard, and a good one — which means a dev server behind a reverse proxy on somebody's own
     * network answers "Blocked request" to its owner. The names are given from outside rather than
     * written here, because they are a fact about one person's network and not about this game:
     *
     *     ALLOWED_HOSTS=s1.example.com chore dev
     *
     * Nothing by default, so a plain `chore dev` is the same server it has always been. Naming
     * hosts is also not, on its own, a way in to anything: `/__ask` still answers only this machine
     * and whoever `ASK_FROM` invites by address — see `tools/askclaude.ts`.
     */
    allowedHosts: (process.env.ALLOWED_HOSTS ?? '').split(',').map((one) => one.trim()).filter(Boolean),
  },
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
    /*
     * Half the machine, unless somebody says otherwise — and there is a good reason to.
     *
     * `50%` is right for one suite on an idle desk and wrong the moment several are running at
     * once, because each of them asks for half of the *whole* machine rather than half of what is
     * left. Worse than that on this machine, and the detail matters: an M3 Pro's twelve cores are
     * six performance and six efficiency, so half of twelve was never six equal workers — the
     * second three run on the slow half, and a suite budgeted against the fast half is already
     * being optimistic before anybody else shows up.
     *
     * Measured while four agents were each running the full suite: ten vitest processes, six
     * workers apiece, a load average of two hundred and eighty-nine, and a headless playtest that
     * failed three checks purely on starvation — creature drift at 1.35 tiles against a limit of
     * 0.35, nineteen swings to land one blow, a door that never opened. Every one of those reads
     * as a bug in the game and none of them was, which is the expensive part: a starved
     * measurement does not look starved, it looks broken.
     *
     * So the share is a number anybody can turn down from outside: `VITEST_WORKERS=2 chore test`
     * when the machine is shared. It stays at half by default because the common case is still one
     * person running one suite, and that case should not have to know this exists.
     */
    maxWorkers: process.env.VITEST_WORKERS ?? '50%',
    isolate: false,
  },
}));
