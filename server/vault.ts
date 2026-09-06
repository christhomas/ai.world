/**
 * Where a world is kept between one visit and the next.
 *
 * The simulation is going to run in two places — on a server, and in a Web Worker beside the game
 * for somebody playing alone (`docs/server-authority.md`) — and the one thing those two do not
 * share is a filesystem. So the world knows how to *be* saved and nothing about where: it hands a
 * string to a vault and asks for one back, and what a vault does with it is the host's business.
 *
 * Deliberately synchronous and deliberately string-shaped. The world saves a few kilobytes of JSON
 * every couple of seconds at most; anything asynchronous here would spread promises through code
 * that has no other reason to have them, to save a cost nobody can measure.
 */
export interface Vault {
  /** What was kept under this name, or null if nothing was. */
  read(name: string): string | null;
  write(name: string, text: string): void;
}

/**
 * A vault that forgets.
 *
 * What a Worker uses until it is given somewhere to put things, and what a test uses so that a
 * world in one test is not a world in the next. Worth having by name rather than passing `null`
 * around: a world that is not saved anywhere is a decision, not a missing argument.
 */
export class Forgetful implements Vault {
  private readonly kept = new Map<string, string>();

  read(name: string): string | null {
    return this.kept.get(name) ?? null;
  }

  write(name: string, text: string): void {
    this.kept.set(name, text);
  }
}
