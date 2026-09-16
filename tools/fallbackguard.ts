/**
 * The two rules that stand between a codemod and somebody's afternoon.
 *
 * `chore fallbacks` rewrites every `??` in the repository, runs the suite, and puts the files back
 * with `git checkout -- src server`. That is a destructive command aimed at a whole tree, and
 * everything about *when* it may fire and *what* it is told is dirty lives here, on its own, where
 * it can be tested — the sweep itself ends in a `main()` call and cannot be imported without
 * running.
 *
 * Both rules exist because of the same review finding, made three times over: the recovery could
 * discard work that was never the sweep's.
 */

/**
 * One dirty file, and *how* it is dirty.
 *
 * The status is carried rather than thrown away because a caller that only has the path can answer
 * "is this file dirty" and nothing else — and at least one caller needs more than that. `chore
 * tree` used to excuse `sanity-report.txt` on the grounds that a bench rewrites it every run — every
 * report now goes to the gitignored `docs/reports/` and there is nothing to excuse, which is
 * true of an unstaged worktree modification and of nothing else somebody might do to that file.
 * See `worthStopping` in `sharedtree.ts`.
 */
export interface Dirty {
  /** The two porcelain columns, index then worktree: `' M'`, `'M '`, `'MM'`, `'??'`, `'R '`. */
  status: string;
  path: string;
}

/**
 * What `git status --porcelain -z` says is dirty, whole paths and their statuses.
 *
 * NUL-delimited rather than by line, because git quotes a path with a space in it when it writes
 * lines and does not when it writes records — so the line form has to be un-quoted, and getting
 * that wrong turns a real file into a path that does not exist. The record form has no quoting and
 * no ambiguity.
 *
 * A record is two status columns, a space, then the path. A rename carries a second record holding
 * where the file came from, and both ends of it have to go back, so both are returned — the far end
 * under the rename's own status, since the porcelain gives it none and a caller asking how it is
 * dirty would otherwise be told nothing.
 */
export function whatIsDirty(porcelain: string): Dirty[] {
  const records = porcelain.split('\0').filter((r) => r.length > 0);
  const dirty: Dirty[] = [];
  for (let at = 0; at < records.length; at++) {
    const status = records[at].slice(0, 2);
    dirty.push({ status, path: records[at].slice(3) });
    // a rename or a copy says where it came from in the record after it, with no status of its own
    if (status.includes('R') || status.includes('C')) {
      at++;
      if (at < records.length) dirty.push({ status, path: records[at] });
    }
  }
  return dirty;
}

/** What a signal handler is allowed to do, and when. */
export interface TidyUp {
  /** The sweep has begun writing to the tree: from here a signal must put it back. */
  own(): void;
  /** It has put everything back by itself: from here a signal must leave the tree alone. */
  finished(): void;
  /** A signal arrived. Returns whether anything was put back. */
  signalled(): boolean;
}

/**
 * Whether the sweep owns the working tree yet.
 *
 * The handlers used to be installed as the program loaded, which is before it has looked at the
 * tree at all — so a Ctrl-C during the opening `git status`, on a checkout full of somebody's
 * uncommitted work, ran `git checkout -- src server` and threw it away. The sweep had not written a
 * single byte and it cleaned up after itself anyway.
 *
 * So the handler is armed by the sweep at the moment it starts writing and disarmed the moment it
 * has finished putting things back, and outside that window it does nothing at all. It stays a
 * best effort even inside it: `timeout` and a shell's Ctrl-C signal the whole process group, so the
 * `git checkout` this would spawn is killed at the same instant as the node that spawns it. The
 * recovery that can be relied on is the one on the way *in*, on the next run.
 */
export function theTidyUp(putBack: () => void): TidyUp {
  let ours = false;
  return {
    own(): void { ours = true; },
    finished(): void { ours = false; },
    signalled(): boolean {
      if (!ours) return false;
      ours = false;
      putBack();
      return true;
    },
  };
}
