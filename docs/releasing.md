# Cutting a release

A deployment is a commit somebody can point at. That is the whole idea, and everything here follows
from it: if the version, the tag, the chart and the image do not all name the same moment, the
history stops being something you can go back to.

```
chore release 0.3.0 "mountains you can walk round, and the world's own creatures"
chore release minor "..."      # or major, or patch
```

## What it does, in order

1. **Refuses to start** on a dirty tree or off `main`. A release names a commit; there has to be one.
2. **Runs the tests.** A release is the wrong place to find out.
3. **Moves all three version numbers together** — the chart's `version`, its `appVersion`, and the
   pin in `deploy/flux/helmrelease.yaml`. `server/chart.test.ts` fails the build if they ever drift,
   because two of the three agreeing is the failure that reaches a cluster.
4. **Commits and tags.** The tag is what a rollback goes back to.
5. **Pushes both**, then **publishes the GitHub release**, which is what builds and pushes
   `ghcr.io/christhomas/ai-world:<version>` for amd64 and arm64.

Flux on the cluster is watching `main`. It reads the chart from the same commit, sees the new
version, and installs it — so publishing the release is the deploy, and nothing else has to happen.

## Rolling back

The tag is the point to go back to, and there are two ways depending on how bad it is.

**A bad version, everything else fine.** Move the chart back to the last good version and commit:
Flux reconciles to it within the minute, and the image it names is still in the registry because
images are never deleted. This is the usual case and it costs one commit.

**A bad change you want out of the history.** Branch from the tag before it, take the good work
across, and cut a new release from that. The tags are what make this possible — every deployed
version is a commit with a name, so "the last one that worked" is a thing you can check out rather
than a thing you have to remember.

Never move a tag that has been published. The image built from it stays in the registry under that
number for ever, so a moved tag means a version whose name and contents disagree, and that is the
one failure this whole arrangement exists to prevent.

## What can still go wrong

- **The image build fails after the release is published.** Then the chart names a version that
  exists in git and nowhere else, and a cluster reconciling it gets ImagePullBackOff. Fix the build,
  and cut the *next* version rather than re-publishing the broken one.
- **Somebody bumps the chart by hand.** The chart test catches the mismatch, but only when the tests
  run. `chore release` is the way to avoid the question.
