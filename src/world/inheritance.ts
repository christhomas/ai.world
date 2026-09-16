import { whatTheEstateSettles } from './debts';
import { ownedBy } from './holdings';
import { grownUp, remember, surnameOf, type Person } from './people';
import type { Settlement } from './register';

/**
 * What a dead villager's purse does next, which until now was nothing at all.
 *
 * Measured over a hundred days across twenty-one villages: 18,617 gold went into the ground with
 * its owners, against 30,301 spent on living. Death was the largest single drain in this economy
 * and there was no inheritance anywhere in the world — so a village that had been settled for a
 * century was no better off than one founded last week, and the only thing holding the money
 * supply up was whatever the mines minted. A hundred years of a village changed nothing about it.
 *
 * The rule is the one a person would guess. What somebody held goes to their family in the same
 * village — an adult of their own surname first, because a household is what actually inherits,
 * and any relative at all if there is no grown one — and where there is nobody left of the name it
 * is shared out among everybody still living there. Nothing is ever destroyed and nothing is
 * created: the sum of every purse in a village is the same either side of a funeral, less whatever
 * the dead had already spent.
 *
 * Shared out rather than banked, because there is no village pot to bank it in. A `Settlement`
 * holds food, houses, trades and people, and inventing a treasury for this would be inventing a
 * thing nothing else in the game can see or spend. Sharing it puts the money where it can be
 * spent, which is what makes it show up as a second storey rather than as a number in a file.
 *
 * Called from `remove`, which is the single place every death in this world goes through — age,
 * hunger and violence alike — so there is no way to die that skips it.
 *
 * ## And what he owed
 *
 * The question this file could not answer until #240, because there was nothing in the world to
 * ask: it handed on what somebody held and said nothing whatever about what they owed. His debts
 * are paid out of his estate first, in the order he ran them up, and whatever it will not stretch
 * to dies with him — see `whatTheEstateSettles`, where the argument is. It is money that stays in
 * the village either way, so the rule above is untouched: the sum of every purse here is the same
 * either side of a funeral. It has merely stopped being the heir's alone.
 *
 * `left` is still the whole of what came out of his purse rather than only the heir's share, and
 * that is deliberate. The parish stone answers "what did this death do to the village's money",
 * which `chore test economy` reads to prove nothing was buried with him — and a creditor standing
 * in the churchyard is as much in the village as an heir is.
 */
export function handOnWhatTheyHad(person: Person, village: Settlement, day: number): { left: number; to: string } {
  const owing = Math.round(person.purse * 100) / 100;
  if (owing <= 0 || village.people.length === 0) return { left: Math.max(0, owing), to: '' };
  person.purse = 0;

  // his creditors before his family, out of what he left and no further
  const paid = whatTheEstateSettles(village.debts ?? [], ownedBy(person), owing, village.people);
  village.debts = paid.left;
  for (const creditor of village.people) {
    const much = paid.owed.get(ownedBy(creditor));
    if (much) creditor.purse += much;
  }
  const estate = paid.over;
  if (estate <= 0) return { left: owing, to: '' };

  const name = surnameOf(person);
  const family = name ? village.people.filter((p) => surnameOf(p) === name) : [];
  const grown = family.filter((p) => grownUp(p, day));
  /*
   * The widow or widower first, then the household.
   *
   * This file has always said what it wanted — "an adult of their own surname first, because a
   * household is what actually inherits" — and had to guess at it from a name. Since #242 a spouse
   * is stated, so the guess becomes a fact and the surname stays as the fallback it always was.
   */
  const widowed = person.spouse
    ? village.people.find((p) => p.name === person.spouse && p.id !== person.id) ?? null
    : null;
  const heir = widowed ?? grown[0] ?? family[0] ?? null;
  if (heir) {
    heir.purse += estate;
    remember(heir, { what: 'inherited', who: person.name, day });
    return { left: owing, to: heir.name };
  }

  // nobody of the name is left, so the village has it. Rounded down a share at a time with the
  // remainder going to the first of them, because a hundredth of a coin that nothing can spend is
  // money quietly leaving the world through the back door — which is the fault this whole
  // function exists to close.
  const share = Math.floor((estate / village.people.length) * 100) / 100;
  let over = estate;
  for (const survivor of village.people) { survivor.purse += share; over -= share; }
  village.people[0].purse += Math.max(0, Math.round(over * 100) / 100);
  return { left: owing, to: '' };
}
