import { startServer } from './serve';

/**
 * Running the world server from a terminal: `chore world`, `pnpm server`, or node directly.
 * PORT, DATA_DIR, STATIC_DIR, OPERATOR_TOKEN and OPERATOR_WATCH_TOKEN are the knobs the world
 * itself has; TOOLS_SECRET and the two TOOLS_ADMIN_* open the tools portal. The rest is serve.ts.
 */
const running = await startServer({
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? 'server/data',
  // set STATIC_DIR to a built copy of the game and this one process serves both halves
  staticDir: process.env.STATIC_DIR,
  // set OPERATOR_TOKEN and the server will take commands for the worlds it is holding. Unset, the
  // route does not exist — see docs/server-authority.md for what comes through it.
  operatorToken: process.env.OPERATOR_TOKEN,
  // and a second one that may only ask a world questions, for anything watching rather than running
  watchToken: process.env.OPERATOR_WATCH_TOKEN,
  /*
   * The tools portal: a login in front of the Character Builder and the Domesday Book, so nobody
   * has to paste an operator token into a page again.
   *
   * Set TOOLS_SECRET and it exists; leave it and `/tools` is not a route at all, which is the same
   * rule `/operate` runs on. The first account is made from TOOLS_ADMIN_USER and
   * TOOLS_ADMIN_PASSWORD — without both, the portal starts shut and says so, because a default
   * password is a known password.
   */
  toolsSecret: process.env.TOOLS_SECRET,
  /*
   * And where everything the server cannot work out again is kept: the portal's accounts, and the
   * half of a villager that no seed implies. One file beside the worlds on the same durable volume,
   * with a table each — see `server/durable/db.ts`.
   */
  durableDb: process.env.DURABLE_DB,
  /*
   * And where the builder's worker is, if there is one behind this server.
   *
   * A separate process on the machine with the checkout — `server/builder/index.ts` — which this
   * server reaches over a private address and nothing else can. Without all three the two build
   * routes are not there at all: a game server with no source host behind it should not have a
   * door onto one.
   */
  builder: process.env.BUILDER_HOST && process.env.BUILDER_SECRET
    ? {
      host: process.env.BUILDER_HOST,
      port: Number(process.env.BUILDER_PORT ?? 8788),
      secret: process.env.BUILDER_SECRET,
    }
    : undefined,
  // believe X-Forwarded-Proto only where the deployment says something is in front of us, or the
  // `Secure` flag is decided by a header anybody can send
  trustProxy: process.env.TRUST_PROXY === '1',
});

const shutDown = (): void => {
  // the worlds are held on disk before we go, so nothing anybody changed is lost
  void running.close().then(() => process.exit(0));
};
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
