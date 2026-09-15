import { startWorker } from './worker';

/**
 * Running the builder worker on the machine that has the checkout.
 *
 * It goes on the source host and nowhere near the game container: the game server has no compiler,
 * no repository and no Claude, and it should stay that way. This is the one process that has all
 * three, and the only thing that may speak to it is the portal.
 *
 *     BUILDER_SECRET=... BUILDER_WORKTREE=/srv/ai.world-builder pnpm tsx server/builder/index.ts
 *
 * The worktree is made once, by hand, and is deliberately not the checkout anybody deploys from:
 *
 *     git worktree add ../ai.world-builder -b builder origin/main
 *
 * That is what makes `--permission-mode acceptEdits` safe to hand to a web page. The edits are
 * real, they are on a branch, and somebody looks at them before they are anywhere near a release —
 * which is #103's "changed model files can be reviewed before they enter the release branch", and
 * it is a property of the worktree rather than of any code here.
 */
const secret = process.env.BUILDER_SECRET;
const worktree = process.env.BUILDER_WORKTREE;
if (!secret || !worktree) {
  console.error('the builder worker needs BUILDER_SECRET and BUILDER_WORKTREE, and starts without neither');
  process.exit(1);
}

const running = await startWorker({
  secret,
  worktree,
  // loopback unless a deployment deliberately says otherwise, so "unreachable from the internet"
  // is what happens when nobody configures anything
  host: process.env.BUILDER_BIND,
  port: Number(process.env.BUILDER_PORT ?? 8788),
});

const shutDown = (): void => { void running.close().then(() => process.exit(0)); };
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
