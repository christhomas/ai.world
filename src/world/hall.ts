import { PROSPER } from './prosperity';
import { LIVELIHOOD } from './livelihoods';
import type { Person } from './people';

/**
 * The village's own money: what the hall takes, and what makes it different from a purse.
 *
 * `inheritance.ts` turned a treasury down when it went in, and said why in as many words — there
 * was no pot to bank anything in, and inventing one would have been inventing a thing nothing in
 * the game could see or spend. A hall is somewhere to keep it and a vote is something to spend it
 * on, so there is a pot now, and this is the whole of how it fills.
 *
 * Its own file rather than more of `livelihoods.ts`, because it is a different subject: that one is
 * the four ways a villager earns a living, and this is the one place money stops being anybody's.
 */

/**
 * What the hall takes, and from whom.
 *
 * A tax is not a new machine. Money already moves between villagers every day — a dinner paid for,
 * a keep bought, a beast sold — and it moves as a map of who gains and who loses that the register
 * applies in one place. This is another entry in that map, and the only new thing about it is where
 * the money goes: into the village rather than into another purse.
 *
 * Which is the whole point of it. What the hall holds is not anybody's. A mayor who dies leaves it
 * exactly where it was for whoever is elected next, where a *person's* purse is inherited by their
 * family the day they are buried — see `handOnWhatTheyHad`. Putting the treasury on the mayor would
 * be putting a village's harbour money into a dead man's estate.
 *
 * Taken off what somebody *holds* rather than what they earned, because a day's earnings can be
 * negative here and a tax that hands money back on a bad day is a subsidy. Above `KEEPS_BACK` only:
 * that reserve is a week of dinners, and a village that taxes its people into starving has
 * mistaken the point of having a village.
 */
export function taxOn(person: Person): number {
  const spare = person.purse - PROSPER.KEEPS_BACK;
  if (spare <= 0) return 0;
  // rounded to a hundredth, the way every other coin in this economy is, so that a village's purse
  // and the purses it came out of still add up to what they did this morning
  return Math.round(spare * LIVELIHOOD.TAX * 100) / 100;
}

export function taxedForTheHall(people: readonly Person[]): { owed: Map<string, number>; raised: number } {
  const owed = new Map<string, number>();
  let raised = 0;
  for (const person of people) {
    const much = taxOn(person);
    if (much <= 0) continue;
    owed.set(person.id, -much);
    raised += much;
  }
  return { owed, raised: Math.round(raised * 100) / 100 };
}

