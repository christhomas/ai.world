import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kindOf, type SessionSave, type WorldKind } from '../save/store';
import { nameOf } from './title';

/**
 * The world type decides the whole terrain: the same seed grows two completely different
 * countries. So it has to be chosen when a world is made and honoured for ever afterwards —
 * reopening one as the other kind would put the ground somewhere else underneath a house, a
 * planted field, and every dungeon and island anchor the manifest is holding.
 *
 * There is one kind of world now, and this is what is left of that: a save that names the other one
 * still opens, as the country that exists.
 */

/** What the title screen does when a slot is taken: the save's own kind, whatever else is asked for. */
function continuing(save: SessionSave): WorldKind {
  return kindOf(save.world);
}

describe('which world a save is in', () => {
  it('migrates every bounded save into the country that remains', () => {
    expect(continuing({ seed: 1, world: 'mesh' } as unknown as SessionSave)).toBe('endless');
    expect(continuing({ seed: 1, world: 'road' } as unknown as SessionSave)).toBe('endless');
  });

  it('migrates a save made before the choice existed', () => {
    expect(continuing({ seed: 1 } as SessionSave)).toBe('endless');
  });

  it('keeps an endless world endless, which is the whole reason the field exists', () => {
    /*
     * The mistake this prevents cannot be undone afterwards. A world written as an endless one and
     * read back as a road world puts a house, a sown field and every anchor in the manifest
     * somewhere that is now open sea, and there is nothing left in the save that says which of the
     * two it meant. So the kind is written down before the game can even grow one on purpose.
     */
    expect(continuing({ seed: 1, world: 'endless' } as SessionSave)).toBe('endless');
  });
});

describe('choosing a country before you go into it', () => {
  it('offers no switch for a world kind when only one country remains', () => {
    /*
     * This guards the *world kind*, which is the choice that cannot be undone: a world written as
     * endless and read back as a road world puts every anchor in open sea. It is not a rule against
     * the title screen having any switch at all — #250 put one there for the render path, under
     * `titleExtras`, and that one is safe to change on any morning because it decides nothing that
     * is written down.
     *
     * So this asks the narrower question it always meant: no control for which country.
     */
    const source = readFileSync('src/ui/title.ts', 'utf8');
    expect(source).not.toContain('worldKind');
    expect(source).not.toContain('role="switch"');
    expect(source, 'a world kind is not a thing to offer twice').not.toMatch(/endless[^\n]*road|road[^\n]*endless/);
  });

  it('names every save as the one country that remains', () => {
    expect(nameOf('endless')).toBe('endless country');
    expect(nameOf('road' as unknown as WorldKind)).toBe('endless country');
    expect(nameOf(undefined)).toBe('endless country');
  });
});
