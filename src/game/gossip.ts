import type { Rng } from '../core/rng';
import { ageOf, stageOf, surnameOf, type Person } from '../world/people';
import type { Register } from '../world/register';

/**
 * What a villager will tell you about themselves and the people around them.
 *
 * This is the only way anybody finds out that somebody has died. There is no book of the dead and
 * no notice board: a village keeps its losses in the heads of the people who knew them, so you
 * hear about Greta Vos because you asked Tomas Vos how he was, and if nobody who knew her is
 * still alive then she is simply gone.
 *
 * Every line is drawn from the register rather than a list of sayings, which is what makes a
 * conversation in one village different from the same conversation in the next.
 */

/** How recently something has to have happened for it to be the first thing somebody says. */
const STILL_RAW = 4;

export interface Gossip {
  /** The one thing they most want to tell you, or nothing much. */
  news: string | null;
  /** Everything else they might say, in the order a conversation would reach for it. */
  small: string[];
}

export function gossipFor(person: Person, register: Register, day: number, rng: Rng): Gossip {
  const fresh = person.memories.filter((m) => day - m.day <= STILL_RAW);
  const recent = fresh[0];
  const hardWeek = fresh.filter((m) => m.what === 'died').length > 1;
  return {
    news: recent ? newsOf(recent.what, recent.who, day - recent.day, hardWeek) : null,
    small: [...family(person, register), ...acquaintances(person, register, rng), ...aboutThemselves(person, day)],
  };
}

/**
 * The thing that happened, said the way somebody says it days afterwards. Somebody carrying two
 * deaths at once says so; somebody carrying one does not pretend the village is falling apart.
 */
function newsOf(what: string, who: string, daysAgo: number, hardWeek: boolean): string {
  const when = daysAgo <= 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days back`;
  switch (what) {
    case 'died': return `You will not have heard. ${who} died ${when}.${hardWeek ? ' It has been a hard week here.' : ''}`;
    case 'born': return `${who} was born ${when}. Loudest thing in the village, that one.`;
    case 'saved': return `${who} pulled me out of trouble ${when}. I owe them for it.`;
    case 'robbed': return `${who} was robbed on the road ${when}. Keep your purse close.`;
    case 'given': return `${who} gave me something I had need of ${when}. Not many stop to.`;
    // the mine, not a person: a bad day at the face is news the same way a death is, and it is
    // the only way anybody ever hears about a mine they have not walked into
    case 'feared': return `Something happened down ${who} ${when}. There are men who will not go back.`;
    default: return `Something happened with ${who} ${when}.`;
  }
}

/** Who they belong to. A villager with no parents left says so, which is its own kind of news. */
function family(person: Person, register: Register): string[] {
  const said: string[] = [];
  const living = register.living(person.village);
  const nameOf = (name: string): boolean => living.some((p) => p.name === name);

  if (person.mother !== '' && nameOf(person.mother)) said.push(`My mother is ${person.mother}. You will find her about the village.`);
  else if (person.mother !== '') said.push(`My mother was ${person.mother}. She is gone now.`);

  const kin = living.filter((p) => p !== person && surnameOf(p) === surnameOf(person));
  if (kin.length > 0) said.push(`We are the ${surnameOf(person)}s — ${kin.map((p) => p.name.split(' ')[0]).join(', ')} and me.`);
  return said;
}

/** Somebody worth going to see, which is how a village points you at the rest of itself. */
function acquaintances(person: Person, register: Register, rng: Rng): string[] {
  const known = person.knows.map((id) => register.find(id)).filter((p): p is Person => p !== undefined);
  if (known.length === 0) return ['I keep to myself, mostly.'];

  const friend = known[Math.floor(rng() * known.length)];
  if (friend.trade === '') return [`${friend.name} is always underfoot. Good sort, though.`];
  return [`If you want a ${friend.trade}, ${friend.name} is your one.`];
}

/** Their own life, which is mostly their age and their work. */
function aboutThemselves(person: Person, day: number): string[] {
  const stage = stageOf(person, day);
  if (stage === 'child') return ['I am not allowed past the fence yet.'];
  if (person.trade === '') return ['I have not settled to anything yet.'];
  return [`${ageOf(person, day)} days I have been at this. Long enough to be tired of it.`];
}
