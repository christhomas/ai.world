# Issue pipeline

How a session takes over the project's issue queue. Written from a day of actually running it, so
where this disagrees with a habit, this is what happened rather than what was intended.

**Update this file when the process changes.** A pipeline document that is out of date is worse
than none, because somebody follows it.

## The boundary

**Branch, fix, commit to the branch, open the pull request. Stop there.**

- Never commit to `main`, never merge, never cut a release. The repository's own pipeline reviews
  and merges; a session that merges its own work has removed the review it was asking for.
- Never mark a pull request draft. The pipeline is the review.
- Opening a PR is the end of the task. The next task is the next issue, not watching this one.

Everything below serves that boundary.

## Before anything

**Work in a checkout nobody else is writing to.**

    chore tree                      # refuses a dirty checkout and prints the way out
    git worktree add ../ai.world-<task> -b <task> origin/main

Several sessions have shared one working tree here before, and the result was not a merge conflict
— it was two afternoons, including two implementations of the same function with different rules,
neither of which knew about the other. If `chore tree` refuses, believe it.

**Fast-forward `main` first**, and look at what is already in the tree before you do. Uncommitted
work in a shared checkout may be somebody's afternoon: stash it and say so rather than resetting
over it.

## Choosing what to do

1. **Finish the issue in hand** before starting another.
2. Then prefer a child, a blocker, a regression, or a gap found while working, over anything
   unrelated.
3. **Read the whole issue immediately before starting** — body *and every comment*. The last
   comment often carries a decision, a branch that already exists, an approach that failed, or
   evidence that supersedes the body entirely. Several issues here were already half-built, and two
   were already done.
4. Check whether a branch or pull request exists for it. Two open PRs both saying `Closes #48`
   conflict whichever merges second.

## Deciding things

Resolve ambiguity from the repository's own conventions, the surrounding code, and the issue's
acceptance criteria. Ask only when two materially different player-facing policies remain and
nothing in the repository chooses between them.

When you *do* depart from what an issue literally asks for, **say so in the pull request and on the
issue, with the reason**. Do not do it quietly. A reviewer disagreeing with a stated decision is
cheap; a reviewer discovering an unstated one is not.

## Doing the work

**Write the failing test first and watch it go red.** Then fix. A test written after the fix is a
test that has never proved anything.

**Check that a new test measures something.** This is the single most expensive mistake available
here and it was made three times in one day:

- a fixture whose factory returned `null`, so four assertions passed having touched nothing;
- a village founded on four trades that filled all four, so eight cases returned early on a
  `if (x === undefined) return`;
- an assertion of the form `expect(a === 0 || b).not.toContain(c)` — two claims joined by `or`,
  satisfied by either.

Assert the precondition before the behaviour. If a scenario needs a seed where something actually
happens, scan for one and say in a comment that it was found by scanning rather than chosen.

**Fix the source, not the symptom.** Remove obsolete paths rather than leaving compatibility
aliases, unless persisted data needs a migration.

**Before changing an exported symbol, find every caller and migrate them in the same change.**

## Verifying

Run, in this order, and record what actually happened:

    pnpm exec tsc --noEmit
    npx vitest run --maxWorkers=4          # the whole suite, not the file you touched

Three checks bite on changes that look unrelated to them. Expect them:

- **`src/architecture.test.ts`** — no module over 700 lines. It counts `split('\n').length`, so a
  file `wc -l` calls 700 is 701 to it. It also measures what CI *merges*, so a branch and `main`
  can each be under and the merge over. Hit six times in one day, usually by adding a comment.
- **`src/world/reachable.test.ts`** — a ratchet on exports only their own tests reach. Lower it when
  you triage; never raise it. It will catch work you wired to nothing, which is exactly what it is
  for.
- **`chore excuses`** — an excuse for an unreached export must name an open issue or a named test.
  It fails when the issue it names closes.

**For anything visible, drive a browser.** A suite never draws anything. Borrow playwright rather
than depending on it:

    NODE_PATH=/path/to/a/checkout/with/playwright CHANNEL=chrome node tools/playtest.cjs

Measure rather than assert by eye: contrast ratios, element rectangles against the viewport,
computed colours. Three real bugs were found this way in a day, including one where the whole world
stopped drawing and the unit suite was green.

**Record only what you observed.** Never describe intended or background work as done.

## Gaps found while working

- **In scope:** fix it now and mention it in the issue comment.
- **Out of scope:** open a new issue. It must contain the observed behaviour and evidence, the
  source location or reproduction, the desired behaviour and concrete completion criteria, its
  relationship to the current issue, and any decision already settled by code or discussion. Link it
  from a comment on the current issue.
- Do not open placeholder issues for work already done in the same change.

## Stacking

A follow-up whose parent pull request is still open is **not blocked**. Branch from the parent and
open the PR against it:

    git checkout -b <follow-up> origin/<parent-branch>
    gh pr create --base <parent-branch> --head <follow-up>

Say in the body which PR it is stacked on. Most of a day's work can be stacked three or four deep;
"the parent has not merged" is not a reason to stop.

### After the parent merges

The stack is a development relationship, not the final integration base. When a parent PR lands in
`main`, move every child that was based on it onto the new `main` before merging the child:

1. Change the child PR's base branch to `main`.
2. Rebase the child branch onto the latest `main`.
3. Resolve conflicts and push the rebased branch.
4. Wait for the normal `pull_request` checks on the new head.
5. Merge the child only after all required checks are green.

Do this oldest-first when several children are waiting. After each merge, repeat the process for the
next dependent branch. Do not leave a child pointed at a branch that has already merged: it can remain
permanently behind or conflicted, and a stacked-branch update can leave the current head without the
required checks.

The checks workflow also runs on branch pushes so a rebase or update triggers CI automatically. A
manual workflow dispatch is a recovery measure for a missed run, not the normal merge process.

## Review follow-ups

The repository's reviewers defer findings into new issues saying **"do not modify PR #N for these"**.
Honour that: a separate branch stacked on #N, never a commit onto it.

These are usually correct and often find real faults in work that has already passed a full suite.
Read them as findings rather than as suggestions — and when one is wrong, say why on the issue
rather than silently skipping it.

Watch for the same finding filed twice by two different reviewers. Close the thinner one as a
duplicate, comment on both, and say so.

## The pull request

1. Review the whole change as one unit. Remove probes, instrumentation and generated reports.
2. Branch name: a short phrase, not a ticket number.
3. Commit message: what was wrong, why it was wrong, what the change is, and what it cost. The
   repository's history is written in prose and is expected to be read.
4. Body must contain:
   - `Closes #N` (or `Refs #N` where it is partial), one per line;
   - what was wrong and how it showed;
   - every decision a reviewer might disagree with, argued;
   - **what is not done, stated plainly** — partial criteria, things needing hands or hardware,
     departures from the issue;
   - verification: exact commands and real numbers;
   - which PR it is stacked on, if any.
5. Comment on each issue the PR closes, summarising the decision and anything surprising.
6. Push, open the PR, and **stop**.

## When CI fails

Fix it on the same branch. Never weaken or bypass a check to make it green.

A failure on your own pull request from a guard you just wrote is the guard working. Answer it;
do not widen it to fit.

## What this session does not do

- merge, tag, release, or touch `main`
- resolve a `needs-feedback` decision about what the game is for
- anything a `needs-hands` issue wants: a phone in a hand, two people in one world, a deployed
  homelab URL

For those, state the options and the recommendation on the issue and move on.
