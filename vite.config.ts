import { defineConfig } from 'vite';

// GitHub Pages serves from /ai.world/; local dev serves from /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/ai.world/' : '/',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
}));
