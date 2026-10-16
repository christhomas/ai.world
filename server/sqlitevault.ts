import type { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { migrateDomain } from './durable/db';
import type { Vault } from './vault';

const SCHEMA = [
  `CREATE TABLE world_document (
     key TEXT PRIMARY KEY,
     body TEXT NOT NULL
   );
   CREATE TABLE world_import (
     id INTEGER PRIMARY KEY CHECK (id = 1)
   );`,
];

/** Server world names, snapshots and provinces share the accounts' durable database. */
export class SqliteVault implements Vault {
  private readonly root: string;

  constructor(private readonly db: DatabaseSync, private readonly dataDir: string) {
    this.root = resolve(dataDir || '.');
    migrateDomain(db, 'worlds', SCHEMA);
    this.importLegacy();
  }

  read(name: string): string | null {
    const row = this.db.prepare('SELECT body FROM world_document WHERE key = ?').get(this.key(name));
    return row ? String(row.body) : null;
  }

  write(name: string, text: string): void {
    this.db.prepare('INSERT INTO world_document (key, body) VALUES (?, ?) '
      + 'ON CONFLICT(key) DO UPDATE SET body = excluded.body').run(this.key(name), text);
  }

  list(prefix: string): string[] {
    const stem = this.key(prefix);
    const wanted = prefix.endsWith('/') && stem ? `${stem}/` : stem;
    // substr uses literal text, unlike LIKE where '_' and '%' in paths are wildcards.
    const rows = this.db.prepare('SELECT key FROM world_document WHERE substr(key, 1, ?) = ? ORDER BY key')
      .all(wanted.length, wanted);
    return rows.map(row => this.dataDir ? `${this.dataDir}/${String(row.key)}` : String(row.key));
  }

  /** Keys stay relative to the data root, so moving the database does not move a world. */
  private key(name: string): string {
    const key = relative(this.root, resolve(name || '.'));
    if (key === '..' || key.startsWith(`..${sep}`)) throw new Error('World storage path is outside its data directory');
    return key.split(sep).join('/');
  }

  /** Import once, atomically; keep original files for recovery, never write new world JSON files. */
  private importLegacy(): void {
    if (this.db.prepare('SELECT id FROM world_import WHERE id = 1').get()) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Another database handle may have completed the import while this one waited for the lock.
      if (!this.db.prepare('SELECT id FROM world_import WHERE id = 1').get()) {
        const insert = this.db.prepare('INSERT INTO world_document (key, body) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
        for (const entry of this.directory(this.root, true)) {
          if (entry.name === 'world-records.json' || /^\d+\.json$/.test(entry.name)) {
            if (!entry.isFile()) throw new Error(`Legacy world document is not a regular file: ${entry.name}`);
            insert.run(entry.name, readFileSync(join(this.root, entry.name), 'utf8'));
          } else if (/^\d+$/.test(entry.name)) {
            if (!entry.isDirectory()) throw new Error(`Legacy province store is not a directory: ${entry.name}`);
            for (const province of this.directory(join(this.root, entry.name))) {
              if (!/^-?\d+_-?\d+\.json$/.test(province.name)) continue;
              if (!province.isFile()) throw new Error(`Legacy province is not a regular file: ${entry.name}/${province.name}`);
              insert.run(`${entry.name}/${province.name}`, readFileSync(join(this.root, entry.name, province.name), 'utf8'));
            }
          }
        }
        // Raw text is retained, including damaged saves: existing readers must not silently lose it.
        this.db.prepare('INSERT INTO world_import (id) VALUES (1)').run();
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); }
      catch (rollbackError) { console.error('Could not roll back legacy world import:', rollbackError); }
      throw error;
    }
  }

  private directory(path: string, allowMissing = false) {
    try { return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
