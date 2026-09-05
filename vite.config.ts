import { defineConfig } from 'vite';

/**
 * Where the built page will be served from. GitHub Pages puts it under /ai.world/; a world server
 * on your own network serves it at the root, and says so by setting BASE=/ when it builds. Dev is
 * always the root.
 */
export default defineConfig(({ command }) => ({
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
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tools/**/*.test.ts'] },
}));
