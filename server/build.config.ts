import { defineConfig } from 'vite';

/**
 * How the world server becomes one file to ship.
 *
 * The page has its own build; this one exists because the server is deployed as a container and
 * an image should carry what runs, not what builds. Rolling `server/` into a single module leaves
 * an image with no compiler, no TypeScript and no toolchain in it — node reads one file and
 * listens. `ws` stays outside the bundle because it is the only runtime dependency the server
 * has, and it has none of its own, so copying it is a directory rather than a dependency tree.
 *
 * Run from the repository root: `pnpm vite build --config server/build.config.ts`.
 */

/** Matches the node the image and the deploy workflow both run. */
const NODE_TARGET = 'node22';
/** `.mjs` says "modules" without a package.json beside it, which the runtime image does not have. */
const BUNDLE_NAME = 'server.mjs';

export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    outDir: 'server/dist',
    emptyOutDir: true,
    target: NODE_TARGET,
    rollupOptions: { output: { entryFileNames: BUNDLE_NAME } },
  },
});
