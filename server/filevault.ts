import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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

  /**
   * Written beside and then moved into place, so a file is never half of itself.
   *
   * `writeFileSync` on top of an existing file truncates it and then fills it. A process killed
   * between those two — a container restart, a machine losing power — leaves a file that exists,
   * is the right name, and contains the first part of a JSON document. Everything that reads it
   * afterwards sees a parse error where a world used to be.
   *
   * A rename within one directory is atomic on every filesystem this runs on: the name points at
   * the old bytes or the new ones and never at half of either. The temporary file carries the
   * process id so two writers cannot collide on it, and is cleaned up if the move fails.
   */
  write(name: string, text: string): void {
    mkdirSync(dirname(name), { recursive: true });
    const beside = `${name}.${process.pid}.writing`;
    try {
      writeFileSync(beside, text);
      renameSync(beside, name);
    } catch (why) {
      try { unlinkSync(beside); } catch { /* it was never written, which is the ordinary case */ }
      throw why;
    }
  }
}
