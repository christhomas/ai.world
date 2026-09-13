#!/bin/sh
# Issue #30 — "95. Triage the exports nothing reaches."
#
# Named for the ISSUE number, not the worklist number, because the issue number is what the
# task-runner keys on — it is the identity the machine uses. The worklist number lives on in the
# issue title, where it is the identity a person uses: numbers there are global and never reused, so
# "95, yes" has to keep meaning one thing for ever. Two numbering systems, each in the place that
# reads it, and the title is where they meet.
#
# The task is a ratchet: `chore reachable` counts exported names called only by their own tests, it
# stood at 43 when the issue was written, and the work is to make that number smaller by deciding,
# one at a time, which are dead features and which are constants a test imports.
#
# So "done" is not a judgement here and does not need to be. Run the bench and read its own count.
# Anything below where it started is progress; the issue closes when somebody decides it has fallen
# far enough, and until then this fails and says by how much.
#
# It is a file rather than a one-liner because it is four steps and a comparison, and because a
# check worth trusting is a check somebody can read in the pull request that changed it.
set -e

WAS=43

pnpm exec vitest run src/world/reachable.test.ts >/dev/null 2>&1 || true
test -f unreached-report.txt || { echo "the bench wrote no report"; exit 1; }

NOW=$(head -1 unreached-report.txt | sed -E 's/[^0-9]*([0-9]+).*/\1/')
echo "unreached: ${NOW} (was ${WAS})"

# strictly fewer, because a ratchet that allows standing still is a ratchet nobody turns
test "${NOW}" -lt "${WAS}"
