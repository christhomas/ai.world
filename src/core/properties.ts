/**
 * Numbers as files.
 *
 * `behaviourFile.ts` moved what a creature decides out of the source; this is the machinery for
 * moving what a creature *is*. The argument is the same one. A table of speeds and hit points is
 * read far more often than the code around it, it is argued about by people who have no reason to
 * open a TypeScript file, and it reads in a diff as "the bear now hits for three" rather than as a
 * changed literal four screens down.
 *
 * What this file contributes is the complaining. JSON carries no types, so a hand-edited table
 * will eventually say `"hp": "20"` or leave `speed` out altogether, and the failure that follows —
 * a wolf with `NaN` hit points that no blow ever finishes — is a fortnight of nobody noticing.
 * So nothing is reached for directly: every value comes out through a reader that knows the file
 * it came from and the key it was asked for, and says both when the value is not what it claimed.
 *
 * A `note` may appear on anything and is never read. It is the comment JSON otherwise lacks, and
 * it may be one string or a list of them where a paragraph is not enough.
 */

export class PropertiesError extends Error {
  constructor(where: string, why: string) {
    super(`${where}: ${why}`);
    this.name = 'PropertiesError';
  }
}

/** What a value turned out to be, for a message that names the mistake rather than the type. */
function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A number, out of a place that was expecting one. Used inside lists, where there is no key. */
export function asNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PropertiesError(where, `expected a number, found ${describe(value)}`);
  }
  return value;
}

/** A string, likewise. */
export function asText(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new PropertiesError(where, `expected a string, found ${describe(value)}`);
  return value;
}

/**
 * One object out of a file, carrying the trail of names that led to it, so that every complaint
 * reads as a place a person can go and open: `properties/beasts.json bear.gold`.
 *
 * Every reader comes in two forms. The plain one insists — a kind with no `speed` is a kind that
 * cannot move, and stopping at load is the only useful thing to do about it. The `maybe` one
 * returns nothing when the key is absent, because half of what a creature is, is what it has been
 * left out of: no `hp` is what makes a blade pass through a wight, and no `climb` is what makes a
 * terrace a wall.
 */
export class Fields {
  private readonly raw: Record<string, unknown>;

  constructor(readonly where: string, value: unknown) {
    if (!isObject(value)) throw new PropertiesError(where, `expected an object, found ${describe(value)}`);
    this.raw = value;
  }

  /** Every key in this object except `note`, which is prose for the reader and not a value. */
  keys(): string[] {
    return Object.keys(this.raw).filter((key) => key !== 'note');
  }

  has(key: string): boolean {
    return this.raw[key] !== undefined;
  }

  private at(key: string): string {
    return `${this.where}.${key}`;
  }

  /** Insist on a key being there at all; everything below goes through this. */
  private need(key: string): unknown {
    const value = this.raw[key];
    if (value === undefined) throw new PropertiesError(this.at(key), 'is missing');
    return value;
  }

  num(key: string): number {
    return asNumber(this.need(key), this.at(key));
  }

  maybeNum(key: string): number | undefined {
    return this.has(key) ? this.num(key) : undefined;
  }

  text(key: string): string {
    return asText(this.need(key), this.at(key));
  }

  flag(key: string): boolean {
    const value = this.need(key);
    if (typeof value !== 'boolean') throw new PropertiesError(this.at(key), `expected true or false, found ${describe(value)}`);
    return value;
  }

  maybeFlag(key: string): boolean | undefined {
    return this.has(key) ? this.flag(key) : undefined;
  }

  /** A low and a high, which is how every range in the game is written: `[3, 6]`. */
  pair(key: string): [number, number] {
    const value = this.need(key);
    if (!Array.isArray(value) || value.length !== 2) {
      throw new PropertiesError(this.at(key), `expected a pair of numbers, found ${describe(value)}`);
    }
    const low = asNumber(value[0], `${this.at(key)}[0]`);
    const high = asNumber(value[1], `${this.at(key)}[1]`);
    if (high < low) throw new PropertiesError(this.at(key), `the low end (${low}) is above the high end (${high})`);
    return [low, high];
  }

  maybePair(key: string): [number, number] | undefined {
    return this.has(key) ? this.pair(key) : undefined;
  }

  /**
   * A value out of a fixed set — a behaviour, the shape of a blow. Worth its own reader because
   * a misspelt one is the failure that goes unnoticed longest: the creature loads, and then does
   * nothing at all for the rest of the game.
   */
  choice<T extends string>(key: string, allowed: readonly T[]): T {
    const value = this.text(key);
    if (!(allowed as readonly string[]).includes(value)) {
      throw new PropertiesError(this.at(key), `"${value}" is not one of: ${[...allowed].sort().join(', ')}`);
    }
    return value as T;
  }

  maybeChoice<T extends string>(key: string, allowed: readonly T[]): T | undefined {
    return this.has(key) ? this.choice(key, allowed) : undefined;
  }

  words(key: string): string[] {
    return this.list(key, asText);
  }

  numbers(key: string): number[] {
    return this.list(key, asNumber);
  }

  /** A list, each entry read by whatever the caller says it is. Empty is a mistake worth catching. */
  list<T>(key: string, each: (value: unknown, where: string) => T): T[] {
    const value = this.need(key);
    if (!Array.isArray(value) || value.length === 0) {
      throw new PropertiesError(this.at(key), `expected a list of at least one, found ${describe(value)}`);
    }
    return value.map((item, i) => each(item, `${this.at(key)}[${i}]`));
  }

  /** A nested object, as fields of its own. */
  group(key: string): Fields {
    return new Fields(this.at(key), this.need(key));
  }

  maybeGroup(key: string): Fields | undefined {
    return this.has(key) ? this.group(key) : undefined;
  }
}

/**
 * A file divided into sections, read as one set of fields.
 *
 * A table of two dozen dials wants headings — everything about a blow together, everything about
 * a herd together — and the game wants one flat lookup. So the file is arranged for whoever opens
 * it and flattened here, which costs nothing except that a name may appear only once in the file.
 * That is a rule worth having anyway: the same dial under two headings is two people tuning
 * different halves of one number.
 */
export function flatten(where: string, contents: unknown): Fields {
  if (!isObject(contents)) throw new PropertiesError(where, `expected an object, found ${describe(contents)}`);
  const merged: Record<string, unknown> = {};
  for (const [section, values] of Object.entries(contents)) {
    if (section === 'note') continue;
    if (!isObject(values)) {
      throw new PropertiesError(`${where}.${section}`, `expected a section of values, found ${describe(values)}`);
    }
    for (const [key, value] of Object.entries(values)) {
      if (key === 'note') continue;
      if (merged[key] !== undefined) throw new PropertiesError(`${where}.${key}`, 'is under two headings at once');
      merged[key] = value;
    }
  }
  return new Fields(where, merged);
}

/**
 * The whole of a directory, read as one table.
 *
 * The files are handed in rather than found, because the game is bundled for a browser and a
 * browser has no directory to walk. What matters is that nothing here knows a filename: adding
 * `properties/insects.json` is an import beside the others and no change at all down here, which
 * is the whole reason the table was split up in the first place.
 *
 * Two files claiming the same name is an error rather than a silent last-one-wins, because that
 * mistake is invisible: the game runs, and one of the two creatures you thought you had edited is
 * quietly the other one.
 */
export function readAll<T>(files: Record<string, unknown>, one: (fields: Fields, name: string) => T): Record<string, T> {
  const out: Record<string, T> = {};
  const from: Record<string, string> = {};
  for (const [file, contents] of Object.entries(files)) {
    const top = new Fields(file, contents);
    for (const name of top.keys()) {
      if (out[name] !== undefined) throw new PropertiesError(`${file}.${name}`, `already defined in ${from[name]}`);
      out[name] = one(top.group(name), name);
      from[name] = file;
    }
  }
  return out;
}
