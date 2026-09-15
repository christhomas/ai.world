import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldRecords, WorldRecordConflict } from './worldrecords';
import { FileVault } from './filevault';
import type { Vault } from './vault';

/**
 * The four ways a name could stop meaning what it meant.
 *
 * A name is the handle somebody has on their world. Every fault below ends with a name pointing at
 * a different country, at nothing, or at somebody else's afternoon — and none of them says so at
 * the time.
 */
const held = (start: Record<string, string> = {}): Vault & { kept: Map<string, string> } => {
  const kept = new Map(Object.entries(start));
  return { kept, read: (name) => kept.get(name) ?? null, write: (name, text) => { kept.set(name, text); } };
};
const AT = 'data/world-records.json';
const anchor = (x: number) => ({ id: `isle-${x}`, kind: 'island' as const, x, z: 0, seed: x, parent: null, version: 1 });

describe('a registry that could not be read', () => {
  /*
   * The worst of the four. An unreadable file was treated as an empty one, and the next claim wrote
   * the empty map straight over it: one truncated write and every name in the world was gone,
   * replaced by whichever name was claimed next, silently.
   */
  it('is not written over by the next claim', () => {
    const vault = held({ [AT]: '[{"name":"Ashford","seed":1,"kind":"road","manifest":[]},' });
    const records = new WorldRecords('data', vault);
    expect(records.damaged, 'it knows it could not read it').not.toBeNull();
    expect(() => records.claim('Somewhere Else', 2, 'road', []))
      .toThrow(WorldRecordConflict);
    expect(vault.kept.get(AT), 'the file is exactly as it was found')
      .toBe('[{"name":"Ashford","seed":1,"kind":"road","manifest":[]},');
  });

  it('says why, so somebody can go and look', () => {
    const records = new WorldRecords('data', held({ [AT]: '{"not":"a list"}' }));
    expect(records.damaged).toContain('not a list');
    expect(() => records.claim('Ashford', 1, 'road', [])).toThrow(/could not be read/);
  });

  it('is not confused with a registry that was never written', () => {
    const records = new WorldRecords('data', held());
    expect(records.damaged, 'an empty server is not a damaged one').toBeNull();
    expect(() => records.claim('Ashford', 1, 'road', [])).not.toThrow();
  });

  it('reads a good one and goes on working', () => {
    const vault = held({ [AT]: JSON.stringify([{ name: 'Ashford', seed: 1, kind: 'road', manifest: [] }]) });
    const records = new WorldRecords('data', vault);
    expect(records.damaged).toBeNull();
    expect(records.find('ashford')?.seed).toBe(1);
  });
});

/**
 * And the file itself, which is where an unreadable one comes from.
 */
describe('writing the registry', () => {
  it('is never half a file, however the process ends', () => {
    const dir = mkdtempSync(join(tmpdir(), 'records-'));
    try {
      const at = join(dir, 'world-records.json');
      const vault = new FileVault();
      vault.write(at, '[{"name":"Ashford"}]');
      vault.write(at, '[{"name":"Ashford"},{"name":"Oakcross"}]');
      expect(JSON.parse(readFileSync(at, 'utf8'))).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /*
   * The reason it is a rename rather than a write: a reader that opens the file at any moment sees
   * one whole document or the other, never the first half of the new one.
   */
  it('leaves nothing beside it when it has finished', () => {
    const dir = mkdtempSync(join(tmpdir(), 'records-'));
    try {
      const at = join(dir, 'world-records.json');
      new FileVault().write(at, '[]');
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      expect(readdirSync(dir), 'a temporary file left behind is a file somebody will find later')
        .toEqual(['world-records.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not destroy what is there when the write itself fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'records-'));
    try {
      const at = join(dir, 'world-records.json');
      writeFileSync(at, '[{"name":"Ashford"}]');
      // a directory where the temporary file wants to be: the write fails and the original stands
      expect(() => new FileVault().write(join(dir, 'nope', 'x', 'y'), 'x')).not.toThrow();
      expect(readFileSync(at, 'utf8')).toBe('[{"name":"Ashford"}]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A join that said nothing about its islands, which used to freeze a name empty for ever.
 */
describe('a name claimed before anybody stated its islands', () => {
  it('is filled in by the first join that states them', () => {
    const records = new WorldRecords('data', held());
    records.claim('Ashford', 1, 'road', undefined);
    expect(records.find('ashford')?.manifest).toEqual([]);

    const after = records.claim('Ashford', 1, 'road', [anchor(10)]);
    expect(after.manifest, 'the first join to say so is believed').toHaveLength(1);
    expect(records.find('ashford')?.manifest).toHaveLength(1);
  });

  it('is not refused for the join that states them, which is the fault', () => {
    const records = new WorldRecords('data', held());
    records.claim('Ashford', 1, 'road', undefined);
    expect(() => records.claim('Ashford', 1, 'road', [anchor(10)]),
      'one quiet client must not poison a name for everybody after it').not.toThrow();
  });

  /*
   * And once stated it is authoritative, which is the protection this must not undo.
   */
  it('refuses a different manifest once one has been stated', () => {
    const records = new WorldRecords('data', held());
    records.claim('Ashford', 1, 'road', [anchor(10)]);
    expect(() => records.claim('Ashford', 1, 'road', [anchor(99)])).toThrow(WorldRecordConflict);
  });

  it('lets a join that says nothing in take the manifest already recorded', () => {
    const records = new WorldRecords('data', held());
    records.claim('Ashford', 1, 'road', [anchor(10)]);
    expect(records.claim('Ashford', 1, 'road', undefined).manifest).toHaveLength(1);
  });

  it('still refuses a different seed or a different kind', () => {
    const records = new WorldRecords('data', held());
    records.claim('Ashford', 1, 'road', undefined);
    expect(() => records.claim('Ashford', 2, 'road', undefined)).toThrow(WorldRecordConflict);
    expect(() => records.claim('Ashford', 1, 'endless', undefined)).toThrow(WorldRecordConflict);
  });

  it('will not fill one in when the registry could not be read', () => {
    const vault = held({ [AT]: JSON.stringify([{ name: 'Ashford', seed: 1, kind: 'road', manifest: [] }]).slice(0, -3) });
    const records = new WorldRecords('data', vault);
    expect(() => records.claim('Ashford', 1, 'road', [anchor(10)])).toThrow(/could not be read/);
  });
});
