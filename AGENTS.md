# Agent instructions

## Releases and playtesting

- Read [`docs/pull-request.md`](docs/pull-request.md) and [`docs/releasing.md`](docs/releasing.md) before landing or releasing changes. Those documents define the repository's workflow.
- Develop changes on a feature branch. Push them and open a pull request against `main`; do not push feature work directly to `main`.
- Wait for the pull request's required checks to pass before merging. If a check fails, diagnose and fix it, then wait for a green rerun. Never bypass a failed or pending check.
- Releases are always cut from a clean, up-to-date `main`, after the changes have landed there. Never run the release command from a feature branch.
- Use `chore release patch "<short summary>"` for a patch release (or the appropriate `major`/`minor` bump). The release command runs the full test suite, creates and merges the release pull request through the repository's guarded flow, tags the merged `main` commit, and publishes the GitHub release. Read `docs/releasing.md` for recovery and rollback rules.
- The user expects frequent playable releases and has authorized pushing and automatic deployment when required pipelines are green. Release meaningful completed batches promptly; do not leave verified playtest fixes sitting only in a local worktree.
- After publishing, monitor the image build and deployment. Tell the user the version and where to playtest only after the image is built and the deployment has picked it up. If an image build fails after publication, follow `docs/releasing.md`: fix forward with a new version; never move or republish the same tag.
