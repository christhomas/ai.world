# Issue pipeline

Use this pipeline whenever a session takes over the project issue queue. Update this file when the
repository's actual issue, review, or release process changes.
## Isolate the session first

Never process issues in a checkout shared with another coding session. Before reading the first
issue, create a dedicated branch and Git worktree for the session. Keep every edit, test, audit,
commit, and pull request in that worktree. A dirty shared checkout is evidence of somebody else's
work, not an invitation to absorb or reset it.

If work began in a shared checkout, copy only the known affected files into the dedicated worktree,
verify them there, and leave the shared checkout untouched. Rebase the isolated branch onto current
`origin/main` before its pull request; resolve conflicts from repository evidence rather than by
taking either tree wholesale.

## Working an issue

1. **Choose the nearest useful issue.** Continue the active issue first. After it, prefer a linked
   child, parent, blocker, regression, or newly discovered gap before unrelated work.
2. **Read the entire GitHub issue immediately before starting it.** Read the body and every comment,
   especially the latest comment. Comments may contain newer implementation decisions, an existing
   branch or pull request, failed approaches, edge cases, and verification evidence that supersede
   the original body.
### Live issue replies

Issue comments are the user's live reply channel, not a post-work log. For every active issue, keep the
last-read GitHub comment ID and timestamp in session state. Immediately before posting any comment,
reply, reaction, edit, or closure:

1. Fetch the issue body and the complete comment list again.
2. Compare comment IDs with the last-read cursor and read every newer comment in chronological order.
3. Treat those comments as current requirements; update or stop the pending action when they supersede
   an assumption, even if implementation is already under way.
4. Post only after processing them, then fetch once more to catch a comment that crossed the write.
5. Advance the cursor only through comments actually read, including the assistant's new comment.

Never infer "no new reply" from a prior fetch or from the issue body's unchanged timestamp.
3. **Choose sensible defaults.** Resolve ambiguity from repository conventions, existing code, and
   the issue's acceptance criteria. Ask the user only when two materially different player-facing
   policies remain and the repository cannot choose between them.
4. **Establish the affected surface.** Reproduce reported bugs where practical. Before changing an
   exported symbol, use language-server references and migrate every caller in the same change.
5. **Implement the complete acceptance criteria.** Fix the source rather than suppressing a symptom.
   Remove obsolete paths instead of leaving compatibility aliases unless persisted data requires a
   migration.
6. **Verify the behavior.** Run the narrow scenario that proves the change, then the relevant tests
   and typecheck. For web UI, exercise and inspect the live browser surface. Record only commands and
   outcomes actually observed.

## Gaps found while working

Fix an in-scope gap immediately and include it in the current issue comment. Do not defer a small
necessary correction merely because the issue did not predict it.

Create a new GitHub issue when the gap is independently useful work, materially expands scope, or
cannot be completed with the current issue. The new issue must contain:

- the observed behavior and evidence;
- the source location or reproduction path;
- the desired behavior and concrete completion criteria;
- its relationship to the current issue;
- any decision already established by code or discussion.

Link the new issue from a comment on the current issue, then process that related issue before moving
to unrelated work when doing so closes the current behavior loop. Do not create placeholder issues
for work already completed in the same change.

## Commenting and closing

Before leaving each issue, add a GitHub comment containing:

- the decision and why it follows the project's conventions;
- the changed files and observable behavior;
- exact verification commands and results;
- links to follow-up issues for any remaining gaps.

Close the issue only when its acceptance criteria are met. Otherwise leave it open with the remaining
blocker stated precisely. Never claim background or intended work as completed work.

## Pull request checkpoint

When a coherent set of related issues is complete:

1. Review the change as one unit and remove temporary probes or generated audit files.
2. Run `pnpm exec tsc --noEmit`, the relevant suites, and the repository checks required by
   `.github/workflows/checks.yml`.
3. Commit the work on a focused branch and push it.
4. Open a pull request whose body links every completed and follow-up issue, states the behavior
   changes, and lists the verification evidence.
5. Wait for required checks. Fix failures on the same branch; do not bypass or weaken checks.
6. **Before every merge attempt, fetch the PR again**: conversation comments, submitted reviews,
   inline review threads, requested changes, review-bot findings, and check annotations. Keep a
   last-read ID/timestamp cursor for PR feedback just as for issue comments.
7. Read every item newer than the cursor. Respond to every review point: fix actionable findings,
   explain with evidence when no code change is right, and push all resulting changes to the same PR.
   Re-run affected checks and wait for the pushed commit's required checks; stale green checks do not
   cover a newer commit.
8. Fetch reviews and threads once more after the push. Do not merge with an unanswered comment, an
   unresolved actionable thread, an outstanding changes-requested review, or checks running against
   an older head SHA.
9. Merge only the reviewed, current, verified pull request, then return to the nearest related open
   issue.
A green pipeline on the current head, with all review feedback handled, is standing authorization to
merge immediately. Do not ask the user for merge confirmation. Required checks are the release gate,
so keep them strong and never bypass them for speed.

When an accidental regression is found, use a strict red/green repair before changing the source:

1. Reproduce the broken observable behavior.
2. Add a focused regression test that fails for that exact reason and run it to record the red result.
3. Fix the source rather than weakening the assertion or suppressing the symptom.
4. Run the same test to green, then the affected suite, typecheck, and required pipeline.
5. Keep the test when it protects a plausible recurrence; never delete or dilute it merely to merge.

The green current-head pipeline then authorizes the corrective merge under the same review rules.

## Release checkpoint

Read `docs/releasing.md`, `tools/release.ts`, recent GitHub releases, and the current release workflow
before cutting a release; the tool is authoritative when older prose differs. Current releases are
made from a clean `main` with:

```sh
chore release patch "short description of the shipped behavior"
```

`chore release` runs the suite, updates the package/chart/deployment versions and changelog, creates
and merges a release pull request, tags the exact merge commit, publishes the GitHub release, and
comments the shipped version on included issues. Never move or reuse a published tag. Confirm the
multi-architecture image workflow completed before treating the release as deployable.

After release, return to step 1 with the nearest related open issue.
