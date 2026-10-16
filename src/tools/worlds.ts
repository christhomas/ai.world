import { Forgetful } from '../../server/vault';
import { Rooms } from '../../server/rooms';
import { kindOf, type SessionSave, type WorldKind } from '../save/store';

export interface ToolWorld {
  key: string;
  seed: number;
  name?: string;
  kind?: WorldKind;
  source: 'browser' | 'server';
  checkpoint?: boolean;
}

export interface BrowserWorldSnapshot {
  files: Array<[string, string]>;
  slots: unknown[];
}

export function savedSlots(values: unknown[]): SessionSave[] {
  return values.filter((value): value is SessionSave => {
    if (!value || typeof value !== 'object') return false;
    const seed = (value as SessionSave).seed;
    return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff;
  });
}

/** Copy only: neither a survey nor a preview can write to the game's live database. */
export function snapshotVault(snapshot: BrowserWorldSnapshot): Forgetful {
  const vault = new Forgetful();
  for (const [name, text] of snapshot.files) {
    if (typeof name !== 'string' || typeof text !== 'string') throw new Error('Browser world storage contains invalid records.');
    // Do not let the world's legacy recovery turn a damaged checkpoint into a fresh survey.
    const value: unknown = JSON.parse(text);
    if (name === 'worlds/world-records.json' && !Array.isArray(value))
      throw new Error('The browser world catalogue is damaged.');
    vault.write(name, text);
  }
  for (const slot of savedSlots(snapshot.slots)) {
    const path = `worlds/${slot.seed}.json`;
    if (vault.read(path) !== null) continue;
    vault.write(path, JSON.stringify({ seed: slot.seed, clock: {
      day: slot.state?.day ?? 1, time: slot.state?.time ?? 0,
    }, deltas: [], manifest: slot.manifest }));
  }
  return vault;
}

export function browserWorlds(snapshot: BrowserWorldSnapshot): ToolWorld[] {
  const vault = snapshotVault(snapshot);
  const slots = savedSlots(snapshot.slots);
  return new Rooms('worlds', vault).knownWorlds().map(row => {
    const slot = slots.find(value => value.seed === row.seed);
    return { ...row, name: row.name ?? slot?.worldName, kind: row.kind ?? kindOf(slot?.world),
      key: `browser:${row.seed}`, source: 'browser',
      checkpoint: snapshot.files.some(([path]) => path === `worlds/${row.seed}.json`) };
  });
}
