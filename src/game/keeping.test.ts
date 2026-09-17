import { describe, it, expect } from 'vitest';
import { openTheSave } from './keeping';
import { Manifest } from '../world/manifest';
import type { SaveStore, SessionSave, WorldKind } from '../save/store';
import { kindOf } from '../save/store';
import type { Structures } from '../world/structures';

/** Nothing in this file needs a country; the save is asked what it kept, not what it grew. */
const NO_STRUCTURES: Structures = {
  doors: [], villages: [], pois: [], all: [], piers: [], signposts: [],
  caves: [], wrecks: [], derelicts: [], castles: [],
};

class Held implements SaveStore {
  readonly kept = new Map<string, unknown>();
  async load<T>(key: string): Promise<T | undefined> { return this.kept.get(key) as T | undefined; }
  async save<T>(key: string, value: T): Promise<void> { this.kept.set(key, value); }
  async remove(key: string): Promise<void> { this.kept.delete(key); }
}

function openAndPut(world: WorldKind, saved?: SessionSave): SessionSave {
  const store = new Held();
  const { persist } = openTheSave({
    store, slotKey: 'slot', seed: 7, world, worldName: 'Ashford', saved,
    structures: NO_STRUCTURES,
    manifest: new Manifest(7, saved?.manifest),
    rng: () => 0.5,
    cam: () => ({ x: 0, z: 0, rot: 0, zoom: 1 }),
    at: () => ({ x: 0, z: 0 }),
    sky: () => null,
  });
  persist();
  return store.kept.get('slot') as SessionSave;
}

describe('a save remembers which country it is', () => {
  it('writes down the world it was opened as', () => {
    expect(openAndPut('road').world).toBe('road');
    expect(openAndPut('endless').world).toBe('endless');
  });

  it('hands the same country back when it is reopened', () => {
    const put = openAndPut('road');
    expect(kindOf(put.world)).toBe('road');
    expect(kindOf(openAndPut('road', put).world)).toBe('road');
  });
});
