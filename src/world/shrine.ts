import { GROWTH } from './growth';
import { LIFE, familyName, givenName, sexAtBirth, type Person, type Sex } from './people';
import type { Change, Settlement } from './settlement';

/**
 * A soul raised at a shrine, which is the one way a dead valley comes back.
 *
 * Everything else that puts a person into this world is the world's own doing: children are born to
 * parents, and somebody walks over the hill from the next village along (`movingon.ts`). Both of
 * those need a village with people already in it. Walk into a place where everybody starved and
 * there is nothing whatever to be done about it — and in an endless country that is a question the
 * map will keep asking, because there will always be another valley that did not make it.
 *
 * So there is magic, and it is deliberately the only magic in the economy. What keeps it from being
 * a tap is the price: a house, rather than a meal. That is not a figure picked to feel expensive —
 * it is `GROWTH.A_HOUSE`, what a village pays its own people to raise a roof, so the fee is the cost
 * of a life's worth of shelter and it moves when that moves.
 *
 * ## Why it is recorded rather than simply done
 *
 * A village is re-lived from its founding whenever anybody learns something new about its past, so
 * anything that cannot be worked out from the seed has to be written down or it vanishes the next
 * time somebody walks in. A violent death is already kept that way. A raising is the same kind of
 * fact: nothing about the seed implies it, and the register replays it the way it replays a killing.
 *
 * What the fact *is* is only the day. Who it brought is worked out from the village and the day, so
 * the person is derived like everybody else and two machines that know a raising happened raise the
 * same person.
 */

/** What it costs to raise one, in gold. */
export const SHRINE_FEE = GROWTH.A_HOUSE;

/**
 * Who the shrine sent, given the village and the day it was asked.
 *
 * A grown adult rather than an infant, because a valley with nobody in it cannot raise a child —
 * and because somebody who arrives needing twenty years of feeding is not an answer to an empty
 * village, it is a second problem. They arrive at the age somebody leaves home at, with a life ahead
 * of them of the ordinary length.
 *
 * No parents, and that is the interesting part rather than an omission: this person is the first of
 * their family anywhere. When a face is inherited (**57**), a shrine-raised villager is where a new
 * face enters a valley that has been marrying its own children to each other for four hundred days.
 */
export function whoTheShrineSent(village: string, day: number, rng: () => number, taken: readonly string[]): Person {
  const id = `raised:${village}:${Math.floor(day)}`;
  const sex: Sex = sexAtBirth(Math.floor(day), id);
  return {
    id,
    name: `${givenName(rng, taken, sex)} ${familyName(rng, taken)}`,
    village,
    sex,
    trade: '',                                   // the village enrols them, the way it does anybody
    born: Math.floor(day) - LIFE.CHILD_UNTIL,    // grown, and no older than they have to be
    lives: Math.round(LIFE.SHORTEST_LIFE + rng() * (LIFE.LONGEST_LIFE - LIFE.SHORTEST_LIFE)),
    mother: '', father: '',
    knows: [], memories: [], opinions: [],
    // and nothing in their pockets: what the shrine makes is a person, not an estate
    purse: 0, hungry: 0,
  };
}

/**
 * Whoever the shrine raised here today, added to the village.
 *
 * Replayed rather than remembered as people, exactly as a killing is: the day is the fact, and who
 * it brought is worked out from the village and the day. So a village re-lived from its founding
 * raises the same soul on the same morning, and two machines that both know the magic was paid for
 * end up holding the same person.
 *
 * The stream is handed in because it is the register's: one village on one day, so that villages
 * never share rolls and a raising cannot shift anybody else's luck.
 */
export function raiseWhoIsDue(
  name: string, village: Settlement, day: number, stream: () => number,
): Change[] {
  const changes: Change[] = [];
  for (const on of village.raised) {
    if (Math.floor(on) !== Math.floor(day)) continue;
    const taken = village.people.map((person) => person.name);
    const soul = whoTheShrineSent(name, day, stream, taken);
    if (village.people.some((person) => person.id === soul.id)) continue;
    village.people.push(soul);
    // and the place stops being a ruin, which is the whole of what the fee bought
    village.emptied = undefined;
    changes.push({ kind: 'born', id: soul.id, name: soul.name, village: name, day: Math.floor(day) });
  }
  return changes;
}