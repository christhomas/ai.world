import { stageOf, type Person } from '../world/people';
import type { Register } from '../world/register';

/**
 * A person and the line above them, in the shape a face wants.
 *
 * Declared here rather than imported from `ui/dialogue`, and the reason is the layer rule rather
 * than taste: `game/` may not lean on `ui/`, and a type import is still a direction. TypeScript is
 * structural, so this *is* a `Speaker['from']` to anybody assigning it one, without this file
 * knowing that such a thing exists.
 */
export interface Descended {
  id: string;
  trade: string;
  stage: 'adult' | 'child';
  from?: { mother?: Descended; father?: Descended };
}

/**
 * Who somebody came from, for the half of a face that is passed down rather than rolled.
 *
 * Every face in this world was `hash(id)` and nothing else, so a child's face had nothing to do
 * with its mother's — and the register has drawn mothers and fathers since the beginning and says
 * which is which. The information was there the whole time and no face had ever asked for it.
 *
 * It is here rather than in `talk.ts` because it is a different subject: that file is what somebody
 * says to you, and this is who they came from. It is in `game/` rather than `ui/` because the
 * register is the only thing that knows anybody's mother and nothing in `ui/` may go looking for
 * one — so the descent is resolved on this side and handed over already answered.
 *
 * ## Why it matters more than a nicer face
 *
 * A village left alone marries its own children to each other for four hundred days. Somebody
 * arriving from three valleys away is new blood, which is the whole point of item 57 — and new
 * blood is a sentence in a book unless a player can *see* it. A family that does not look like the
 * rest of the street is resettlement made visible, and it is the only part of that item anybody
 * would notice without opening the register.
 */

/**
 * How many generations back a face is resolved.
 *
 * Four, and the bound is not fussiness: a register four hundred days old can hand back a line
 * longer than anybody will ever look at, and every generation is a pair of lookups on a path that
 * runs when a conversation opens. Four is already more than the eye can follow — a
 * great-great-grandparent's nose is not a thing anybody is going to spot across a square.
 */
const BACK = 4;

/**
 * The line above this person, as far as the register still holds it.
 *
 * A `Speaker` for each parent rather than an id, because the features that are passed down want the
 * parents' own *faces*, and a parent's face is built exactly the same way — which is how a
 * grandchild comes to resemble a grandparent rather than only a parent.
 *
 * Nothing at all for a founder, whose parents were never on any register, or for anybody it has
 * since forgotten. That is a right answer rather than a missing one: a founder's face is the one
 * their id has always given them, and repainting the world was never asked for.
 */
export function whoTheyCameFrom(
  person: Person, register: Register | undefined, day: number, back = BACK,
): { mother?: Descended; father?: Descended } | undefined {
  if (!register || back <= 0) return undefined;
  const of = (id: string): Descended | undefined => {
    const them = id !== '' ? register.find(id) : undefined;
    if (!them) return undefined;
    return {
      id: them.id, trade: them.trade, stage: stageOf(them, day) === 'adult' ? 'adult' : 'child',
      from: whoTheyCameFrom(them, register, day, back - 1),
    };
  };
  const mother = of(person.mother);
  const father = of(person.father);
  return mother || father ? { mother, father } : undefined;
}
