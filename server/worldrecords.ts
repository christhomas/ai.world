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
  /**
   * What was on disk that this could not read, if anything.
   *
   * An unreadable registry used to be treated as an empty one, and the comment said the honest
   * thing — it cannot be guessed at — while the consequence went unsaid: the very next claim called
   * `save()`, which wrote the empty map straight over the file. **One truncated write and every
   * name in the world was gone**, replaced by whichever name was claimed next, silently.
   *
   * So a failed read is remembered. Nothing is written over it, a claim that would have to write is
   * refused with a reason, and the file stays exactly as it is for somebody to look at. A name is
   * the handle on somebody's world; losing one quietly is worse than refusing to open it.
   */
  private unreadable: string | null = null;

  constructor(dataDir: string, private readonly vault: Vault) {
    this.path = dataDir ? `${dataDir}/world-records.json` : 'world-records.json';
    const text = vault.read(this.path);
    if (text === null) return;                       // nothing kept yet, which is not a fault
    try {
      const values = JSON.parse(text) as unknown;
      if (!Array.isArray(values)) {
        this.unreadable = 'the registry is not a list of records';
        return;
      }
      for (const value of values) this.restore(value);
    } catch (why) {
      this.unreadable = why instanceof Error ? why.message : 'the registry could not be read';
    }
  }

  /** Why the registry on disk could not be read, or nothing where it could. */
  get damaged(): string | null { return this.unreadable; }

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

    /*
     * Nothing new is written on top of a registry nobody could read. Refused here rather than at
     * the write, so the caller is told before anything has changed in memory either — a server that
     * half-claimed a name and then failed to record it would disagree with its own disk.
     */
    if (this.unreadable !== null) throw this.cannotWrite();

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

  /** Why nothing may be written, said once so both refusals read the same. */
  private cannotWrite(): WorldRecordConflict {
    return new WorldRecordConflict(
      `The world registry on this server could not be read (${this.unreadable}), so nothing new can `
      + 'be written without losing the names already in it. The file is untouched.',
    );
  }

  private save(): void {
    this.vault.write(this.path, JSON.stringify([...this.records.values()], null, 2));
  }
}

function copy(record: WorldRecord): WorldRecord { return { ...record }; }
