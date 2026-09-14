import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LONGEST_PROMPT, OneAtATime, carriesASecret, whatWasAsked, type Recorded } from './asked';
import { lastRuns, migrateBook, writeDown } from './book';
import { readEvent } from './worker';
import { Runs } from './runs';
import type { ServerResponse } from 'node:http';

/**
 * What the builder may be asked, decided before anything is spawned.
 *
 * The dev-server version of this door is honest about being acceptable *"here and nowhere else"*.
 * This is the nowhere-else, so the decisions are pulled out where they can be read.
 */
describe('what a page asked for', () => {
  it('is the words it typed, trimmed', () => {
    expect(whatWasAsked({ prompt: '  make the wolf bigger  ' }))
      .toEqual({ prompt: 'make the wolf bigger', about: '' });
  });

  it('keeps what was on screen, for the record rather than for the prompt', () => {
    const asked = whatWasAsked({ prompt: 'bigger', about: 'wolf' });
    expect(asked).toEqual({ prompt: 'bigger', about: 'wolf' });
  });

  it('is nothing at all when there is nothing in it', () => {
    for (const body of [null, undefined, {}, { prompt: '' }, { prompt: '   ' }, 'a string', 42]) {
      expect(whatWasAsked(body), JSON.stringify(body)).toBe('empty');
    }
  });

  /*
   * Not a security boundary — a short prompt can ask for anything a long one can. What it stops is
   * a page that has gone wrong sending the same thing repeatedly.
   */
  it('is refused when it is longer than a person would type', () => {
    expect(whatWasAsked({ prompt: 'x'.repeat(LONGEST_PROMPT) })).not.toBe('too long');
    expect(whatWasAsked({ prompt: 'x'.repeat(LONGEST_PROMPT + 1) })).toBe('too long');
  });

  it('cuts what was on screen to something that fits in a log line', () => {
    const asked = whatWasAsked({ prompt: 'p', about: 'y'.repeat(500) });
    expect(typeof asked === 'string' ? '' : asked.about).toHaveLength(80);
  });

  /*
   * The prompt is one argv element and is never a shell string, so there is nothing to escape.
   * This is the assertion that it is not rewritten on the way through: the dev server calls itself
   * "a pipe rather than a librarian", and a route that quietly added instructions of its own would
   * be a route nobody could reason about.
   */
  it('is not rewritten, however it is spelled', () => {
    for (const said of ['rm -rf /', '`whoami`', '$(id)', 'a; b', '"quoted"', "it's", '\\\\']) {
      expect(whatWasAsked({ prompt: said })).toEqual({ prompt: said, about: '' });
    }
  });
});

/**
 * One at a time, per worktree.
 */
describe('who has the worktree', () => {
  it('is whoever took it, and nobody else may have it', () => {
    const tree = new OneAtATime();
    expect(tree.take('chris')).toBe(true);
    expect(tree.take('somebody else'), 'two acceptEdits runs in one tree overwrite each other').toBe(false);
    expect(tree.busy).toBe('chris');
  });

  it('is nobody again once it is given back', () => {
    const tree = new OneAtATime();
    tree.take('chris');
    tree.release();
    expect(tree.busy).toBeNull();
    expect(tree.take('somebody else')).toBe(true);
  });

  /* A run that fails and a run that ends both come through the release, so it happens twice. */
  it('does not mind being given back twice', () => {
    const tree = new OneAtATime();
    tree.take('chris');
    tree.release();
    expect(() => tree.release()).not.toThrow();
    expect(tree.busy).toBeNull();
  });
});

/**
 * And the book, whose one rule is that it never carries a credential.
 */
describe('what is written down about a run', () => {
  const book = (): DatabaseSync => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE IF NOT EXISTS schema (domain TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    migrateBook(db);
    return db;
  };
  const record = (over: Partial<Recorded> = {}): Recorded => ({
    who: 'acc1', when: 1000, about: 'wolf', length: 20, changed: ['src/entities/animals.ts'],
    ok: true, note: '12s', ...over,
  });

  it('is who, when, what it was about, what changed and whether it worked', () => {
    const db = book();
    writeDown(db, 'r1', record());
    expect(lastRuns(db)[0]).toMatchObject({
      who: 'acc1', about: 'wolf', changed: ['src/entities/animals.ts'], ok: true, note: '12s',
    });
  });

  it('is never the prompt itself, only how long it was', () => {
    const db = book();
    writeDown(db, 'r1', record({ length: 4000 }));
    const said = JSON.stringify(lastRuns(db)[0]);
    expect(said).toContain('4000');
    expect(Object.keys(lastRuns(db)[0])).not.toContain('prompt');
  });

  /*
   * The issue asks for this in as many words: "without recording JWTs or secrets". Enforced at the
   * door rather than in a comment, so it holds when somebody adds a field in a hurry.
   */
  it('refuses a record with something shaped like a signed note in it', () => {
    const db = book();
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2MxIn0.c2lnbmF0dXJlaGVyZQ';
    expect(() => writeDown(db, 'r1', record({ note: `failed for ${token}` }))).toThrow();
    expect(() => writeDown(db, 'r2', record({ who: token }))).toThrow();
    expect(lastRuns(db), 'and writes nothing at all').toHaveLength(0);
  });

  it('refuses one with a stored password in it', () => {
    expect(carriesASecret(record({ note: 'scrypt$32768$8$1$abc$def' }))).toBe(true);
    expect(carriesASecret(record()), 'and lets an ordinary one through').toBe(false);
  });

  it('updates the run it already has rather than making a second row', () => {
    const db = book();
    writeDown(db, 'r1', record({ ok: false, note: 'running' }));
    writeDown(db, 'r1', record({ ok: true, note: 'done' }));
    expect(lastRuns(db)).toHaveLength(1);
    expect(lastRuns(db)[0].note).toBe('done');
  });

  it('reads a damaged changed-list as none rather than throwing', () => {
    const db = book();
    writeDown(db, 'r1', record());
    db.prepare('UPDATE builder_run SET changed = ?').run('{not json');
    expect(lastRuns(db)[0].changed).toEqual([]);
  });

  it('hands back the newest first, which is what somebody reading it wants', () => {
    const db = book();
    writeDown(db, 'r1', record({ when: 1000, about: 'older' }));
    writeDown(db, 'r2', record({ when: 2000, about: 'newer' }));
    expect(lastRuns(db).map((one) => one.about)).toEqual(['newer', 'older']);
  });
});

/**
 * The transcript, which belongs to the server because a page that reloads takes its own stream
 * down with it — and the builder's whole job is editing files, which is what makes a page reload.
 */
describe('a run somebody is following', () => {
  const reader = () => {
    const written: string[] = [];
    let ended = false;
    const res = {
      setHeader: () => {},
      write: (line: string) => { written.push(line); return true; },
      end: () => { ended = true; },
      on: () => {},
    } as unknown as ServerResponse;
    return { res, written, get ended() { return ended; } };
  };

  it('tells a follower what has already been said before saying anything new', () => {
    const runs = new Runs();
    const run = runs.begin('r1', 'chris', 'wolf');
    runs.tell(run, { k: 'say', text: 'first' });

    const late = reader();
    runs.follow(run, late.res, 0);
    expect(late.written.join('')).toContain('first');

    runs.tell(run, { k: 'say', text: 'second' });
    expect(late.written.join(''), 'and keeps telling them').toContain('second');
  });

  it('picks up where a reloaded page left off', () => {
    const runs = new Runs();
    const run = runs.begin('r1', 'chris', 'wolf');
    runs.tell(run, { k: 'say', text: 'one' });
    runs.tell(run, { k: 'say', text: 'two' });

    const again = reader();
    runs.follow(run, again.res, 1);
    expect(again.written.join('')).not.toContain('one');
    expect(again.written.join('')).toContain('two');
  });

  /* A process that fails emits an error and then closes, so the end arrives twice. */
  it('ends once however many times it is ended', () => {
    const runs = new Runs();
    const run = runs.begin('r1', 'chris', 'wolf');
    const watching = reader();
    runs.follow(run, watching.res, 0);
    runs.finish(run, false, 'broke');
    runs.finish(run, true, 'no it did not');
    expect(watching.written.filter((line) => line.includes('"k":"end"'))).toHaveLength(1);
    expect(watching.written.join('')).toContain('broke');
  });

  it('closes a follower straight away when the run is already over', () => {
    const runs = new Runs();
    const run = runs.begin('r1', 'chris', 'wolf');
    runs.finish(run, true, 'done');
    const after = reader();
    runs.follow(run, after.res, 0);
    expect(after.ended).toBe(true);
    expect(after.written.join(''), 'having been told the whole thing').toContain('done');
  });

  it('still has the last run for a page reloaded after the end', () => {
    const runs = new Runs();
    runs.finish(runs.begin('r1', 'chris', 'wolf'), true, 'done');
    runs.begin('r2', 'chris', 'bear');
    expect(runs.find('r1'), 'the one before last is still readable').not.toBeNull();
    expect(runs.latest?.id).toBe('r2');
  });

  it('forgets the one before that, rather than keeping every prompt ever run', () => {
    const runs = new Runs();
    runs.begin('r1', 'chris', 'a');
    runs.begin('r2', 'chris', 'b');
    runs.begin('r3', 'chris', 'c');
    expect(runs.find('r1')).toBeNull();
    expect(runs.find('r2')).not.toBeNull();
  });

  it('answers nothing for a follower of a run that never existed', () => {
    const runs = new Runs();
    const nobody = reader();
    runs.follow(runs.find('nope'), nobody.res, 0);
    expect(nobody.ended).toBe(true);
    expect(nobody.written).toEqual([]);
  });
});

/**
 * And reading the CLI's own stream, where anything unrecognised is dropped rather than guessed at.
 */
describe('what the builder is heard saying', () => {
  it('hears text as it is typed', () => {
    expect(readEvent({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
    }, '/tree')).toEqual([{ k: 'say', text: 'hello' }]);
  });

  it('hears a tool, and says what it was used on', () => {
    expect(readEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tree/src/a.ts' } }] },
    }, '/tree')).toEqual([{ k: 'tool', name: 'Edit', on: 'src/a.ts' }]);
  });

  it('drops what it does not recognise, because the CLI is free to change its shapes', () => {
    for (const msg of [{ type: 'system' }, { type: 'stream_event', event: { type: 'ping' } }, {}]) {
      expect(readEvent(msg, '/tree')).toEqual([]);
    }
  });
});
