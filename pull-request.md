# Pull-request process

This is the operating process for integrating pull requests in `christhomas/ai.world`.

## Queue and merge order

1. Discover all open pull requests and sort them by numeric PR number.
2. Treat the smallest unmerged PR as the current merge candidate.
3. Never merge a higher-numbered PR while a lower-numbered PR remains open, unless the lower PR has been explicitly parked with a concrete blocker after the retry limit.
4. Merge order is the only serialized part of the workflow. Higher-numbered pull requests may be prepared while the current PR waits on CI or review. Never hardcode specific PR numbers in this procedure; derive the current and next PR from the live open queue at each transition.

## Preparing a pull request

For each PR:

1. Read the linked issue, PR description, comments, reviews, inline threads, bot findings, check annotations, current head SHA, and mergeability.
2. Rebase or update the branch onto the current `main` when needed.
3. Resolve actionable CI failures in the branch. Defer actionable review findings to a follow-up issue as described below.
4. Run the smallest targeted local verification that exercises the changed behavior.
5. Push the completed branch and record the new head SHA.
6. Do not change the current PR for deferred review findings; preserve their links in the follow-up issue.

A branch that is already current is still useful work: verify its base, inspect its findings, prepare fixes, and run targeted checks rather than waiting idle.

## Overlapping work with CI

When the current PR has pending CI or review checks:

1. Start a non-model watcher at 60-second intervals. For example:

   ```sh
   gh pr checks <number> --repo christhomas/ai.world --watch --interval 60
   ```

2. Immediately prepare the next open PR in ascending order. Inspect it, rebase it, resolve findings, run targeted checks, and push any required changes.
3. Do not spend model or subagent turns polling pending checks.
4. When the current PR reaches a terminal state, return to it for final validation and merge decision.
5. If a job reports failure while its workflow is still running, wait for the workflow to finish with a non-model watcher before reading failure logs:

   ```sh
   gh run watch <run-id> --repo christhomas/ai.world --interval 60 --exit-status
   ```

## Review comments and agent reviews

Before attempting a merge, inspect all PR comments, inline threads, human reviews, and automated or agent-review findings.

If there are actionable review findings:

1. Group the related findings into one follow-up GitHub issue for the repository.
2. Include the current PR URL, review and thread URLs, exact findings, affected files or symbols, and the expected follow-up behavior.
3. Do not modify the current PR to address those review findings. The follow-up issue will be handled by a later agent and a separate PR.
4. Continue toward the merge once the required CI and normal merge gates pass. Review findings are tracked in the follow-up issue rather than blocking this PR.

This deferral applies to review feedback, not broken required CI. Type errors, failed tests, failed builds, and other required checks still block merging until fixed or the PR is explicitly parked.
## Final merge gate

Before merging, re-read the current PR state. A previous check result is invalid after the head changes.

Confirm all of the following:

- The head SHA is the one that was inspected and pushed.
- The PR is mergeable and up to date with `main`.
- Required CI checks are terminally successful; actionable review findings are recorded in a follow-up issue as described above.
- No lower-numbered open PR is waiting unmerged.

Merge without administrative bypass. Immediately record the verified merge commit and time, then return to the smallest remaining open PR.

## Blockers and retries

- Fix actionable CI failures instead of suppressing them.
- Do not retry the same blocker more than three times without a concrete diagnosis or artifact.
- After the limit, explicitly park the PR with the exact blocker and continue to the next independent PR.
- Failed or parked attempts remain part of the run's elapsed time; do not reset the timing calculation.

## Verification and accounting

- Targeted local checks are for changed behavior and conflict resolution.
- The complete repository suite belongs to GitHub CI; do not repeatedly run it locally.
- Update the issue-cycle ledger immediately after each verified merge.
- Record elapsed wall time from the monitored run start divided by issues merged in that run. Stop if the configured timing threshold is exceeded.
