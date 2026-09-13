import { describe, expect, it } from 'vitest';
import { THE_HALL, isTheHall, type Owner } from './holdings';

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
    const mine: Owner = 'Ashford-3-0';
    const ours: Owner = THE_HALL;
    expect(isTheHall(ours)).toBe(true);
    expect(isTheHall(mine)).toBe(false);
  });

  /*
   * The question every caller was being left to ask itself, asked once here instead. `pay` walking
   * a list of people and silently ignoring the one name that is not a person is the failure this
   * exists to make unwritable.
   */
  it('tells a person from the village without anybody matching a magic string', () => {
    const owners: Owner[] = ['Ashford-1-0', THE_HALL, 'Ashford-2-0'];
    expect(owners.filter(isTheHall)).toHaveLength(1);
    expect(owners.filter((o) => !isTheHall(o))).toEqual(['Ashford-1-0', 'Ashford-2-0']);
  });
});
