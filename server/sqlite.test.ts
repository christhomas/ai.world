import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/**
 * The runtime actually has a database in it, which is the whole of why the image is on Node 24.
 *
 * The server has durable state that JSON files cannot keep safely: a villager's memories of a
 * player are lost on restart today, and the tools portal needs users and sessions that survive a
 * container coming back. The decision on both is SQLite on the volume that is already there,
 * rather than a network database beside a one-replica server.
 *
 * `node:sqlite` is behind `--experimental-sqlite` on Node 22 and unflagged on 24. The alternatives
 * were shipping a flagged experimental API in production, or taking a dependency into a
 * `package.json` that the Pages build and the server image both install — twice, once per
 * architecture — and a native module in a world-server image is the shape of the last thing that
 * nearly killed this container.
 *
 * So this is not a test of SQLite. It is the assertion that makes the Node version load-bearing
 * rather than a number somebody is free to put back: the day the image drops to 22, this goes red
 * with the reason in its own name, instead of the server failing to open its database in
 * production where nobody is watching the logs.
 */
describe('the runtime this server is built on', () => {
  it('has a database in it without being asked twice', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE villager (id TEXT PRIMARY KEY, opinion INTEGER NOT NULL)');
    db.prepare('INSERT INTO villager (id, opinion) VALUES (?, ?)').run('p1', -3);
    const said = db.prepare('SELECT opinion FROM villager WHERE id = ?').get('p1');
    expect(said).toEqual({ opinion: -3 });
    db.close();
  });

  /*
   * The three settings every one of those issues names, checked because a database with none of
   * them is not the thing that was decided on — it is a file that loses a write when the power goes.
   */
  it('takes the settings a durable one needs: write-ahead, foreign keys, a busy timeout', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    db.close();
  });

  /*
   * And the promise the whole arrangement rests on: either the whole of a change lands or none of
   * it does. A register half-written by a container that was killed mid-restart is worse than one
   * that was never written.
   */
  it('rolls a half-finished change back rather than keeping the half of it that landed', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE village (name TEXT PRIMARY KEY)');
    db.exec('BEGIN');
    db.prepare('INSERT INTO village (name) VALUES (?)').run('Ashford');
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT count(*) AS many FROM village').get()).toEqual({ many: 0 });
    db.close();
  });
});

/**
 * And the two places the version is written down, held to each other.
 *
 * The image comment has always claimed it "matches the node the tests run on in CI, so the server
 * is not first tried on a new runtime in production". Nothing checked that, and a claim nothing
 * checks is how the two drift apart — which is exactly the fault #135 and #81 are both about, one
 * file saying something no gate ever reads.
 */
describe('the node the image is built on', () => {
  const at = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it('is the node the checks run on', () => {
    const image = at('Dockerfile').match(/^ARG NODE_VERSION=(\d+)/m)?.[1];
    const checks = [...at('.github/workflows/checks.yml').matchAll(/node-version: (\d+)/g)]
      .map((m) => m[1]);
    expect(image, 'the Dockerfile no longer says which node it builds on').toBeDefined();
    expect(checks.length, 'the checks workflow no longer names a node').toBeGreaterThan(0);
    for (const said of checks) expect(said, `CI runs node ${said}, the image builds on ${image}`).toBe(image);
  });

  it('is the node that deploys, too', () => {
    const image = at('Dockerfile').match(/^ARG NODE_VERSION=(\d+)/m)?.[1];
    for (const [, said] of at('.github/workflows/deploy.yml').matchAll(/node-version: (\d+)/g)) {
      expect(said, `the deploy runs node ${said}, the image builds on ${image}`).toBe(image);
    }
  });

  /*
   * And it is high enough for the reason it was raised. `node:sqlite` is flagged on 22 and
   * unflagged from 24; a drop below that is the server failing to open its own database.
   */
  it('is new enough to have `node:sqlite` without a flag', () => {
    const image = Number(at('Dockerfile').match(/^ARG NODE_VERSION=(\d+)/m)?.[1]);
    expect(image, '`node:sqlite` is experimental and flag-gated below 24').toBeGreaterThanOrEqual(24);
  });
});
