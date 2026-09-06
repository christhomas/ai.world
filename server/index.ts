import { startServer } from './serve';

/**
 * Running the world server from a terminal: `chore world`, `pnpm server`, or node directly.
 * PORT, DATA_DIR, STATIC_DIR and OPERATOR_TOKEN are the only knobs; the rest lives in serve.ts.
 */
const running = await startServer({
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? 'server/data',
  // set STATIC_DIR to a built copy of the game and this one process serves both halves
  staticDir: process.env.STATIC_DIR,
  // set OPERATOR_TOKEN and the server will take commands for the worlds it is holding. Unset, the
  // route does not exist — see docs/server-authority.md for what comes through it.
  operatorToken: process.env.OPERATOR_TOKEN,
});

const shutDown = (): void => {
  // the worlds are held on disk before we go, so nothing anybody changed is lost
  void running.close().then(() => process.exit(0));
};
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
