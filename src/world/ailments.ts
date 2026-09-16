import { ownedBy, type Owner } from './holdings';
import type { Person } from './people';
import { ableToWork, doctoredBy, WOUND } from './wounds';

/**
 * People fall ill, which until now nobody in this world ever did.
 *
 * `Person` has had `hurt` since item 96 and `wounds.ts` has mended it ever since, and nothing in
 * the running game ever set it: the only writer is `Register.hurt` and its only callers were that
 * file's own tests. Violence goes straight from `consequences.ts` to `bury`. So a villager had two
 * conditions — alive and buried — the middle one was unreachable, and the doctor, who draws a
 * trader's wage out of `PROSPER.TRADERS` every day of his life, had no patients at all.
 *
 * Hunger was this economy's one way to hurt a village. Illness is the second, and it is a different
 * shape from the first: hunger is a village's books going wrong, and a fever is one person's week
 * going wrong while the books are perfectly fine. That is the thing a doctor is for, and it is why
 * a village pays one to stand about in a year when nobody is attacked by anything.
 *
 * ## What is deliberately not here
 *
 * **Spread.** One person's fever does not raise anybody else's chance. It is the largest question
 * in the item that asked for this and it is a different kind of rule — a per-person number becomes
 * something that moves across a map, and a village that can lose half its people in a fortnight
 * needs the balance argument made on purpose rather than as a side effect of adding a die roll.
 *
 * **A door on the register.** `hurt` needs one because violence is *told*: a wolf on somebody's
 * screen is not a thing a re-lived village can work out for itself. A daily roll is not told, it is
 * lived — a village re-founded from its seed falls ill on exactly the same mornings — so there is
 * no fact here that needs preserving, and inventing one would mean inventing the bug where it gets
 * out of step with what re-living produces.
 */

export const AILMENT = {
  /**
   * The chance somebody wakes up ill, per person per day.
   *
   * A villager lives sixty to ninety days, so this is somewhere between one and two illnesses in a
   * lifetime. Enough that a village with a doctor is visibly steadier than one without, which is
   * the whole argument; rare enough that the common case for any given morning is still that
   * everybody gets up and goes to work.
   */
  A_DAY: 0.012,
  /**
   * The longest anybody is in bed, in days.
   *
   * Longer than `WOUND.WORST`, deliberately. A wound is an afternoon that went badly and then heals
   * on a schedule; a fever is a thing that has to run out. Eight days is most of a fortnight of
   * somebody not earning, which is enough for a household to feel it.
   */
  WORST: 8,
  /**
   * What a bath house takes off the chance, as a share.
   *
   * The village hall has been buying bath houses for 6200 gold since item 88 — the most expensive
   * thing on the list and, until now, *the only one that did nothing*. `hall.ts` calls it "what a
   * village builds when it has run out of things it needs", and it staffed a bath keeper and put a
   * prop on a plot and changed no number anywhere.
   *
   * Two fifths, which is large enough to be worth 6200 gold over the life of a village and small
   * enough that a bathed village still wants a doctor.
   */
  BATHS_SAVE: 0.4,
} as const;

/**
 * Whether somebody can do a day's work — the one question the rest of the economy asks.
 *
 * Both conditions, because from the village's side they are the same fact: a man in bed earns
 * nothing and the village earns nothing by him. He still eats, and still pays for his dinner out of
 * whatever he had, which is what makes a bad week expensive rather than fatal.
 *
 * Here rather than beside `ableToWork` in `wounds.ts` because `wounds.ts` answers for wounds. Every
 * caller in the economy wants this one.
 */
export function wellEnough(person: Person): boolean {
  return ableToWork(person) && (person.ill ?? 0) <= 0;
}

/**
 * How long a fever lasts *once caught*, given whether anybody in the village can treat it.
 *
 * At least one day, always. Severity decides how bad a thing somebody has caught, not whether they
 * caught it — that question was already answered by the roll before this one, and an illness that
 * lasted no days would be a morning where the village rolled a fever and nothing happened.
 *
 * The same halving a wound gets, for the same reason: it is the largest share that leaves being ill
 * worth avoiding and the smallest that makes a doctor visibly worth his wage. Rounded up, so the
 * mildest thing anybody catches still costs a day.
 */
export function laidUpIll(severity: number, doctor: Person | null): number {
  const worst = Math.max(0, Math.min(1, severity));
  const days = Math.max(1, Math.ceil(worst * AILMENT.WORST));
  return doctor ? Math.max(1, Math.round(days * (1 - WOUND.DOCTOR_SAVES))) : days;
}

/**
 * Who wakes up ill this morning, and what the doctor is owed for seeing them.
 *
 * The fee is charged here rather than in `mendThem`, and the difference matters: this is the one
 * morning a doctor is actually called, so it is the one morning anybody is billed. Nobody pays for
 * lying still afterwards.
 *
 * Two rolls per person, always both, whether or not the first one says anything. A village's life
 * is drawn off a stream and a stream that is asked a different number of questions on a different
 * morning is a different village — the same hazard `parentsFrom` carries in as many words.
 *
 * Nobody already laid up falls ill on top of it. Not out of kindness: a person has one number for
 * how much of this week they are losing, and two conditions that stack would let a village keep
 * somebody in bed indefinitely by bad luck, which is a thing nobody could see happening and nobody
 * could tune.
 */
export function fallIll(
  people: readonly Person[], rng: () => number, o: { baths: boolean; day: number },
): Map<Owner, number> {
  const doctor = doctoredBy(people);
  const chance = AILMENT.A_DAY * (o.baths ? 1 - AILMENT.BATHS_SAVE : 1);
  const fees = new Map<Owner, number>();
  for (const person of people) {
    const caught = rng() < chance;
    const severity = rng();                      // always spent, even where nobody caught anything
    if (!caught || (person.ill ?? 0) > 0 || (person.hurt ?? 0) > 0) continue;
    person.ill = laidUpIll(severity, doctor);
    if (doctor && doctor.id !== person.id) {
      const paid = Math.min(WOUND.FEE, person.purse);
      if (paid > 0) {
        fees.set(ownedBy(person), (fees.get(ownedBy(person)) ?? 0) - paid);
        fees.set(ownedBy(doctor), (fees.get(ownedBy(doctor)) ?? 0) + paid);
      }
    }
  }
  return fees;
}

/**
 * A day of getting better, for everybody in a village.
 *
 * Counted down by the day the village lives, exactly as `mendThem` counts a wound down, so a
 * village re-lived from its founding is ill and well again on the same mornings. No coin moves: it
 * was all moved on the morning the doctor was called.
 */
export function shakeItOff(people: readonly Person[]): void {
  for (const person of people) {
    const ill = person.ill ?? 0;
    if (ill <= 0) continue;
    person.ill = ill > 1 ? ill - 1 : undefined;
  }
}
