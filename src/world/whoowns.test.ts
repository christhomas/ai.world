import { describe, expect, it } from 'vitest';
import { THE_HALL, THE_HALL_OWNER, isTheHall, ownedBy, ownerFromSave, type Owner } from './holdings';

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
 *
 * ## Why these assertions have no `expect` in them
 *
 * They used to read `holdings.ts` and match its source against a regular expression, which
 * Greptile objected to on #80 and was right about: making the brand optional would still match
 * `export type Owner = string & {` while letting bare strings back in, and the test would have
 * gone on passing. It was checking the spelling of a claim rather than the claim.
 *
 * `@ts-expect-error` checks the claim. It is an assertion made to the compiler, and it fails the
 * build in *both* directions — if the line below ever compiles, the directive is unused and `tsc`
 * says so. So a brand that stopped being a brand turns this file red, which is the whole point of
 * writing it down. `tsconfig.json` includes `src`, so these are checked by `pnpm typecheck` on
 * every run, and the vitest cases around them are what make somebody open this file and read them.
 */
describe('an owner cannot be written by hand', () => {
  it('refuses a bare string where an owner is wanted', () => {
    // @ts-expect-error a villager's id is a string until somebody says whose it is
    const guessed: Owner = 'Ashford-3-0';
    // @ts-expect-error and the hall's name is a string like any other
    const hall: Owner = THE_HALL;
    // the runtime half is unremarkable and says so: both of them are the strings they look like,
    // which is exactly why nothing but the compiler could have caught the difference
    expect([guessed, hall]).toEqual(['Ashford-3-0', THE_HALL]);
  });

  it('has two doors an owner can come through, and they are the only two', () => {
    const fromTheRegister: Owner = ownedBy({ id: 'Ashford-3-0' });
    const fromASave: Owner = ownerFromSave('Ashford-3-0');
    expect(fromTheRegister).toBe(fromASave);
    // and nothing a caller can assemble itself gets in: not a template of the right shape,
    // not a string that has been round the wire, not the village's own name
    // @ts-expect-error
    const built: Owner = `Ashford-${3}-${0}`;
    expect(built).toBe(fromASave);
  });

  /*
   * The door the money goes through, which is where this branding was actually for.
   *
   * `pay` used to take `ReadonlyMap<string, number>` and turn every key into an `Owner` on the way
   * in, so a mistyped destination was a compile-clean way to lose coins: an unknown id lands in
   * `unplaced` and the village is quietly short. The map is keyed by `Owner` now, so the question
   * is asked where the money is named rather than where it is spent.
   */
  it('is what a payment is addressed to', () => {
    const owed = new Map<Owner, number>([[ownedBy({ id: 'Ashford-1-0' }), 5], [THE_HALL_OWNER, 3]]);
    // @ts-expect-error a name nobody has vouched for cannot be paid
    owed.set('Ashford-1-0', 7);
    expect([...owed.values()]).toEqual([7, 3]);
  });
});
