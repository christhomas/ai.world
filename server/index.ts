import { startServer } from './serve';

/**
 * Running the world server from a terminal: `chore world`, `pnpm server`, or node directly.
 * PORT and DATA_DIR are the only knobs; everything else lives in serve.ts.
 */
const running = await startServer({
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? 'server/data',
});

const shutDown = (): void => {
  // the worlds are held on disk before we go, so nothing anybody changed is lost
  void running.close().then(() => process.exit(0));
};
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
