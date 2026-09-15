import { cleanWorldName, worldKey, type WorldRecord } from './protocol';
import type { Vault } from './vault';

/** Why a name could not be attached to the country a client presented. */
export class WorldRecordConflict extends Error {}

/**
 * Durable names for generated countries.
 *
 * World state remains in the old seed-numbered files. The registry is deliberately separate: old
 * servers can still read those files, and naming an existing seed adopts its state rather than
 * replacing it. A seed may have one name, so an old seed room and its newly named room cannot split.
 */
export class WorldRecords {
  private readonly records = new Map<string, WorldRecord>();
  private readonly seeds = new Map<number, string>();
  private readonly path: string;

  constructor(dataDir: string, private readonly vault: Vault) {
    this.path = dataDir ? `${dataDir}/world-records.json` : 'world-records.json';
    const text = vault.read(this.path);
    if (!text) return;
    try {
      const values = JSON.parse(text) as unknown;
      if (!Array.isArray(values)) return;
      for (const value of values) this.restore(value);
    } catch {
      // An unreadable registry cannot be guessed at. Seed-numbered saves still remain untouched.
    }
  }

  /** Resolve a sayable name without creating anything. */
  find(name: unknown): WorldRecord | undefined {
    const key = worldKey(name);
    return key ? this.records.get(key) : undefined;
  }

  /** The name already attached to a legacy numeric seed, if one has been attached. */
  forSeed(seed: number): WorldRecord | undefined {
    const key = this.seeds.get(seed >>> 0);
    return key ? this.records.get(key) : undefined;
  }

  /**
   * Resolve a name, creating it from the supplied country on its first join. Existing names are
   * authoritative: a client presenting different facts is refused, never silently moved into the
   * country somebody else named.
   */
  claim(name: unknown, seed: number): WorldRecord {
    const shown = cleanWorldName(name);
    const key = worldKey(name);
    if (!shown || !key) throw new WorldRecordConflict('World names use letters, numbers, spaces, _ or -, and must be 48 characters or fewer.');

    const root = seed >>> 0;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.seed !== root) {
        throw new WorldRecordConflict(`“${shown}” already names a different world.`);
      }
      return copy(existing);
    }

    const otherKey = this.seeds.get(root);
    if (otherKey) {
      const other = this.records.get(otherKey)!;
      throw new WorldRecordConflict(`Seed ${root} is already named “${other.name}”.`);
    }

    const record: WorldRecord = { name: shown, seed: root };
    this.records.set(key, record);
    this.seeds.set(root, key);
    this.save();
    return copy(record);
  }

  all(): WorldRecord[] {
    return [...this.records.values()].map(copy);
  }

  private restore(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const raw = value as { name?: unknown; seed?: unknown; kind?: unknown; manifest?: unknown };
    const name = cleanWorldName(raw.name);
    const key = worldKey(raw.name);
    const seed = Number(raw.seed);
    if (!name || !key || !Number.isFinite(seed) || this.records.has(key)) return;
    const root = seed >>> 0;
    if (this.seeds.has(root)) return;
    const record: WorldRecord = { name, seed: root };
    this.records.set(key, record);
    this.seeds.set(root, key);
  }

  private save(): void {
    this.vault.write(this.path, JSON.stringify([...this.records.values()], null, 2));
  }
}

function copy(record: WorldRecord): WorldRecord { return { ...record }; }
