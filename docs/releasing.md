# Cutting a release

A deployment is a commit somebody can point at. That is the whole idea, and everything here follows
from it: if the version, the tag, the chart and the image do not all name the same moment, the
history stops being something you can go back to.

This is the step that follows `docs/pull-request.md`: a release turns a batch of PRs just landed on
`main` into a deployed version, and its changelog is generated from exactly those merged PRs.

```
chore release 0.3.0 "mountains you can walk round, and the world's own creatures"
chore release minor "..."      # or major, or patch
```

## What it does, in order

1. **Refuses to start** on a dirty tree or off `main`. A release names a commit; there has to be one.
2. **Runs the tests.** A release is the wrong place to find out.
3. **Moves all three version numbers together** — the chart's `version`, its `appVersion`, and the
   pin in `deploy/flux/helmrelease.yaml` — and `package.json`'s, which the title screen and console
   read. `server/chart.test.ts` fails the build if the chart, appVersion and pin ever drift, because
   two of the three agreeing is the failure that reaches a cluster.
4. **Writes the changelog and the README's ten**, before anything is committed: `github-guard`'s
   changelog hook reads the *tagged commit's* files and refuses a tag whose release nobody
   documented, so this has to happen first or the tag can never go out.
5. **Commits on a release branch (`release/v<version>`), opens a pull request against `main`, and
   squashes it in** — `main` is protected (a pull request for every change, admins included, linear
   history), so a release goes out through the same guard as anything else. The branch needs no
   approving reviews and no status checks, so this is still one command; what changed is that every
   release now leaves a reviewable pull request behind it instead of an unexplained commit. It tries
   `gh pr merge --auto` first and falls back to polling the checks and merging by hand if the
   repository does not have auto-merge turned on.
6. **Tags what `main` actually became** — after the squash merges, it resets to `origin/main` and
   tags that, because the local pre-squash commit is not the commit that shipped.
7. **Pushes the tag**, then **publishes the GitHub release**, which is what builds and pushes
   `ghcr.io/christhomas/ai-world:<version>` for amd64 and arm64.
8. **Stamps every issue closed since the last release** with a comment naming the version — the
   only step allowed to fail without failing the release, since by then the release is already out.

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

## The two rules that take a cluster down

Everything else on this page is about getting a release out. These two are about not breaking one
that is already out, and they are the reason the rest of it is shaped as it is.

**Never move a tag that has been published.** The image built from it stays in the registry under
that number for ever, so a moved tag means a version whose name and contents disagree, and that is
the one failure this whole arrangement exists to prevent.

**Never re-publish a version whose image build failed — cut the next one.** If the build fails after
the release is published, the chart names a version that exists in git and nowhere else, and a
cluster reconciling it gets `ImagePullBackOff` until somebody notices. Fixing the build and
re-publishing the same number is the tempting move and it is the wrong one, for the same reason as
above: that number has already been seen. Fix the build, cut the *next* version, and let Flux move
forward onto it rather than backwards onto a number it has already tried.

Both are about the same property: **a published version number is a fact, not a draft.**

## What can still go wrong

- **Somebody bumps the chart by hand.** The chart test catches the mismatch, but only when the tests
  run. `chore release` is the way to avoid the question.
