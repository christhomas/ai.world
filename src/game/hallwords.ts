import { tradeNamed } from '../entities/trades';
import { WORKS } from '../world/hall';
import { PROMOTIONS } from '../world/rank';

import type { Person } from '../world/people';

/**
 * What a hall says when you ask it something.
 *
 * `whatTheHallKnows` gathers the facts and deliberately leaves the words alone — *"the words
 * that wrap them are the game's business rather than this file's"*. This is that business, and it
 * is a separate file for the same reason: what a treasury *is* and how a building talks about it
 * are different subjects, and the second one changes far more often.
 *
 * ## Why a conversation rather than a panel
 *
 * Item 89: *"A building that answers questions is a much better interface than a panel about a
 * building."* The difference is not presentation. A panel is a thing the game shows you and has to
 * keep correct; a conversation is a thing you *ask*, so it can say **"nobody has told me"** — which
 * is the honest answer surprisingly often, and one a panel has no way to give. A village with no
 * watch has an empty tower, and the hall saying so out loud is the mechanic being visible.
 *
 * Four issues were waiting on something like this and none of them wanted a screen: a vacancy needs
 * somewhere to be read from, a contract needs a hall that can be a party to it, a directory needs a
 * place to be kept, and a vote needs a hall that exists to be voted for.
 */

/** What a hall is asked, which is what a person would ask standing in front of it. */
export interface Asked {
  holds: number;
  mayor: string;
  watch: string;
  raised: readonly string[];
  savingFor: string | null;
  directory: {
    holding: ReadonlyMap<string, readonly string[]>;
    nobodyDoing: readonly string[];
  };
}

/** Somebody by name, or a plain admission that the books do not say. */
function named(id: string, who: (id: string) => Person | null): string {
  const person = id === '' ? null : who(id);
  return person ? person.name : '';
}

/**
 * What it holds, said the way a clerk would rather than as a figure.
 *
 * Rounded to the coin, because a treasury that quotes fractions is an accountant and not a village.
 */
export function saidOfTheTreasury(holds: number): string {
  if (holds < 1) return 'The chest under the table is empty, and has been for a while.';
  return `${Math.floor(holds)} gold in the chest, which is the village's and nobody's.`;
}

/** Who speaks for the place, or that nobody does yet. */
export function saidOfTheMayor(mayor: string, who: (id: string) => Person | null): string {
  const name = named(mayor, who);
  return name === ''
    ? 'Nobody speaks for this village yet. It is not big enough to need anybody to.'
    : `${name} speaks for the village, being the longest settled of those who work.`;
}

/**
 * Who is on the tower tonight — and an empty tower is a real answer.
 *
 * A village that cannot pay the watchman's wage this morning has nobody up there, which is exactly
 * what running out of money looks like. Saying so is the whole reason this is a conversation: a
 * panel showing a blank field would read as a bug.
 */
export function saidOfTheWatch(watch: string, built: readonly string[], who: (id: string) => Person | null): string {
  if (!built.some((work) => work.startsWith('watchtower'))) {
    return 'There is no tower to stand on. It is the first thing a village buys that it would rather not have needed.';
  }
  const name = named(watch, who);
  return name === ''
    ? 'The tower is empty tonight. Nobody could be paid to stand on it.'
    : `${name} has the tower tonight, and is paid for it out of the chest.`;
}

/** What it is putting money by for, whether or not it can reach it yet. */
export function saidOfTheSaving(savingFor: string | null, holds: number): string {
  if (savingFor === null) return 'It is saving for nothing. There is nothing left it wants.';
  const ordinary = WORKS.find((work) => work.id === savingFor);
  const promotion = PROMOTIONS.find((vote) => vote.work === savingFor);
  const work = ordinary ?? promotion;
  if (!work) return 'It is saving for something nobody has written down, which is somebody\'s mistake.';
  const short = Math.max(0, Math.ceil(work.costs - holds));
  const near = short === 0 ? 'and it has enough' : `and it is ${short} short`;
  return `${work.note} ${work.costs} gold, ${near}.`;
}

/** What it has built, oldest first, or an honest nothing. */
export function saidOfWhatStands(raised: readonly string[]): string {
  const civic = raised
    .map((entry) => entry.split(/[:@]/)[0])
    .map((id) => WORKS.find((work) => work.id === id)?.id
      ?? PROMOTIONS.find((promotion) => promotion.work === id)?.work)
    .filter((id): id is string => id !== undefined);
  if (civic.length === 0) return 'Nothing yet. Every coin that has come in has gone back out on wages.';
  return `Standing, and paid for: ${civic.join(', ')}.`;
}

/** Who holds each trade, followed by the work for which the village has nobody. */
function saidOfTheDirectory(asked: Asked, who: (id: string) => Person | null): string[] {
  const working: string[] = [];
  for (const [trade, ids] of asked.directory.holding) {
    const names = ids.map((id) => named(id, who)).filter((name) => name !== '');
    if (names.length === 0) continue;
    working.push((tradeNamed(trade)?.label ?? trade) + ' — ' + names.join(', '));
  }
  const directory = working.length === 0
    ? 'The directory has no working names written in it.'
    : 'The directory reads: ' + working.join('; ') + '.';
  const vacant = asked.directory.nobodyDoing.map((trade) => tradeNamed(trade)?.label ?? trade);
  const vacancies = vacant.length === 0
    ? 'There are no vacancies on the village roll.'
    : 'Vacancies: ' + vacant.join(', ') + '. The hall is waiting for somebody to take the work.';
  return [directory, vacancies];
}

/** The hall's answers, in the order somebody standing in front of it would ask them. */
export function whatTheHallSays(asked: Asked, who: (id: string) => Person | null): string[] {
  return [
    saidOfTheTreasury(asked.holds),
    saidOfTheMayor(asked.mayor, who),
    saidOfTheWatch(asked.watch, asked.raised, who),
    saidOfTheSaving(asked.savingFor, asked.holds),
    saidOfWhatStands(asked.raised),
    ...saidOfTheDirectory(asked, who),
  ];
}
