import type { Opinion } from './memory';
import { remember, type Memory, type Person } from './people';

/**
 * What a villager remembers, and how it gets to them.
 *
 * Out of `register.ts` because it is the one thing about a villager that is *not* derived. Who
 * lives in a place, what they do, when they die and who their parents were all follow from the seed
 * and a short list of deaths — every client works them out and arrives at the same village. What a
 * man thinks of *you* follows from what you did, and what you did happened on your screen.
 *
 * So this is the half that has to travel, and these are its three doors: something happened
 * (`recall`), here is everything he holds (`told`), and who knows him (`knownTo`).
 */

/**
 * Something happened that one of these people will not forget.
 *
 * A client with no world behind it calls this on its own register and *is* the world, which is what
 * playing alone is.
 *
 * @returns whether there was anybody of that name still alive to remember it
 */
export function recallFor(
  person: Person | undefined, what: Memory['what'], about: string, day: number,
): boolean {
  if (!person) return false;
  remember(person, { what, who: about, day: Math.floor(day) });
  return true;
}

/**
 * What the world says one of these people holds, put back where a conversation will find it.
 *
 * It replaces rather than merges, because the world's copy is the whole of what he holds by
 * definition: anything this client thought he remembered and the world does not is a thing this
 * client made up.
 */
export function toldOf(person: Person | undefined, mind: { memories: Memory[]; opinions: Opinion[] }): void {
  if (!person) return;
  person.memories = [...mind.memories];
  person.opinions = [...mind.opinions];
}

/** Everybody in a village who has met somebody, which is who a conversation about them can start with. */
export function whoKnows(people: readonly Person[], id: string): Person[] {
  return people.filter((person) => person.knows.includes(id));
}

