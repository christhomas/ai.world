import { describe, expect, it } from 'vitest';
import { CATALOGUE, GROUPS, nameOfProp } from './catalogue';
import { PropKind } from './biomes';

/**
 * Everything the world can draw has a name.
 *
 * `PropKind` is a `const enum`, so at run time it does not exist: the compiler substitutes the
 * numbers and throws the names away. That is why a list of what the world contains could not be
 * built by reading the enum, and why the catalogue has to be written out by hand — and why it needs
 * this, because a hand-written list of eighty things is a list that goes stale.
 *
 * So the question is asked of the thing that actually knows: the prop library holds a shape for
 * every prop the game can put on the ground, keyed by kind, and it is a real object at run time.
 * Anything in it must be named here.
 */

describe('the catalogue of what stands on the world', () => {
  it('names everything the prop library can draw', async () => {
    const { PropLibrary } = await import('../render/props');
    const library = new PropLibrary();
    const named = new Set(CATALOGUE.map((entry) => entry.kind));
    const missing: number[] = [];
    for (const kind of library.geometries.keys()) {
      if (kind !== PropKind.None && !named.has(kind)) missing.push(kind);
    }
    expect(missing, `the world draws ${missing.join(', ')} and the catalogue does not name them`)
      .toEqual([]);
  });

  it('names nothing twice, and nothing that cannot be drawn', () => {
    const seen = new Set<PropKind>();
    for (const entry of CATALOGUE) {
      expect(seen.has(entry.kind), `${entry.name} is in the catalogue twice`).toBe(false);
      seen.add(entry.kind);
      expect(entry.name.length, `prop ${entry.kind} has no name`).toBeGreaterThan(0);
    }
  });

  it('puts every entry in a group that is shown', () => {
    const shown = new Set(GROUPS.map((g) => g.group));
    for (const entry of CATALOGUE) {
      expect(shown.has(entry.group), `${entry.name} is in the group ${entry.group}, which is never shown`).toBe(true);
    }
  });

  it('calls a prop something a person would say out loud', () => {
    expect(nameOfProp(PropKind.HousePlains)).toBe('cottage');
    expect(nameOfProp(PropKind.Anvil)).toBe('anvil');
  });
});
