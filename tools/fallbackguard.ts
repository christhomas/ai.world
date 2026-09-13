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
 * The paths in `git status --porcelain -z`, whole.
 *
 * NUL-delimited rather than by line, because git quotes a path with a space in it when it writes
 * lines and does not when it writes records — so the line form has to be un-quoted, and getting
 * that wrong turns a real file into a path that does not exist. The record form has no quoting and
 * no ambiguity.
 *
 * A record is two status columns, a space, then the path. A rename carries a second record holding
 * where the file came from, and both ends of it have to go back, so both are returned.
 */
export function whatIsDirty(porcelain: string): string[] {
  const records = porcelain.split('\0').filter((r) => r.length > 0);
  const paths: string[] = [];
  for (let at = 0; at < records.length; at++) {
    const status = records[at].slice(0, 2);
    paths.push(records[at].slice(3));
    // a rename or a copy says where it came from in the record after it, with no status of its own
    if (status.includes('R') || status.includes('C')) {
      at++;
      if (at < records.length) paths.push(records[at]);
    }
  }
  return paths;
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
