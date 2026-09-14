# Issue pipeline

This is the operating process for taking an issue in `christhomas/ai.world` from intake through verified closure.

## Intake and ownership

1. Discover the live open issue and pull-request queue; do not rely on a hardcoded list.
2. Read the issue description, acceptance criteria, linked pull requests, comments, reviews, and related follow-up issues before editing.
3. Use one issue per branch and pull request. Keep unrelated fixes out of the issue.
4. Record the issue's concrete scope, affected files or symbols, expected behavior, and verification boundary before implementation.

## Implementation

1. Complete the specified behavior end to end; do not substitute a narrower workaround or add unrequested retries, telemetry, validation, or abstractions.
2. Reuse repository conventions and migrate every affected caller when an exported symbol or contract changes.
3. Preserve user work and stop before destructive cleanup outside the issue's scope.
4. Fix required build, type, test, and CI failures in the issue branch. Do not suppress failures or special-case their inputs.

## Verification

1. Reproduce a bug before fixing it when practical, then confirm the original failure no longer occurs.
2. Run the smallest targeted smoke check that exercises the changed behavior after the implementation is complete.
3. Keep a permanent regression test only when it defends an observable behavior, boundary, invariant, transition, precedence rule, or real error.
4. Do not repeatedly run the repository-wide suite locally; GitHub CI owns complete-suite validation unless reproducing a specific CI failure.
5. Verify the actual changed surface: launch the CLI/TUI, use the browser UI, or execute the relevant service path rather than asserting implementation details.

## Review findings

1. Inspect all human, automated, and agent review findings before closure.
2. Group actionable review findings into one follow-up issue with the original issue or pull-request URL, review and thread URLs, exact scope, affected files or symbols, and expected behavior.
3. Do not modify the current pull request solely for deferred review findings. Required CI failures, type errors, failed tests, and failed builds still block closure.

## Blockers and retries

1. Diagnose and fix actionable blockers instead of hiding them.
2. Allow no more than three failed attempts at the same blocker without a concrete artifact, diagnosis, or verified result.
3. After the limit, park the issue with the exact blocker and preserve the evidence; do not leave an unattended worker retrying it.
4. Keep failed and parked attempts in elapsed-time accounting; never reset the run start to improve the metric.

## Closure

1. Close the issue only after its pull request has merged and the merged head is verified.
2. Record the merge commit, merge time, and linked issue in the XDG timing ledger at `~/.config/ohmypi/agent/issue-cycle-times.json`.
3. Validate the ledger as JSON immediately after updating it.
4. Confirm the issue's acceptance criteria, review handoffs, CI result, and follow-up links are documented before closure.
5. Continue from the live queue; never assume the next issue or pull request number.
