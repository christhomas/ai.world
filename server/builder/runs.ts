import type { ServerResponse } from 'node:http';

/**
 * One question and everything said in answer to it, kept on this side rather than in the page.
 *
 * The dev server discovered why this has to be here: Claude edits a model file, the page reloads,
 * *"and a reply being streamed into that page dies with it, half way through, along with the
 * process producing it"*. So the run belongs to the server and the page follows it — and a page
 * that has just been reloaded out from under itself asks to follow again from the beginning.
 *
 * Through a portal it matters more, not less. A reload here is a browser on somebody else's desk
 * on the other side of a proxy, and the run is twenty minutes of somebody's afternoon.
 */

/** What a follower is told, as newline-delimited JSON. Three shapes and no more. */
export type Told =
  | { k: 'say'; text: string }
  | { k: 'tool'; name: string; on: string }
  | { k: 'end'; ok: boolean; note: string };

/** A run, as the thing holding it sees it. */
export interface Run {
  id: string;
  who: string;
  about: string;
  told: Told[];
  done: boolean;
  /** Everyone currently reading it. A reload leaves one behind and adds another. */
  following: Set<ServerResponse>;
}

/**
 * The run in hand and the one before it, and everybody reading either.
 *
 * One at a time by construction — see `OneAtATime` — so this holds the current run and keeps the
 * last finished one so that a page reloaded after the end still shows what came back. Nothing
 * older: a transcript is worth having for as long as somebody might still be looking at it, and
 * a server that kept every run would be keeping every prompt anybody ever ran.
 */
export class Runs {
  private current: Run | null = null;
  private previous: Run | null = null;

  /** The run with this id, current or just finished, or nothing. */
  find(id: string): Run | null {
    if (this.current?.id === id) return this.current;
    if (this.previous?.id === id) return this.previous;
    return null;
  }

  /** The run in hand, finished or not. What a page with no id of its own asks for. */
  get latest(): Run | null { return this.current ?? this.previous; }

  /** Begin one. The one before last is dropped, along with anybody still reading it. */
  begin(id: string, who: string, about: string): Run {
    if (this.previous) for (const res of this.previous.following) res.end();
    this.previous = this.current;
    this.current = { id, who, about, told: [], done: false, following: new Set() };
    return this.current;
  }

  /** Say something to everybody following this run, and keep it for whoever follows later. */
  tell(run: Run, told: Told): void {
    run.told.push(told);
    const line = `${JSON.stringify(told)}\n`;
    for (const res of run.following) res.write(line);
  }

  /**
   * End it, once.
   *
   * Twice is the ordinary case rather than the exception — a process that fails emits an error and
   * then closes — and an end told twice is a page that thinks two runs happened.
   */
  finish(run: Run, ok: boolean, note: string): void {
    if (run.done) return;
    run.done = true;
    this.tell(run, { k: 'end', ok, note });
    for (const res of run.following) res.end();
    run.following.clear();
  }

  /**
   * Send a reader everything already said, then keep sending as more is said.
   *
   * `from` is how a reloaded page picks up where it left off, and it is the page's own count rather
   * than a cursor this hands out: a page that asks for everything from zero gets the transcript
   * from the top, which is exactly what a page that has just been reloaded wants.
   */
  follow(run: Run | null, res: ServerResponse, from: number): void {
    res.setHeader('content-type', 'application/x-ndjson');
    res.setHeader('cache-control', 'no-store');
    // a page opened through a proxy would otherwise sit on an empty screen until the whole answer
    // had arrived, which is exactly what this is not for
    res.setHeader('x-accel-buffering', 'no');
    if (!run) { res.end(); return; }
    for (const told of run.told.slice(Math.max(0, from))) res.write(`${JSON.stringify(told)}\n`);
    if (run.done) { res.end(); return; }
    run.following.add(res);
    res.on('close', () => { run.following.delete(res); });
  }
}
