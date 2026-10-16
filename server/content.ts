import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { migrateDomain } from './durable/db';
import {
  ContentError, brokenReferences, contentRecord, type ContentRecord,
} from '../src/core/content';

/**
 * The gameplay content catalogue: the bundled JSON seeds a new database once, and afterwards the
 * database is what the content is (#624).
 *
 * The rule this file exists to keep is that a restart or a redeploy never puts an operator's edit
 * back to a default. So opening a catalogue that already has a head changes nothing, whatever the
 * bundled files now say. The only way new defaults reach an existing catalogue is an explicit
 * upgrade, asked for by raising `CONTENT_DEFAULTS_VERSION`, and an upgrade only ever touches
 * records nobody has edited or deleted.
 *
 * Every change is a revision, and a revision is never rewritten: the tables refuse UPDATE and
 * DELETE outright, so history is something the database keeps rather than something code promises
 * to. A revision stores only the records it changed, and a record at revision R is its latest row
 * at or before R. That is exact because history is a line: a write must name the head it was made
 * against, and one made against anything else is refused rather than merged.
 *
 * A deleted record is a row with no body — a tombstone — so an upgrade can tell "somebody removed
 * this" from "this never existed" and leave the first alone.
 */

/**
 * Raised by hand when bundled defaults should flow into catalogues that already exist. A seeded
 * catalogue below this version is upgraded once on open; one at or above it is left as it is.
 */
export const CONTENT_DEFAULTS_VERSION = 1;

const SCHEMA = [
  `CREATE TABLE content_revision (
     id INTEGER PRIMARY KEY,
     parent INTEGER REFERENCES content_revision(id),
     reason TEXT NOT NULL CHECK (reason IN ('seed', 'upgrade', 'edit')),
     author TEXT NOT NULL,
     note TEXT NOT NULL,
     defaults INTEGER NOT NULL,
     defaults_hash TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE content_record (
     revision INTEGER NOT NULL REFERENCES content_revision(id),
     id TEXT NOT NULL,
     source TEXT NOT NULL,
     field TEXT,
     ordinal INTEGER NOT NULL,
     schema INTEGER NOT NULL,
     body TEXT,
     hash TEXT NOT NULL,
     origin TEXT NOT NULL CHECK (origin IN ('default', 'edit')),
     PRIMARY KEY (id, revision)
   );
   CREATE TABLE content_head (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     revision INTEGER NOT NULL REFERENCES content_revision(id)
   );
   CREATE TRIGGER content_revision_kept_as_written BEFORE UPDATE ON content_revision
     BEGIN SELECT RAISE(ABORT, 'content revisions are immutable'); END;
   CREATE TRIGGER content_revision_never_deleted BEFORE DELETE ON content_revision
     BEGIN SELECT RAISE(ABORT, 'content revisions are immutable'); END;
   CREATE TRIGGER content_record_kept_as_written BEFORE UPDATE ON content_record
     BEGIN SELECT RAISE(ABORT, 'content records are immutable'); END;
   CREATE TRIGGER content_record_never_deleted BEFORE DELETE ON content_record
     BEGIN SELECT RAISE(ABORT, 'content records are immutable'); END;`,
];

export interface ContentRevision {
  id: number;
  parent: number | null;
  reason: 'seed' | 'upgrade' | 'edit';
  /** `bundled defaults` for a seed or upgrade; otherwise whoever made the edit. */
  author: string;
  note: string;
  /** The `CONTENT_DEFAULTS_VERSION` in force when it was written. */
  defaults: number;
  /** SHA-256 of the bundled records the writing build carried: which defaults a default came from. */
  defaultsHash: string;
  createdAt: string;
}

/** A change to one record. A null body deletes it. */
export interface ContentChange {
  id: string;
  body: unknown;
}

/** A row as stored: the record, plus whether a person or the bundle last said what it is. */
interface Stored {
  record: ContentRecord;
  deleted: boolean;
  hash: string;
  origin: 'default' | 'edit';
}

const hashOf = (body: unknown): string => createHash('sha256').update(JSON.stringify(body)).digest('hex');

const asRevision = (row: Record<string, unknown>): ContentRevision => ({
  id: Number(row.id),
  parent: row.parent === null ? null : Number(row.parent),
  reason: String(row.reason) as ContentRevision['reason'],
  author: String(row.author),
  note: String(row.note),
  defaults: Number(row.defaults),
  defaultsHash: String(row.defaults_hash),
  createdAt: String(row.created_at),
});

export class ContentCatalogue {
  private readonly defaults: readonly ContentRecord[];
  private readonly defaultsHash: string;

  constructor(
    private readonly db: DatabaseSync,
    defaults: readonly ContentRecord[],
    private readonly defaultsVersion = CONTENT_DEFAULTS_VERSION,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    // What a record names is read from its body here, as it is for an edit, rather than trusted.
    this.defaults = defaults.map((record) => contentRecord(record.id, record.source, record.field, record.ordinal, record.body));
    this.defaultsHash = hashOf(this.defaults.map((record) => [record.id, record.body]));
    migrateDomain(db, 'content', SCHEMA);
    this.adopt();
  }

  /** The published revision every reader is handed. */
  head(): number {
    const row = this.db.prepare('SELECT revision FROM content_head WHERE id = 1').get();
    if (!row) throw new ContentError('content catalogue', 'has never been seeded');
    return Number(row.revision);
  }

  /** The live records at a revision, in file order. A deleted record is not among them. */
  records(revision = this.head()): ContentRecord[] {
    return this.state(revision).filter((row) => !row.deleted).map((row) => row.record);
  }

  revisions(): ContentRevision[] {
    return this.db.prepare('SELECT * FROM content_revision ORDER BY id').all().map(asRevision);
  }

  /**
   * Change existing records on top of `base`, which has to still be the head. Returns the new head.
   *
   * Refused whole, leaving the head where it was, if `base` is stale, a record is unknown or already
   * deleted, or the result names something that does not exist.
   */
  edit(base: number, changes: readonly ContentChange[], author: string, note = ''): number {
    if (!author.trim()) throw new ContentError('content edit', 'needs an author');
    if (changes.length === 0) throw new ContentError('content edit', 'changes nothing');
    return this.write((head) => {
      if (base !== head) throw new ContentError('content edit', `was made against revision ${base}, but the catalogue is at ${head}`);
      const current = new Map(this.state(head).map((row) => [row.record.id, row]));
      const rows: Stored[] = [];
      for (const change of changes) {
        const was = current.get(change.id);
        if (!was || was.deleted) throw new ContentError(change.id, 'is not a record in the catalogue');
        if (rows.some((row) => row.record.id === change.id)) throw new ContentError(change.id, 'is changed twice in one edit');
        const deleted = change.body === null;
        const record = deleted ? was.record
          : contentRecord(was.record.id, was.record.source, was.record.field, was.record.ordinal, change.body);
        rows.push({ record, deleted, hash: deleted ? 'deleted' : hashOf(change.body), origin: 'edit' });
      }
      return { reason: 'edit', author, note, rows };
    });
  }

  /** Seed an empty catalogue, or upgrade one whose defaults are older than this build asks for. */
  private adopt(): void {
    const head = this.db.prepare('SELECT revision FROM content_head WHERE id = 1').get();
    if (head && this.revisionAt(Number(head.revision)).defaults >= this.defaultsVersion) return;
    this.write((at) => {
      if (at === null) {
        const rows = this.defaults.map((record): Stored =>
          ({ record, deleted: false, hash: hashOf(record.body), origin: 'default' }));
        return { reason: 'seed', author: 'bundled defaults', note: 'first seed from the bundled JSON', rows };
      }
      // Another handle may have upgraded while this one waited for the write lock.
      if (this.revisionAt(at).defaults >= this.defaultsVersion) return null;
      const current = new Map(this.state(at).map((row) => [row.record.id, row]));
      const rows: Stored[] = [];
      for (const record of this.defaults) {
        const was = current.get(record.id);
        // An edit or a deletion is somebody's decision, and an upgrade does not overrule it.
        if (was && (was.deleted || was.origin === 'edit')) continue;
        const hash = hashOf(record.body);
        if (was && was.hash === hash && was.record.source === record.source
          && was.record.field === record.field && was.record.ordinal === record.ordinal) continue;
        rows.push({ record, deleted: false, hash, origin: 'default' });
      }
      return { reason: 'upgrade', author: 'bundled defaults', note: `defaults version ${this.defaultsVersion}`, rows };
    });
  }

  /**
   * The one way anything is written: a new revision on top of the head, checked before it is
   * published and committed whole or not at all.
   */
  private write(
    plan: (head: number | null) => { reason: ContentRevision['reason']; author: string; note: string; rows: Stored[] } | null,
  ): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT revision FROM content_head WHERE id = 1').get();
      const head = row ? Number(row.revision) : null;
      const next = plan(head);
      if (!next) { this.db.exec('COMMIT'); return head!; }
      const after = new Map((head === null ? [] : this.state(head)).map((stored) => [stored.record.id, stored]));
      for (const stored of next.rows) after.set(stored.record.id, stored);
      const live = [...after.values()].filter((stored) => !stored.deleted).map((stored) => stored.record);
      const broken = brokenReferences(live);
      if (broken.length) throw new ContentError('content catalogue', `refused ${next.reason}: ${broken.join('; ')}`);
      const revision = Number(this.db.prepare(
        'INSERT INTO content_revision (parent, reason, author, note, defaults, defaults_hash, created_at) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(head, next.reason, next.author, next.note,
        next.reason === 'edit' ? this.revisionAt(head!).defaults : this.defaultsVersion,
        this.defaultsHash, this.now()).lastInsertRowid);
      const insert = this.db.prepare('INSERT INTO content_record '
        + '(revision, id, source, field, ordinal, schema, body, hash, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const { record, deleted, hash, origin } of next.rows) {
        insert.run(revision, record.id, record.source, record.field, record.ordinal, record.schema,
          deleted ? null : JSON.stringify(record.body), hash, origin);
      }
      this.db.prepare('INSERT INTO content_head (id, revision) VALUES (1, ?) '
        + 'ON CONFLICT(id) DO UPDATE SET revision = excluded.revision').run(revision);
      this.db.exec('COMMIT');
      return revision;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); }
      catch (rollbackError) { console.error('Could not roll back a content catalogue write:', rollbackError); }
      throw error;
    }
  }

  private revisionAt(revision: number): ContentRevision {
    const row = this.db.prepare('SELECT * FROM content_revision WHERE id = ?').get(revision);
    if (!row) throw new ContentError('content catalogue', `has no revision ${revision}`);
    return asRevision(row);
  }

  /** Every record's latest row at or before `revision`, deletions included, in file order. */
  private state(revision: number): Stored[] {
    this.revisionAt(revision);
    const rows = this.db.prepare(
      'SELECT r.* FROM content_record r WHERE r.revision = '
      + '(SELECT MAX(x.revision) FROM content_record x WHERE x.id = r.id AND x.revision <= ?) '
      + 'ORDER BY r.source, r.ordinal, r.id',
    ).all(revision);
    return rows.map((row) => {
      const deleted = row.body === null;
      const field = row.field === null ? null : String(row.field);
      const body: unknown = deleted ? null : JSON.parse(String(row.body));
      return {
        record: contentRecord(String(row.id), String(row.source), field, Number(row.ordinal), body),
        deleted,
        hash: String(row.hash),
        origin: String(row.origin) as Stored['origin'],
      };
    });
  }
}
