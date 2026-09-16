import { LIFE, type Person } from './people';
import type { Settlement } from './settlement';

/**
 * Somebody who walked into a village rather than being born into it.
 *
 * The hero, and for now nobody else. A village's people are grown from its seed — `settle` makes
 * the same twenty souls every time, which is the whole of why a world can be re-lived from a number
 * — and no seed can imply that a player walked over a hill on the fourteenth morning. So an arrival
 * is a **told** fact, kept and replayed, exactly as an oath, a vote and a violent death already are.
 *
 * That is also why this is a list rather than a person held somewhere: `relive` deletes a village
 * and founds it again from the seed, so anything not implied by the seed has to be re-told
 * afterwards or it simply stops existing. Memories, opinions and wounds are carried across by id;
 * a hero has no id to carry across until he has been put back.
 */
export interface Arrival {
  /** The name is the identity here, as it is for an oath — `SwornIn` keys on `who` for the same reason. */
  name: string;
  sex: Person['sex'];
  /** What he walked in with. The register's purse is the only purse he has. */
  purse: number;
  /** The morning he arrived, so a village lived again gets him on the same one. */
  day: number;
}

/** The id an arrival is given, which has to be the same one every time a village is lived again. */
export function idOf(village: string, arrival: Arrival): string {
  return `${village}:arrived:${arrival.name}`;
}

/**
 * The row an arrival stands up as.
 *
 * `born` is set so that he is an adult on the morning he arrives rather than a newborn — a hero who
 * had to grow up before anybody would talk to him would be a hero nobody could play. `lives` is
 * written because `Person` wants a number there and nothing reads it: `deathless` is what
 * `outOfDays` asks, and it answers before the arithmetic.
 *
 * No trade. He is not sworn to anything until he swears at a hall, which is `swearIn` and is the
 * same door a villager's oath goes through — and it is what makes a trade of his one the register
 * counts, rather than a word on a save file.
 */
export const GROWN = LIFE.CHILD_UNTIL + 4;

export function rowFor(village: string, arrival: Arrival, grown: number = GROWN): Person {
  return {
    id: idOf(village, arrival),
    name: arrival.name,
    village,
    sex: arrival.sex,
    trade: '',
    born: arrival.day - grown,
    // a number because `Person` wants one and nothing reads it — `deathless` answers `outOfDays`
    // before the arithmetic, and `stageOf` reads it only to decide he is not old yet
    lives: LIFE.LONGEST_LIFE,
    mother: '',
    father: '',
    knows: [],
    memories: [],
    opinions: [],
    purse: arrival.purse,
    hungry: 0,
    deathless: true,
  };
}

/**
 * Everybody who has walked into any village, and the two things anybody does with them.
 *
 * A book rather than a map on the register, for the reason `daybook.ts` gives about the same shape
 * of problem: `register.ts` is at the seven hundred lines the architecture test allows and has been
 * extracted three times for exactly this. What the register keeps is a door.
 */
export class Arrivals {
  private readonly byVillage = new Map<string, Arrival[]>();

  /**
   * Somebody walks in, is written down, and stands up on the roll.
   *
   * Nothing without a name, and nobody twice under one: a name is the identity here, exactly as it
   * is for an oath — `SwornIn` keys on `who` for the same reason — so two people called the same
   * thing in one village would be two rows nothing could tell apart afterwards.
   */
  walkIn(village: string, here: Settlement, of: Omit<Arrival, 'day'>, day: number): Person | null {
    const arrival: Arrival = { ...of, purse: Math.max(0, of.purse), day: Math.floor(day) };
    if (arrival.name === '' || here.people.some((p) => p.name === arrival.name)) return null;
    this.byVillage.set(village, [...(this.byVillage.get(village) ?? []), arrival]);
    const row = rowFor(village, arrival);
    here.people.push(row);
    return row;
  }

  /** Everybody who walked in anywhere, as told facts, for a save to write down. */
  all(): Array<Arrival & { village: string }> {
    return [...this.byVillage].flatMap(([village, some]) => some.map((one) => ({ ...one, village })));
  }

  /** Put this village's arrivals back after it has been founded again. See `walkThemIn`. */
  putBack(village: string, here: Settlement, upTo: number): void {
    walkThemIn(village, here, this.byVillage.get(village) ?? [], upTo);
  }
}

/**
 * Put everybody who walked in back on the roll of a village that has just been founded again.
 *
 * Only those who had arrived by the day being lived to, so a village re-lived to its tenth morning
 * does not have somebody standing in it who turns up on the fourteenth.
 *
 * Nobody is added twice: a village founded from its seed has no arrivals in it, and this is the one
 * place they are put back.
 */
export function walkThemIn(
  village: string, here: Settlement, arrivals: readonly Arrival[], upTo: number,
): void {
  for (const arrival of arrivals) {
    if (arrival.day > upTo) continue;
    if (here.people.some((p) => p.id === idOf(village, arrival))) continue;
    here.people.push(rowFor(village, arrival));
  }
}
