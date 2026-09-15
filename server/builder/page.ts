import { createReadStream, readFileSync, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
import { build } from 'vite';

/** The URL is owned by the portal; the worker secret never crosses into this page. */
export const BUILDER_PAGE_BASE = '/tools/build/page/';

/**
 * Build the page with the dependencies and model files in the worker's checkout.
 *
 * This is deliberately a production build rather than a Vite server behind a proxy. A static
 * directory has no module graph, source-file route or HMR socket to secure, and the build finishing
 * is a useful definition of when an edit is ready to show. Its few compile-time values are read
 * explicitly from the worktree so loading a config from the process's checkout cannot mix revisions.
 */
export async function buildBuilderPage(worktree: string, out: string): Promise<void> {
  const pkg = JSON.parse(readFileSync(resolve(worktree, 'package.json'), 'utf8')) as { version: string };
  await build({
    root: worktree,
    // The normal config opens development command routes. None belongs in a static production
    // build, and reading it would also read package.json relative to the worker process rather than
    // relative to this worktree. Naming the small build here keeps every input in one revision.
    configFile: false,
    base: BUILDER_PAGE_BASE,
    define: {
      __GAME_NAME__: JSON.stringify('AI World'),
      __GAME_VERSION__: JSON.stringify(pkg.version),
      __BUILT_ON__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: {
      outDir: out,
      emptyOutDir: true,
      target: 'es2022',
      rollupOptions: { input: resolve(worktree, 'tools/character-builder.html') },
    },
  });
}

const TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const suffixOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
};

/**
 * Serve one file from completed builds, never from the worktree.
 *
 * Old builds stay readable for the worker's lifetime because an open page can ask for its hashed
 * JavaScript a moment after a new build becomes current. Current first means the stable HTML name
 * always opens the newest revision, while a hash from the previous page does not race deletion.
 */
export async function serveBuilderPage(
  roots: readonly string[], asked: string, res: ServerResponse,
): Promise<boolean> {
  let relative: string;
  try { relative = decodeURIComponent(asked); } catch { return false; }
  if (!relative || relative.includes('\0') || relative.split('/').some((part) => part === '..')) return false;

  for (const root of roots) {
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${sep}`)) continue;
    let info: Stats;
    try { info = await stat(file); } catch { continue; }
    if (!info.isFile()) continue;
    res.writeHead(200, {
      'content-type': TYPES[suffixOf(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(file).pipe(res);
    return true;
  }
  return false;
}
