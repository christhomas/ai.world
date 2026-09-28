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

The `check` job runs `tools/mergeguard.cjs` on GitHub's proposed PR merge commit, comparing its
reachability guard with the merge commit's first parent (`main`). It rejects restored inline
excuses, removed assertions, and raised ratchet allowances, including the stale-branch pattern
from #221. If a guard really must change, a maintainer can apply the `merge-guard-exception` label
after reviewing a PR description line beginning `Merge guard exception:` with a concrete reason of
at least 30 characters after the prefix.
The exception and the detected changes remain visible in the check log.

The required `playtest` job also compares fresh `map` and `phone-title` captures with their
checked-in `docs/screenshots/` references. The pixel references were captured on the pinned
Ubuntu 24.04 runner with the lockfile's Playwright browser. To change one deliberately, download
the `reference-scenes` artifact from the PR's CI run, inspect its PNGs, and commit the intended
images to `docs/screenshots/`. The job uploads its captures and a pixel-difference report when the
comparison fails. A capture from another OS may lay out fonts differently. The moving town scene
remains a documentation screenshot rather than a pixel baseline.

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

A required check takes minutes. Issue agents should not wait on it: claim distinct issues, work in
separate worktrees, and open component PRs as each issue is ready. Use focused local checks while
coding; GitHub-hosted Actions owns the full suite, Flutter checks, screenshots, and browser playtest.

The integration agent groups complete component PRs by dependency into a temporary batch branch.
Intermediate component and batch-to-batch PRs do not run the expensive full gate. The final PR from
each batch to `main` runs every required check against the combined result. Merge only that final PR,
after all required checks pass; then close its component PRs as superseded. Keep the original issue
closing references on the final `main` PR so the batch closes exactly the issues it completed.

The loop is: **claim in parallel, submit component PRs as they are ready, integrate by batch, merge
only a green batch PR to `main`.** Do not use a green component check as a substitute for testing the
combined batch, and do not merge a batch while any required check is pending or failed.

## Releasing

Cut a release after every two merged batch PRs, from a clean, current `main`, using
`docs/releasing.md`. That keeps playtestable versions arriving regularly without repeating the full
browser playtest for every component PR.
