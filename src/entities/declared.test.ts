import { describe, expect, it } from 'vitest';
import beasts from '../../properties/beasts.json';
import birds from '../../properties/birds.json';
import sea from '../../properties/sea.json';
import people from '../../properties/people.json';
import monsters from '../../properties/monsters.json';
import villain from '../../properties/villain.json';

/**
 * Every creature says how hard it hits, in its own entry, in its own file.
 *
 * Item 94, one field at a time. `damage` was optional, so twelve of the fourteen beasts and every
 * bird and every person said nothing about it — and each of the places that reads it wrote its own
 * answer. That is a fact about a cow being decided in `quarry.ts`, and in `camp.ts`, and in
 * `violence.ts`, by whoever was writing the line, with nothing anywhere saying what a creature with
 * no damage *is*.
 *
 * Written down, it is a decision: a deer does nought damage because a deer is not an attacker, and
 * you can read that off the file rather than inferring it from six call sites that happen to agree.
 * Where they *disagreed* — `altitude` is 2 in one spawn path and 7 in another — that is the next
 * field and a harder one, because the disagreement has to be settled before the value can be.
 *
 * Held as data rather than as loaded kinds on purpose: the point is that the *file* says so, so
 * this reads the file. A loader default would satisfy a test of the loaded object and leave the
 * JSON exactly as silent as it was.
 */
/** A creature entry, as against the block of prose each of these files opens with. */
const isACreature = (entry: unknown): entry is Record<string, unknown> =>
  typeof entry === 'object' && entry !== null && !Array.isArray(entry);

const FILES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['beasts.json', beasts], ['birds.json', birds], ['sea.json', sea],
  ['people.json', people], ['monsters.json', monsters], ['villain.json', villain],
];

describe('what every creature says about itself', () => {
  it('says how hard it hits, even when the answer is not at all', () => {
    const silent: string[] = [];
    for (const [file, table] of FILES) {
      for (const [name, entry] of Object.entries(table)) {
        // `note` is the prose at the top of each file, which is not a creature and has nothing to
        // say about hitting anybody. Everything else in these files is one
        if (!isACreature(entry)) continue;
        if (!('damage' in entry)) silent.push(`${file}: ${name}`);
      }
    }
    expect(silent, 'a creature whose file does not say leaves every reader to guess').toEqual([]);
  });

  it('and what it says is a number nobody has to interpret', () => {
    for (const [file, table] of FILES) {
      for (const [name, entry] of Object.entries(table)) {
        if (!isACreature(entry) || !('damage' in entry)) continue;
        expect(typeof (entry as { damage: unknown }).damage, `${file}: ${name}.damage`).toBe('number');
      }
    }
  });
});
