import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Handing out the game itself, alongside the world it plays in.
 *
 * The reason this exists is a browser rule rather than a feature: a page served over https may not
 * open a plain ws:// socket, so a world server on a home network is unreachable from the published
 * site. Serve the built page from the same box and the same port, and the problem is gone — the
 * page is http, the socket is ws, they share an origin, and the client works out its own server
 * address from the address bar without anybody typing anything.
 *
 * It is a few hundred bytes of file serving, on purpose. Anything that needs caching, compression
 * or ranges should sit behind a real web server; this is for a Raspberry Pi on a kitchen shelf.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * A handler that serves files from `root`, or null when there is nothing there to serve — in
 * which case the caller keeps its plain status page.
 */
export function staticFiles(root: string): ((req: IncomingMessage, res: ServerResponse) => boolean) | null {
  const base = resolve(root);
  try {
    if (!statSync(join(base, 'index.html')).isFile()) return null;
  } catch {
    return null;   // nothing built yet, which is normal for a server that only serves worlds
  }

  return (req, res) => {
    const asked = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const wanted = asked === '/' || asked.endsWith('/') ? join(asked, 'index.html') : asked;
    // a path may not climb out of the directory it is served from, whatever it says
    const path = join(base, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(base + sep) && path !== base) return false;

    try {
      if (!statSync(path).isFile()) return false;
    } catch {
      return false;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
    return true;
  };
}
