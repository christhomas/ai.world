import { remember, type Memory, type Person, type Remembering } from '../world/people';
import type { Rng } from '../core/rng';
import type { Register } from '../world/register';
import type { Village } from '../world/structures';
import type { TheBook } from './wildlife';

/**
 * The villagers, from this side of the wire.
 *
 * They belong to the world now — it grows them, walks them, pays them and buries them — and this is
 * the little that is left over on a page: opening a village in this page's own copy of the book so
 * that a man the world names has a family behind him, and getting a memory made here back to the
 * world that owns the man it happened to.
 *
 * Two functions, and they are the two directions. Everything else about a villager needs neither:
 * who lives where, what they do, when they die and what a village is worth are all worked out from
 * the seed and a short list of deaths on every machine at once, which is why a villager crosses as
 * an id rather than as a person.
 */

/**
 * This page's copy of the book, and how a village is opened in it.
 *
 * Nothing on this side puts villagers into a street any more, and it was the putting-out that used
 * to found the village — `residentsOnTheStreet` called `settle` on the way past. So without this the
 * register would never hear of a place at all, and every villager the world sent would arrive as a
 * body with a name and nothing behind it: no mother, no neighbours, no stones in the churchyard.
 *
 * The trades come from the world rather than being read off the land here, and that is not
 * fussiness. Which trades a village can offer depends on what is around it — a shore only where
 * there is water, heights only where the ground climbs — so the answer depends on how much country
 * the reader has actually grown, and a page holds a hundred and twenty-one chunks where the world
 * holds seven. The founding rolls off that list. Read it here and the same village comes out with
 * different names on the same people.
 */
export function bookOf(register: Register, villages: readonly Village[]): TheBook {
  return {
    register,
    settle: (village, trades) => {
      const here = villages.find((one) => one.name === village);
      // an empty list is a world that has not founded the place yet, and following it would found a
      // village of people with no trades at all
      if (!here || trades.length === 0) return;
      register.foundOn(here.name, here.houses.length, trades);
    },
  };
}

/**
 * Something happened that a villager will not forget: put it in his head, and say so out loud.
 *
 * The one door out of this page for a memory, and there is one of it because there has to be one
 * owner. What a man thinks of *you* is the only thing about him that no machine could work out for
 * itself — it follows from what you did, and what you did happened on your screen — so a world that
 * is not told is a world where the man you handed an apple to is a different man on every other
 * screen.
 *
 * It is done here as well as said, and in that order, for two reasons. A villager who warms to you a
 * third of a second after you give him something did not notice you giving it to him. And a page
 * with no world listening *is* the world, so the saying is silence and the doing is the whole of it
 * — which is what keeps this game playable with nothing behind it.
 */
export function tellingTheWorld(
  say: (who: string, what: Memory['what'], about: string) => void,
): Remembering {
  return (person, memory) => {
    remember(person, memory);
    say(person.id, memory.what, memory.who);
  };
}

/**
 * Somebody's camp on the road has been gone through, and the nearest village hears about it.
 *
 * The village nearest to it owns the news, which is not a rule so much as an observation: nobody
 * carries a story past the first place they can tell it. One person hears — a village is twenty
 * people who carry each other's news, so one is enough for it to reach you when you next stop to
 * talk — and it is the *victim* the memory names, not whoever did it, which is why `memory.ts`
 * gives a robbery no weight at all. It is news rather than a judgement.
 */
export function wordOfARobbery(
  villages: readonly Village[], register: Register, recall: Remembering,
  camp: { x: number; z: number; who: string }, day: number, rng: Rng,
): void {
  const near = villages.reduce((best, v) =>
    Math.hypot(v.x - camp.x, v.z - camp.z) < Math.hypot(best.x - camp.x, best.z - camp.z) ? v : best);
  const folk: readonly Person[] = register.living(near.name);
  if (folk.length === 0) return;
  recall(folk[Math.floor(rng() * folk.length)], { what: 'robbed', who: camp.who, day });
}
