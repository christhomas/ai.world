import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Vault } from './vault';

/**
 * A vault made of files, which is what a server has and a browser does not.
 *
 * This is the only place in the world's own code that knows what a filesystem is. Everything else
 * — the clock, the market, the post shelf, the log of what players changed — hands a string to a
 * vault and asks for one back, which is what lets the same simulation run in a Web Worker beside a
 * game somebody is playing alone. See `docs/server-authority.md`.
 */
export class FileVault implements Vault {
  read(name: string): string | null {
    try {
      return readFileSync(name, 'utf8');
    } catch {
      return null;    // nothing kept under that name yet, or something unreadable
    }
  }

  write(name: string, text: string): void {
    mkdirSync(dirname(name), { recursive: true });
    writeFileSync(name, text);
  }
}
