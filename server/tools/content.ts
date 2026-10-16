import type { IncomingMessage, ServerResponse } from 'node:http';
import { ContentError } from '../../src/core/content';
import { StaleContent, type ContentCatalogue, type ContentChange } from '../content';

/**
 * The gameplay content catalogue over HTTP, for the tools (#624).
 *
 * Reached only through the tools portal, after it has proved the session, and the signed-in
 * account is the author written into every revision. `GET` lists the head, recent revisions and
 * every record's ID, or one record with its history; `POST` either edits records or rolls the
 * catalogue back to an earlier revision, always against the head the caller last read.
 *
 * Every write goes through `ContentCatalogue`, which refuses a stale base, an unknown record, a
 * dangling reference or anything the game's own readers would fail on, and leaves the published
 * revision as it was. This file adds only the HTTP: bounded bodies, JSON or nothing, and status
 * codes a page can act on — 409 for "somebody got there first", 400 for "the game would not
 * load that".
 */

/** The largest body accepted. The biggest content file is under sixteen kilobytes. */
export const CONTENT_BODY_LIMIT = 256 * 1024;
/** The most records one edit may change. */
const MOST_CHANGES = 64;
/** How long a revision note may be. */
const MOST_NOTE = 500;
/** How many recent revisions a listing carries. */
const RECENT = 50;

/**
 * A body up to `most` bytes, or null past it.
 *
 * Read to the end rather than cut off at the limit, because a request whose socket is destroyed
 * mid-upload never sees the refusal. Past four times the limit it is cut off anyway: nobody sends a
 * megabyte to a form that says it takes a quarter of one by accident.
 */
function bounded(req: IncomingMessage, most: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= most) chunks.push(chunk);
      else if (size > most * 4) { req.destroy(); resolve(null); }
    });
    req.on('end', () => resolve(size > most ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const reply = (res: ServerResponse, code: number, value: unknown): void => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A request body's shape, or why it is not one. Bodies of records are the catalogue's to judge. */
function requestOf(value: unknown):
  | { base: number; note: string; changes: ContentChange[] }
  | { base: number; note: string; rollback: number }
  | string {
  if (!isObject(value)) return 'Send a JSON object.';
  const { base, note = '', changes, rollback } = value;
  if (!Number.isSafeInteger(base)) return 'Say which revision the edit was made against, as `base`.';
  if (typeof note !== 'string' || note.length > MOST_NOTE) return `A note is text of at most ${MOST_NOTE} characters.`;
  if (rollback !== undefined) {
    if (changes !== undefined) return 'Send either changes or a rollback, not both.';
    if (!Number.isSafeInteger(rollback)) return 'Say which revision to roll back to, as `rollback`.';
    return { base: base as number, note, rollback: rollback as number };
  }
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MOST_CHANGES) {
    return `Send between 1 and ${MOST_CHANGES} changes.`;
  }
  const out: ContentChange[] = [];
  for (const change of changes) {
    if (!isObject(change) || typeof change.id !== 'string' || !('body' in change)) {
      return 'Each change is an `id` and a `body`; a null body deletes the record.';
    }
    out.push({ id: change.id, body: change.body });
  }
  return { base: base as number, note, changes: out };
}

/** Called only after the tools portal has checked the signed-in session; `who` is that account. */
export function contentEditor(catalogue: ContentCatalogue) {
  return async (req: IncomingMessage, res: ServerResponse, who: string): Promise<void> => {
    try {
      if (req.method === 'GET') {
        const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
        const head = catalogue.head();
        if (id === null) {
          reply(res, 200, {
            head,
            revisions: catalogue.revisions().slice(-RECENT),
            records: catalogue.records().map(({ id, kind, source, field }) => ({ id, kind, source, field })),
          });
          return;
        }
        const record = catalogue.records().find((one) => one.id === id);
        if (!record) { reply(res, 404, { error: `${id} is not a record in the catalogue.` }); return; }
        reply(res, 200, { head, record, history: catalogue.history(id) });
        return;
      }
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
          reply(res, 415, { error: 'Send the edit as application/json.' });
          return;
        }
        const body = await bounded(req, CONTENT_BODY_LIMIT);
        if (body === null) { reply(res, 413, { error: 'The edit is too large.' }); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { reply(res, 400, { error: 'The edit is not JSON.' }); return; }
        const asked = requestOf(parsed);
        if (typeof asked === 'string') { reply(res, 400, { error: asked }); return; }
        const head = 'rollback' in asked
          ? catalogue.rollback(asked.base, asked.rollback, who, asked.note)
          : catalogue.edit(asked.base, asked.changes, who, asked.note);
        reply(res, 200, { head });
        return;
      }
      reply(res, 405, { error: 'Use GET or POST.' });
    } catch (error) {
      if (error instanceof StaleContent) reply(res, 409, { error: error.message });
      else if (error instanceof ContentError) reply(res, 400, { error: error.message });
      else {
        console.error('the content catalogue could not answer:', error);
        reply(res, 500, { error: 'The content catalogue could not answer that.' });
      }
    }
  };
}
