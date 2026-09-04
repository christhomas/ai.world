import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subject } from './subject';

/**
 * Getting hold of another version of the art to compare against.
 *
 * Two kinds are useful and they want different machinery. The last commit is the honest answer to
 * "what does this look like now, before I touched it", and it covers changes to the drawing code
 * as well as to the colours — so it is fetched with a throwaway git worktree, which is the only
 * way to get the old code as code. A candidate is a proposal you want to keep around unapproved,
 * so it is a folder of replacement files overlaid on a copy of the working tree.
 *
 * Both hand back a directory that a Subject can be pointed at, and a way to throw it away.
 */

export interface Version {
  /** What to call it on the sheet. */
  label: string;
  /** A directory laid out like the repo, to render from. */
  root: string;
  /** Delete whatever was made to produce it. */
  done(): void;
}

/** Where a proposal lives before it is accepted: art/candidates/<name>/, mirroring repo paths. */
export const CANDIDATES = 'art/candidates';

/** The working tree itself, which needs no preparation. */
export function working(repo: string): Version {
  return { label: 'working', root: repo, done: () => {} };
}

/**
 * The art as it is committed. A detached worktree is used rather than `git show`, because the
 * artwork is several files that import each other and one of them alone will not run.
 */
export function committed(repo: string, at = 'HEAD'): Version {
  const root = mkdtempSync(join(tmpdir(), 'aiworld-art-'));
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', root, at], { cwd: repo });
  return {
    label: at === 'HEAD' ? 'committed' : at,
    root,
    done: () => {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: repo });
      } catch {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

/** A proposal: the working tree with the candidate's files laid over the top of it. */
export function candidate(repo: string, name: string, subject: Subject): Version {
  const from = resolve(repo, CANDIDATES, name);
  if (!existsSync(from)) throw new Error(`no candidate called "${name}" — looked in ${CANDIDATES}/${name}`);

  const root = mkdtempSync(join(tmpdir(), `aiworld-try-${name}-`));
  cpSync(join(repo, 'src'), join(root, 'src'), { recursive: true });

  let laid = 0;
  for (const file of subject.files) {
    const proposed = join(from, file);
    if (!existsSync(proposed)) continue;
    cpSync(proposed, join(root, file));
    laid++;
  }
  if (laid === 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`"${name}" has none of the files ${subject.name} is made of: ${subject.files.join(', ')}`);
  }
  return { label: name, root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Which of a subject's files a candidate actually replaces, for reporting and for approving. */
export function filesOf(repo: string, name: string, subject: Subject): string[] {
  const from = resolve(repo, CANDIDATES, name);
  return subject.files.filter((file) => existsSync(join(from, file)));
}
