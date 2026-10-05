import { describe, expect, it } from 'vitest';
import { WorldVault, type WorldStorage } from './world-vault';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('asynchronous durable world vault', () => {
  it('waits for preload before exposing the saved room and province names', async () => {
    const load = deferred<readonly (readonly [string, string])[]>();
    let opened = false;
    const opening = WorldVault.open({ load: () => load.promise, write: async () => {} }).then(vault => { opened = true; return vault; });
    await Promise.resolve(); expect(opened).toBe(false);
    load.resolve([['worlds/3.json', '{"day":12}'], ['worlds/3/province/0.json', 'province']]);
    const vault = await opening;
    expect(vault.read('worlds/3.json')).toBe('{"day":12}');
    expect(vault.list('worlds/3/')).toEqual(['worlds/3/province/0.json']);
    expect(vault.read('absent')).toBeNull();
  });

  it('serializes real host writes and does not acknowledge a delayed durable operation', async () => {
    const disk = new Map<string, string>(), first = deferred<void>(), calls: string[] = [];
    const vault = await WorldVault.open({ load: async () => [], write: async (name, text) => {
      calls.push(text); if (text === 'first') await first.promise; disk.set(name, text);
    } });
    vault.write('room', 'first'); vault.write('room', 'second');
    expect(vault.read('room')).toBe('second');
    let flushed = false;
    const flushing = vault.flush().then(() => { flushed = true; });
    await Promise.resolve(); expect(calls).toEqual(['first']); expect(flushed).toBe(false);
    first.resolve(); await flushing;
    expect(calls).toEqual(['first', 'second']); expect(disk.get('room')).toBe('second');
  });

  it('keeps failures visible across flushes and unrelated writes until that key is successfully retried', async () => {
    const error = new Error('quota'); let fail = true;
    const storage: WorldStorage = { load: async () => [], write: async name => { if (name === 'room' && fail) throw error; } };
    const vault = await WorldVault.open(storage);
    vault.write('room', 'old'); await expect(vault.flush()).rejects.toThrow(AggregateError);
    vault.write('other', 'kept'); await expect(vault.flush()).rejects.toThrow(AggregateError);
    await expect(vault.flush()).rejects.toMatchObject({ errors: [error] });
    fail = false; vault.write('room', 'retry'); await expect(vault.flush()).resolves.toBeUndefined();
  });

  it('fails opening when storage cannot load instead of inventing an empty world', async () => {
    const error = new Error('blocked storage');
    await expect(WorldVault.open({ load: async () => { throw error; }, write: async () => {} })).rejects.toBe(error);
  });

  it('flush has an acceptance boundary rather than waiting for a future blocked write', async () => {
    const later = deferred<void>(), vault = await WorldVault.open({ load: async () => [],
      write: async (_name, text) => { if (text === 'later') await later.promise; } });
    vault.write('room', 'first'); const accepted = vault.flush();
    vault.write('room', 'later'); await accepted;
    later.resolve(); await vault.flush();
  });
  it('a future retry cannot erase the failure a previously requested flush must report', async () => {
    const error = new Error('first write failed');
    const vault = await WorldVault.open({ load: async () => [], write: async (_name, text) => {
      if (text === 'first') throw error;
    } });
    vault.write('room', 'first'); const first = vault.flush();
    vault.write('room', 'retry');
    await expect(first).rejects.toMatchObject({ errors: [error] });
    await expect(vault.flush()).resolves.toBeUndefined();
  });
});
