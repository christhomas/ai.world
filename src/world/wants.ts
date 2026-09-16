import { deathless, grownUp, type Person } from './people';

/**
 * Why a villager would ever walk over to you.
 *
 * Every interaction in this game begins with the player walking up to somebody. The pieces for the
 * reverse have been here for a while and none of them was the missing one: `behaviours/villagers.json`
 * already drops a mark and walks at the hero — *"which is what following is"* — so the tree language
 * can target him, and `memory.ts` keys an `Opinion` by name, so a villager could always have held a
 * view of anybody named. The only reason none held one of the hero is that he had no row, and #260
 * gave him one.
 *
 * What was missing was never machinery. It was a **reason**.
 *
 * ## The reason follows from the books
 *
 * The hero is the one who comes back from the dead. `shrine.ts` raises a villager once, rarely, at
 * the village's own expense, and what comes back is a blank stranger with no parents; `reckoning.ts`
 * raises the hero over and over, bills him for it, and he keeps everything he knows.
 *
 * So villagers ask *him* for the things nobody else can be asked — not because he is the player, but
 * because he is the one who will still be here next season and can be sent somewhere nobody comes
 * back from. That is a quest system falling out of the economy rather than sitting beside it.
 *
 * ## Nothing here is rolled
 *
 * A want is read off what somebody already is: their trade, and the day. A village's whole life is
 * drawn off one stream and a draw added to it re-rolls every village in every world — and a want
 * that moved when an unrelated village was founded would be a want nobody could reproduce. So two
 * machines agree about who walks over without a word passing between them, and a village re-lived
 * from its seed has the same people asking the same things on the same mornings.
 */

export interface Want {
  id: string;
  /** What they say when they reach you. */
  asks: string;
  /** Why this is a thing only the deathless can be asked, which is the whole of the design. */
  because: string;
  /** The trades that would have this want. Empty means anybody grown. */
  trades: readonly string[];
}

export const WANTS: readonly Want[] = [
  {
    id: 'barrow',
    asks: 'There is a barrow up on the ridge and nobody who goes in comes out. You would, though.',
    because: 'The one errand that is only sayable to somebody who has already died and come back. '
      + 'A neighbour cannot be asked this at any price, which is why it has never been asked before.',
    trades: [],
  },
  {
    id: 'wolf',
    asks: 'Something has been at the flock three nights running. I cannot sit out there and I cannot lose another.',
    because: 'A shepherd can lose his living to a thing he cannot fight, and the village cannot '
      + 'spare a man to sit in a field all night on the chance.',
    trades: ['farmer', 'hunter'],
  },
  {
    id: 'seam',
    asks: 'The lower seam has water in it. I need somebody down there who does not mind the dark.',
    because: 'A miner knows exactly how bad it is down there, which is the reason he is asking '
      + 'rather than going.',
    trades: ['miner', 'builder'],
  },
  {
    id: 'physic',
    asks: 'There is a herb that grows past the treeline and I have nobody to send for it.',
    because: 'A doctor with a patient cannot leave for two days, and the walk is the dangerous part '
      + 'rather than the picking.',
    trades: ['doctor', 'apothecary'],
  },
];

/** A want, and whose it is. */
export interface Wanting {
  who: Person;
  want: Want;
}

/**
 * How often somebody has something to ask, as one in this many days.
 *
 * Long, deliberately. A village where somebody stops you every morning is a village of shopkeepers
 * rather than a place — and the whole weight of an errand only somebody deathless can run comes
 * from its being rare enough to be remarkable.
 */
const AS_OFTEN_AS = 40;

/**
 * Which of these people has something to ask today.
 *
 * Derived rather than drawn: the name and the day decide it, so this answers the same on every
 * machine and on every re-living. A person's own name is the seed, which is also why two people of
 * the same trade in one village do not ask on the same morning.
 */
export function whoWantsSomething(people: readonly Person[], day: number): Wanting[] {
  const out: Wanting[] = [];
  for (const person of people) {
    if (deathless(person)) continue;            // he is the one being asked
    if (!person.trade || !grownUp(person, day)) continue;
    const mine = WANTS.filter((w) => w.trades.length === 0 || w.trades.includes(person.trade));
    if (mine.length === 0) continue;
    // a number off the name, so it is this person's own cycle rather than the village's
    let n = 0;
    for (const ch of person.name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    const season = Math.floor(day / AS_OFTEN_AS);
    if ((n + season) % AS_OFTEN_AS !== 0) continue;
    out.push({ who: person, want: mine[(n + season) % mine.length] });
  }
  return out;
}

/**
 * How badly somebody has to think of you before they would rather keep their trouble.
 *
 * Below this they do not come. Not a high bar: the ordinary case is a stranger asking a stranger,
 * because what is known about the hero — that he comes back — is known before anybody has an
 * opinion of him at all. What stops it is having been given a reason.
 */
const TOO_SOUR = -0.4;

/** Whether this person would bring this want to him, rather than keeping it to themselves. */
export function wouldBringItTo(who: Person, hero: string, _want: Want): boolean {
  if (hero === '') return false;
  const view = who.opinions.find((o) => o.who === hero);
  return (view?.regard ?? 0) > TOO_SOUR;
}

/**
 * Who the village would be asking, which is whoever on the roll cannot stay dead.
 *
 * A name rather than a row, because an `Opinion` is keyed by name and because a want needs nothing
 * else about him. Empty before he has arrived anywhere — a world nobody has walked into is a world
 * where nobody is asked anything, and that is the correct answer rather than a missing one.
 */
export function whoIsAsked(people: readonly Person[]): string {
  return people.find((person) => deathless(person))?.name ?? '';
}
