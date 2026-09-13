import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THE_HALL, THE_HALL_OWNER, isTheHall, ownerFromSave, type Owner } from './holdings';

/**
 * Who owns a thing, as a type rather than as a string nobody has to read.
 *
 * Item 89. A holding's `owner` and a posting's `funder` are `string`, and the value in them is
 * either a villager's id or the literal `'the hall'` — so every place that touches one has to
 * remember, unaided, that the village itself is among the answers. `pay` did not, and dropped the
 * entry on the floor: twelve coins named, five landed, no test anywhere the wiser.
 *
 * A string cannot help with that. `Owner` can: a union of a person's id and the hall, so the
 * compiler asks the question at every site instead of trusting each author to ask it of themselves.
 * This is the type-level half of "the hall is a villager who happens to be an unmoving building" —
 * the half that does not wait on deciding what its body is (**91**).
 */
describe('who a thing belongs to', () => {
  it('is either somebody, or the village itself, and nothing else', () => {
    const mine: Owner = ownerFromSave('Ashford-3-0');
    const ours: Owner = THE_HALL_OWNER;
    expect(isTheHall(ours)).toBe(true);
    expect(isTheHall(mine)).toBe(false);
  });

  /*
   * The question every caller was being left to ask itself, asked once here instead. `pay` walking
   * a list of people and silently ignoring the one name that is not a person is the failure this
   * exists to make unwritable.
   */
  it('tells a person from the village without anybody matching a magic string', () => {
    const owners: Owner[] = [ownerFromSave('Ashford-1-0'), THE_HALL_OWNER, ownerFromSave('Ashford-2-0')];
    expect(owners.filter(isTheHall)).toHaveLength(1);
    expect(owners.filter((o) => !isTheHall(o))).toEqual(['Ashford-1-0', 'Ashford-2-0']);
  });
});

/**
 * And the thing the doc comment has been claiming since it was written.
 *
 * `Owner` was `type Owner = string` while the comment above it said the point was that *"the
 * compiler asks the question at every site instead of trusting each author to ask it of
 * themselves"*. A bare alias of `string` asks nothing: every one of the sites that used to match
 * `THE_HALL` by hand still could, and `isTheHall` was a convention rather than a check.
 *
 * That convention had already failed once — seven places matched the magic string, `pay` forgot
 * one, and five coins went to a person id that did not exist. `purses.ts` closed that at runtime.
 * This closes it at build time, which is where it was claimed to be closed all along.
 */
describe('an owner cannot be written by hand', () => {
  it('refuses a bare string where an owner is wanted', () => {
    // the assertion is the compiler's, so this reads the source rather than running anything: a
    // brand that stopped being a brand would make every line below compile again and say nothing
    const holdings = readFileSync('src/world/holdings.ts', 'utf8');
    expect(holdings, 'a bare alias asks nothing of anybody').not.toMatch(/export type Owner = string;/);
    expect(holdings).toMatch(/export type Owner = string & \{/);
  });

  it('has exactly two doors an owner can come through', () => {
    // one for somebody on the register and one for a string off a save or the wire. A third would
    // be a way to make an owner without saying which of the two it is, which is the whole fault
    const holdings = readFileSync('src/world/holdings.ts', 'utf8');
    const casts = [...holdings.matchAll(/as Owner\b/g)];
    expect(casts.length, 'every cast is a place the compiler stopped asking').toBeLessThanOrEqual(3);
  });
});
