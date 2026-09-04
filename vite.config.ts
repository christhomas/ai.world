import { defineConfig } from 'vite';

/**
 * Where the built page will be served from. GitHub Pages puts it under /ai.world/; a world server
 * on your own network serves it at the root, and says so by setting BASE=/ when it builds. Dev is
 * always the root.
 */
export default defineConfig(({ command }) => ({
  base: process.env.BASE ?? (command === 'build' ? '/ai.world/' : '/'),
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tools/**/*.test.ts'] },
}));
