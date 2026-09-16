# Landing the queue

How a session takes over the open pull requests and gets them into `main`. Written from actually
running it against a dozen open PRs at once, several of them stale from an earlier attempt that ran
out of quota mid-work. Where this disagrees with a habit, this is what happened.

**Update this file when the process changes.** A pipeline document that is out of date is worse than
none, because somebody follows it.

## The boundary, the other way round

`docs/issue-pipeline.md` is written for a session doing feature work, and it draws its boundary on
purpose: that session branches, fixes, opens a pull request, and stops — it never merges, tags,
releases, or touches `main`, because a session merging its own work has removed the review it was
asking for.

This document is for the other session: the one whose whole job *is* the merge. Nothing here
contradicts that boundary — it is what sits on the far side of it. If you are not sure which session
you are, ask; do not assume you may merge because this file exists.

## Before anything

**Assume you are not the only thing moving `main`.** Other sessions and the repository's own
automation land work concurrently. A branch you rebased and pushed ten minutes ago can be behind
again by the time you come back to it, and a plain `git push` on a branch you already pushed can be
rejected as non-fast-forward because something else advanced it in between — including a branch of
your own that another process rebased for you while you were elsewhere. Re-fetch before you trust
what "behind" or "conflicting" meant a few minutes ago; do not fight a rejected push with `--force`,
rebase onto whatever is there now and push `--force-with-lease` again.

**List every open PR, oldest first**, by `createdAt`:

    gh pr list --state open --json number,title,createdAt,mergeStateStatus,mergeable,statusCheckRollup

Note, for each: whether it is `BEHIND` (a plain rebase will do), `CONFLICTING`/`DIRTY` (a rebase
will hit real conflicts), and whether any check is currently failing.

## Working the queue

Go oldest first, but "oldest first" governs the order you *give attention to* PRs, not a lock that
makes every later PR wait on an earlier one. These PRs are not stacked on each other — each targets
`main` directly — so there is no correctness reason to hold a ready PR back behind a slower one.  In
practice this looks like a pipeline rather than a strict sequence:

1. **Pick the oldest untouched PR.** Rebase it onto the current `origin/main` in a scratch worktree
   (see below). If that's a clean rebase with checks already green, push and let CI run.
2. **While its checks run, move to the next-oldest** and do the same: rebase, and either push a
   clean result or start resolving what's blocking it.
3. **Merge each PR the moment it is actually green and mergeable** — don't wait for an older sibling
   still stuck on a real conflict or a genuine test failure. Do check back on it periodically rather
   than forgetting it once something harder has your attention.
4. Repeat until the queue is empty. After landing a batch, see "Releasing" below.

### Work in a scratch worktree, never the session's own

Never `git checkout` another branch inside the worktree you were launched in — that is another
session's (or your own outer loop's) working state. For every PR, use its own existing worktree if
the repository already has one checked out to that branch, or add a throwaway one:

    git worktree add /tmp/pr-<number> origin/<branch> --detach
    git -C /tmp/pr-<number> checkout -B <branch> origin/<branch>

Check `git worktree list` first. Earlier sessions often leave worktrees and local branches behind,
sometimes several divergent ones tracking the same PR branch (a `repair-*` or `restack-*` branch
next to the PR's own branch name, at different points in a stalled rebase). Treat every one of these
as a *candidate*, not ground truth:

- Check `git status --short` — if it's dirty, that's somebody's unfinished work; don't discard it
  without understanding it.
- Compare commit-by-commit against both the PR's current origin branch and current `origin/main`.
  A commit that looks newer or "further along" is not necessarily further along — it can be an
  abandoned side-attempt. Read the actual diff before trusting it.
- It is often *faster and safer to start clean* from `origin/<branch>` than to untangle a stale WIP
  branch — only keep WIP that you've actually verified represents real, still-relevant progress.

### Rebasing

    git fetch origin main
    git rebase origin/main

If it's clean, push (`--force-with-lease`, always — you are rewriting history other tooling may also
have touched) and move on.

If it conflicts, **read both sides before resolving** — do not reflexively take "ours" or "theirs".
A large share of the conflicts encountered here were not real disagreements: the PR branch was simply
behind a `main` that had already fixed the same thing (an export wired or deleted, a ratchet count
lowered, a stale issue reference cleaned up). Check what `origin/main` currently has at that spot
before deciding — often the correct resolution is to take `main`'s side entirely and discard the
PR branch's now-stale copy.

A PR whose *checks* are currently failing is frequently explained by the same thing: it is failing
on an old snapshot of `main` that has since been fixed elsewhere, and a plain rebase (no code change
at all) makes it pass. Rebase first, look at whether the failure is still reproducible, and only then
go hunting for an actual bug in the PR's own diff.

### When a PR needs real fixing, not just a rebase

Some PRs need genuine judgement: a feature-level conflict where both sides changed the same code for
different reasons, or a CI failure that survives a clean rebase. Don't rush these to look decisive —
either work them carefully yourself, or hand the PR to a background agent with:

- the PR number, branch, and what its body says it's for;
- the specific failing check output, verbatim;
- every candidate stale worktree/branch you found for it, and what you already ruled out;
- the instruction to actually run `pnpm exec tsc --noEmit` and `npx vitest run` locally before
  pushing, and to treat GitHub's own checks as the final word, not the local run;
- an explicit "do not touch any other open PR" boundary, since several of these run concurrently.

Keep working the rest of the queue while it runs. Don't let a hard PR block the whole session.

### Merging

This repository has squash-merge only enabled. Once a PR is green and `mergeable: MERGEABLE` /
`mergeStateStatus` isn't `BEHIND`/`DIRTY`/`BLOCKED`:

    gh pr merge <number> --squash

Re-check merge state immediately before merging, not just when you started working the PR — see
"before anything" above about concurrent activity moving `main` underneath you.

## While the pipeline is going green

**This section applies only if you hold the issue role as well.** If you are the merge session and
somebody else is working issues, stop here: the sections above are your whole job, and picking up
feature work would be the boundary going the other way. If you are not sure which you are, ask.

A required check takes minutes. Watching one is the largest waste in this pipeline, because nothing
about a green tick is improved by being observed, and a session that merges a PR and then waits has
chosen to do nothing for ten minutes at a time.

So the wait is where the next issue becomes the next pull request. Take the oldest unblocked issue,
branch, write the failing test, watch it fail, make it pass, open the request. Then come back.

**Every time you come back, ask the queue before you ask the work.** If the oldest request — or the
one everything else is stacked on — has gone green while you were elsewhere, merge that before you
touch anything else. A merged request unblocks other people and shortens the queue; one sitting
behind a finished check is pure latency, and latency compounds when six are waiting on it.

The loop is: **merge what is ready, start what is next, return when the next check lands.** The
queue grows during the wait rather than the wait being dead time.

Two things this is not. It is not a licence to have six branches half-written at once — one issue in
hand at a time, taken to a request before the next is started, or you are not pipelining, you are
context-switching. And it is not a reason to merge something early: a check that has not finished is
not a check that has passed, and the ordering rule above says merge what is *ready*, not what is
nearly ready.

## Releasing

Cutting a release (`docs/releasing.md`) is the natural next step after landing a batch from this
queue, not a separate occasion — it's what turns a pile of merged PRs into a deployed version, and
its own changelog is generated *from* the PRs merged since the last tag. There's no fixed batch size;
use judgement (a handful of merged PRs, or a natural stopping point in the queue) rather than
releasing after every single merge or letting an unbounded pile of unreleased work accumulate on
`main`. See `docs/releasing.md` for the mechanics and what version bump to choose.
